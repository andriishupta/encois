import {
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { organizations, organizationUnits } from "./organizations.js";

export const integrationStatus = pgEnum("integration_status", [
  "pending",
  "authorized",
  "active",
  "degraded",
  "needs_reauth",
  "disabled",
  "error",
]);
export type IntegrationStatus = (typeof integrationStatus.enumValues)[number];

export const integrationType = pgEnum("integration_type", [
  "api",
  "ai",
  "mcp",
  "custom",
]);
export type IntegrationType = (typeof integrationType.enumValues)[number];

export const integrationCatalogStatus = pgEnum("integration_catalog_status", [
  "active",
  "pending",
  "disabled",
]);
export type IntegrationCatalogStatus =
  (typeof integrationCatalogStatus.enumValues)[number];

export const integrationBindingStatus = pgEnum("integration_binding_status", [
  "active",
  "revoked",
]);
export type IntegrationBindingStatus =
  (typeof integrationBindingStatus.enumValues)[number];

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    type: integrationType("integration_type").notNull().default("api"),
    displayName: text("display_name").notNull(),
    status: integrationStatus("status").notNull().default("pending"),
    credentialRef: text("credential_ref"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    lastHealthCheckAt: timestamp("last_health_check_at", {
      withTimezone: true,
    }),
    lastError: text("last_error"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("integrations_id_organization_id_idx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

/** Global catalog metadata; tenant connections remain in `integrations`. */
export const integrationCatalog = pgTable(
  "integration_catalog",
  {
    key: text("key").primaryKey(),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    type: integrationType("integration_type").notNull(),
    status: integrationCatalogStatus("status").notNull().default("disabled"),
    capabilities: jsonb("capabilities")
      .$type<readonly string[]>()
      .notNull()
      .default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_catalog_provider_type_idx").on(
      table.provider,
      table.type,
    ),
    uniqueIndex("integration_catalog_status_sort_idx").on(
      table.status,
      table.sortOrder,
    ),
  ],
);

export const integrationBindings = pgTable(
  "integration_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").notNull(),
    /** Organization root for provider-level capability grants. Source scopes are stored on knowledgeSources. */
    organizationUnitId: uuid("organization_unit_id").notNull(),
    status: integrationBindingStatus("status").notNull().default("active"),
    grantedScopes: jsonb("granted_scopes")
      .$type<readonly string[]>()
      .notNull()
      .default([]),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("integration_bindings_unique_idx").on(
      table.integrationId,
      table.organizationUnitId,
    ),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [integrations.id, integrations.organizationId],
      name: "integration_bindings_integration_scope_fk",
    }),
    foreignKey({
      columns: [table.organizationUnitId, table.organizationId],
      foreignColumns: [organizationUnits.id, organizationUnits.organizationId],
      name: "integration_bindings_unit_scope_fk",
    }),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    endpointKey: text("endpoint_key").notNull(),
    integrationId: uuid("integration_id"),
    secretRef: text("secret_ref"),
    status: integrationStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("webhook_endpoints_organization_key_idx").on(
      table.organizationId,
      table.endpointKey,
    ),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [integrations.id, integrations.organizationId],
      name: "webhook_endpoints_integration_scope_fk",
    }),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "restrict" }),
    providerEventId: text("provider_event_id").notNull(),
    status: text("status").notNull().default("received"),
    payloadRef: text("payload_ref"),
    payloadChecksum: text("payload_checksum"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_endpoint_event_idx").on(
      table.endpointId,
      table.providerEventId,
    ),
  ],
);

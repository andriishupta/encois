import {
  foreignKey,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizationUnits, organizations } from "./organizations.js";
import { users } from "./identity.js";

export const integrationStatus = pgEnum("integration_status", ["pending", "authorized", "active", "degraded", "needs_reauth", "disabled", "error"]);
export type IntegrationStatus = (typeof integrationStatus.enumValues)[number];

export const integrationBindingStatus = pgEnum("integration_binding_status", ["active", "revoked"]);
export type IntegrationBindingStatus = (typeof integrationBindingStatus.enumValues)[number];

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    status: integrationStatus("status").notNull().default("pending"),
    credentialRef: text("credential_ref"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("integrations_id_organization_id_idx").on(table.id, table.organizationId)],
);

export const integrationBindings = pgTable(
  "integration_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").notNull(),
    organizationUnitId: uuid("organization_unit_id").notNull(),
    status: integrationBindingStatus("status").notNull().default("active"),
    grantedScopes: jsonb("granted_scopes").$type<readonly string[]>().notNull().default([]),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("integration_bindings_unique_idx").on(table.integrationId, table.organizationUnitId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webhook_endpoints_organization_key_idx").on(table.organizationId, table.endpointKey),
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
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("webhook_deliveries_endpoint_event_idx").on(table.endpointId, table.providerEventId)],
);

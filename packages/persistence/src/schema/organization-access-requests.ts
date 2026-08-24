import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import {
  accessLevel,
  organizations,
  organizationUnits,
} from "./organizations.js";

export const organizationAccessRequestStatus = pgEnum(
  "organization_access_request_status",
  ["proposed", "approved", "rejected", "applied"],
);

export const organizationAccessRequests = pgTable(
  "organization_access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    organizationUnitId: uuid("organization_unit_id").notNull(),
    requestedAccess: accessLevel("requested_access").notNull(),
    reason: text("reason").notNull(),
    status: organizationAccessRequestStatus("status")
      .notNull()
      .default("proposed"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("organization_access_requests_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("organization_access_requests_organization_status_created_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("organization_access_requests_requester_status_idx").on(
      table.requestedByUserId,
      table.status,
    ),
    foreignKey({
      columns: [table.organizationUnitId, table.organizationId],
      foreignColumns: [organizationUnits.id, organizationUnits.organizationId],
      name: "organization_access_requests_unit_scope_fk",
    }),
  ],
);

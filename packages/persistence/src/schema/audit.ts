import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { organizations } from "./organizations.js";

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "restrict",
  }),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { integrations } from "./integrations.js";
import { organizations } from "./organizations.js";
import { users } from "./identity.js";

/** One-time OAuth state records; the raw state token is never persisted. */
export const integrationAuthorizationStates = pgTable(
  "integration_authorization_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    stateHash: text("state_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("integration_authorization_states_hash_idx").on(table.stateHash),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [integrations.id, integrations.organizationId],
      name: "integration_authorization_states_integration_scope_fk",
    }),
  ],
);

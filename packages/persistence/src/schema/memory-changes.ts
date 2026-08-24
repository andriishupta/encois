import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { organizations } from "./organizations.js";

export const memoryChangeAction = pgEnum("memory_change_action", [
  "add",
  "correct",
  "delete",
]);
export const memoryChangeStatus = pgEnum("memory_change_status", [
  "proposed",
  "approved",
  "rejected",
  "applied",
  "failed",
]);

export const memoryChangeRequests = pgTable(
  "memory_change_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memoryId: text("memory_id"),
    agentDefinition: text("agent_definition").notNull(),
    projectId: text("project_id"),
    userId: text("user_id"),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
    action: memoryChangeAction("action").notNull(),
    replacementSummary: text("replacement_summary"),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>(),
    status: memoryChangeStatus("status").notNull().default("proposed"),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    runtimeRequestId: text("runtime_request_id"),
    providerOperationName: text("provider_operation_name"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("memory_change_requests_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("memory_change_requests_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

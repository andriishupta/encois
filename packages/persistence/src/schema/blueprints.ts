import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";

export const workflowBlueprintStatus = pgEnum("workflow_blueprint_status", [
  "draft",
  "approved",
  "retired",
]);
export type WorkflowBlueprintStatus = (typeof workflowBlueprintStatus.enumValues)[number];

/**
 * Persisted company-specific configuration for the generic Temporal Workflow.
 * The Go Runtime receives a snapshot in Temporal input; it never queries this
 * table directly.
 */
export const workflowBlueprints = pgTable(
  "workflow_blueprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    blueprintId: text("blueprint_id").notNull(),
    version: text("version").notNull(),
    workflowType: text("workflow_type").notNull(),
    name: text("name").notNull(),
    blueprint: jsonb("blueprint").$type<Record<string, unknown>>().notNull(),
    status: workflowBlueprintStatus("status").notNull().default("draft"),
    sourcePlanId: text("source_plan_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("workflow_blueprints_organization_identity_idx").on(
      table.organizationId,
      table.blueprintId,
      table.version,
    ),
    uniqueIndex("workflow_blueprints_id_organization_idx").on(table.id, table.organizationId),
  ],
);

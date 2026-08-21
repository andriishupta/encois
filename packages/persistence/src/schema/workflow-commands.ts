import { foreignKey, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";
import { workflowRuns } from "./workflows.js";

export const workflowCommandReceiptStatus = pgEnum("workflow_command_receipt_status", [
  "in_flight",
  "accepted",
  "failed",
]);
export type WorkflowCommandReceiptStatus = (typeof workflowCommandReceiptStatus.enumValues)[number];

/**
 * Tenant-scoped idempotency receipts for commands sent to Temporal.
 *
 * A receipt is written before the external Temporal call. If the API process
 * dies after Temporal accepted the command but before the receipt is marked
 * accepted, replaying the same command is safe: Temporal Update IDs and the
 * Go Workflow's Signal IDs provide the second idempotency barrier.
 */
export const workflowCommandReceipts = pgTable(
  "workflow_command_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id").notNull(),
    temporalWorkflowId: text("temporal_workflow_id").notNull(),
    commandType: text("command_type").notNull(),
    commandId: text("command_id").notNull(),
    requestHash: text("request_hash").notNull(),
    status: workflowCommandReceiptStatus("status").notNull().default("in_flight"),
    error: text("error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workflow_command_receipts_scope_key_idx").on(
      table.organizationId,
      table.temporalWorkflowId,
      table.commandType,
      table.commandId,
    ),
    uniqueIndex("workflow_command_receipts_id_organization_idx").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.workflowRunId, table.organizationId],
      foreignColumns: [workflowRuns.id, workflowRuns.organizationId],
      name: "workflow_command_receipts_run_scope_fk",
    }),
  ],
);

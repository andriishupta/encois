import {
  boolean,
  foreignKey,
  index,
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
import { organizations } from "./organizations.js";

export const workflowDefinitionStatus = pgEnum("workflow_definition_status", [
  "draft",
  "approved",
  "disabled",
  "retired",
]);
export type WorkflowDefinitionStatus =
  (typeof workflowDefinitionStatus.enumValues)[number];

export const workflowRunStatus = pgEnum("workflow_run_status", [
  "queued",
  "running",
  "waiting",
  "paused",
  "partial",
  "failed",
  "completed",
  "cancelled",
]);
export type WorkflowRunStatus = (typeof workflowRunStatus.enumValues)[number];

export const workflowPlanStatus = pgEnum("workflow_plan_status", [
  "proposed",
  "approved",
  "rejected",
  "applied",
  "expired",
]);
export type WorkflowPlanStatus = (typeof workflowPlanStatus.enumValues)[number];

export const workflowChangePlans = pgTable(
  "workflow_change_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull(),
    coordinatorId: text("coordinator_id").notNull(),
    projectId: text("project_id"),
    planHash: text("plan_hash").notNull(),
    plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
    plannerName: text("planner_name"),
    plannerVersion: text("planner_version"),
    sourceSchemaVersion: text("source_schema_version"),
    promptVersion: text("prompt_version"),
    promptHash: text("prompt_hash"),
    status: workflowPlanStatus("status").notNull().default("proposed"),
    approvalRequired: boolean("approval_required").notNull().default(true),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("workflow_change_plans_organization_plan_idx").on(
      table.organizationId,
      table.planId,
    ),
    uniqueIndex("workflow_change_plans_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("workflow_change_plans_organization_deleted_idx").on(
      table.organizationId,
      table.deletedAt,
    ),
  ],
);

/** Distinct planner/schema/prompt fingerprints observed on persisted plans. Raw prompts are never stored here. */
export const workflowPlannerVersions = pgTable(
  "workflow_planner_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    plannerName: text("planner_name"),
    plannerVersion: text("planner_version"),
    sourceSchemaVersion: text("source_schema_version"),
    promptVersion: text("prompt_version"),
    promptHash: text("prompt_hash"),
    versionHash: text("version_hash").notNull(),
    firstPlanId: text("first_plan_id").notNull(),
    lastPlanId: text("last_plan_id").notNull(),
    usageCount: integer("usage_count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workflow_planner_versions_org_hash_idx").on(
      table.organizationId,
      table.versionHash,
    ),
    index("workflow_planner_versions_org_last_seen_idx").on(
      table.organizationId,
      table.lastSeenAt,
    ),
    uniqueIndex("workflow_planner_versions_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    version: text("version").notNull(),
    status: workflowDefinitionStatus("status").notNull().default("draft"),
    inputSchemaRef: text("input_schema_ref"),
    outputSchemaRef: text("output_schema_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workflow_definitions_key_version_idx").on(
      table.organizationId,
      table.key,
      table.version,
    ),
  ],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    temporalNamespace: text("temporal_namespace"),
    temporalTaskQueue: text("temporal_task_queue"),
    temporalWorkflowId: text("temporal_workflow_id").notNull(),
    temporalRunId: text("temporal_run_id"),
    blueprintId: text("blueprint_id"),
    blueprintVersion: text("blueprint_version"),
    parentWorkflowId: text("parent_workflow_id"),
    trigger: text("trigger"),
    status: workflowRunStatus("status").notNull().default("queued"),
    scope: jsonb("scope")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    businessInput: jsonb("business_input")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    inputRef: text("input_ref"),
    resultRef: text("result_ref"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workflow_runs_organization_temporal_id_idx").on(
      table.organizationId,
      table.temporalWorkflowId,
    ),
    uniqueIndex("workflow_runs_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    activityName: text("activity_name"),
    agentRunId: text("agent_run_id"),
    evidenceRef: text("evidence_ref"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workflow_events_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      columns: [table.workflowRunId, table.organizationId],
      foreignColumns: [workflowRuns.id, workflowRuns.organizationId],
      name: "workflow_events_run_scope_fk",
    }),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    resourceType: text("resource_type"),
    resourceId: uuid("resource_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_organization_key_idx").on(
      table.organizationId,
      table.key,
    ),
  ],
);

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
import { integrations } from "./integrations.js";
import { organizations } from "./organizations.js";

export const knowledgeSourceKind = pgEnum("knowledge_source_kind", [
  "integration",
  "uploaded_document",
  "manual",
  "media",
]);
export type KnowledgeSourceKind = (typeof knowledgeSourceKind.enumValues)[number];

export const knowledgeSourceStatus = pgEnum("knowledge_source_status", [
  "draft",
  "connecting",
  "discovering",
  "ingesting",
  "active",
  "degraded",
  "needs_reauth",
  "failed",
  "disabled",
]);
export type KnowledgeSourceStatus = (typeof knowledgeSourceStatus.enumValues)[number];

export const sourceRevisionStatus = pgEnum("source_revision_status", [
  "pending",
  "ingesting",
  "active",
  "failed",
  "superseded",
]);
export type SourceRevisionStatus = (typeof sourceRevisionStatus.enumValues)[number];

export const sourceIngestionTrigger = pgEnum("source_ingestion_trigger", [
  "bootstrap",
  "manual",
  "webhook",
  "schedule",
  "reconcile",
]);
export type SourceIngestionTrigger = (typeof sourceIngestionTrigger.enumValues)[number];

export const sourceIngestionStatus = pgEnum("source_ingestion_status", [
  "queued",
  "running",
  "completed",
  "deferred",
  "failed",
]);
export type SourceIngestionStatus = (typeof sourceIngestionStatus.enumValues)[number];

export type SourceScope = {
  ids: readonly string[];
  teamIds?: readonly string[];
  projectIds?: readonly string[];
};

/** Logical organization-scoped origin of knowledge. Raw bytes live elsewhere. */
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: knowledgeSourceKind("kind").notNull(),
    provider: text("provider"),
    integrationId: uuid("integration_id"),
    status: knowledgeSourceStatus("status").notNull().default("draft"),
    readScope: jsonb("read_scope").$type<SourceScope>().notNull(),
    visibilityScope: jsonb("visibility_scope").$type<SourceScope>().notNull(),
    contentType: text("content_type"),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    currentRevisionId: uuid("current_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_sources_id_organization_idx").on(table.id, table.organizationId),
    uniqueIndex("knowledge_sources_name_organization_idx").on(table.organizationId, table.name),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [integrations.id, integrations.organizationId],
      name: "knowledge_sources_integration_scope_fk",
    }),
  ],
);

/** Immutable logical version of a source. Raw content is addressed by artifactRef. */
export const sourceRevisions = pgTable(
  "source_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    revision: text("revision").notNull(),
    status: sourceRevisionStatus("status").notNull().default("pending"),
    artifactRef: text("artifact_ref"),
    sourceObjectId: text("source_object_id"),
    contentType: text("content_type"),
    checksum: text("checksum"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_revisions_source_revision_idx").on(table.sourceId, table.revision),
    uniqueIndex("source_revisions_id_organization_idx").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.sourceId, table.organizationId],
      foreignColumns: [knowledgeSources.id, knowledgeSources.organizationId],
      name: "source_revisions_source_scope_fk",
    }),
  ],
);

/** Durable record of one source ingestion execution. */
export const sourceIngestionRuns = pgTable(
  "source_ingestion_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    sourceRevisionId: uuid("source_revision_id").notNull(),
    temporalWorkflowId: text("temporal_workflow_id").notNull(),
    temporalRunId: text("temporal_run_id"),
    trigger: sourceIngestionTrigger("trigger").notNull(),
    status: sourceIngestionStatus("status").notNull().default("queued"),
    currentStage: text("current_stage"),
    factsCount: integer("facts_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_ingestion_runs_id_organization_idx").on(table.id, table.organizationId),
    uniqueIndex("source_ingestion_runs_temporal_id_idx").on(table.organizationId, table.temporalWorkflowId),
    foreignKey({
      columns: [table.sourceId, table.organizationId],
      foreignColumns: [knowledgeSources.id, knowledgeSources.organizationId],
      name: "source_ingestion_runs_source_scope_fk",
    }),
    foreignKey({
      columns: [table.sourceRevisionId, table.organizationId],
      foreignColumns: [sourceRevisions.id, sourceRevisions.organizationId],
      name: "source_ingestion_runs_revision_scope_fk",
    }),
  ],
);

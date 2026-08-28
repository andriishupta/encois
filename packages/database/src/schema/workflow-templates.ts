import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";

export const workflowTemplateStatus = pgEnum("workflow_template_status", [
  "draft",
  "published",
  "active",
  "disabled",
  "deleted",
  "retired",
]);
export type WorkflowTemplateStatus =
  (typeof workflowTemplateStatus.enumValues)[number];

export const workflowTemplateVersionStatus = pgEnum(
  "workflow_template_version_status",
  ["draft", "published", "retired"],
);
export type WorkflowTemplateVersionStatus =
  (typeof workflowTemplateVersionStatus.enumValues)[number];

export type WorkflowTemplateStep = {
  id: string;
  kind: "tool" | "agent" | "transform" | "condition" | "wait" | "approval";
  tool?: string;
  providerSlot?: string;
  agentDefinition?: string;
  dependsOn?: readonly string[];
  input?: Record<string, unknown>;
  requiresApproval?: boolean;
};

/**
 * Provider-neutral catalog data. Workflow Creator maps this template to the
 * canonical workflow-blueprint.v1 contract after resolving provider slots.
 * This is intentionally not executable by the Agent Runtime.
 */
export type WorkflowTemplate = {
  schemaVersion: "workflow-template.v1";
  version: string;
  workflowType: "encois.dynamic.v1";
  purpose: string;
  inputs: Readonly<
    Record<string, { type: string; description: string; required?: boolean }>
  >;
  providerSlots: readonly {
    key: string;
    capabilities: readonly string[];
    preferredProviders?: readonly string[];
    required?: boolean;
  }[];
  steps: readonly WorkflowTemplateStep[];
  output: {
    type: string;
    description: string;
  };
};

export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** NULL means a platform-wide catalog entry; non-NULL is tenant-owned. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    keywords: text("keywords").array().notNull().default([]),
    requiredCapabilities: text("required_capabilities")
      .array()
      .notNull()
      .default([]),
    publishedVersion: text("published_version"),
    status: workflowTemplateStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workflow_templates_scope_key_idx").on(
      table.organizationId,
      table.key,
    ),
    uniqueIndex("workflow_templates_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const workflowTemplateVersions = pgTable(
  "workflow_template_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Must match the parent scope; NULL means a platform-wide snapshot. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workflowTemplateId: uuid("workflow_template_id")
      .notNull()
      .references((): AnyPgColumn => workflowTemplates.id, {
        onDelete: "cascade",
      }),
    version: text("version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    template: jsonb("template").$type<WorkflowTemplate>().notNull(),
    status: workflowTemplateVersionStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workflow_template_versions_identity_idx").on(
      table.workflowTemplateId,
      table.version,
    ),
    uniqueIndex("workflow_template_versions_id_idx").on(table.id),
    check(
      "workflow_template_versions_template_version_check",
      sql`${table.template}->>'version' = ${table.version} AND ${table.template}->>'schemaVersion' = ${table.schemaVersion}`,
    ),
  ],
);

import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";

export const organizationOnboardingStatus = pgEnum("organization_onboarding_status", [
  "pending",
  "initializing",
  "ready",
  "failed",
]);
export type OrganizationOnboardingStatus = (typeof organizationOnboardingStatus.enumValues)[number];

export const coordinationMode = pgEnum("coordination_mode", ["start-coordinator", "connect-only"]);
export type CoordinationMode = (typeof coordinationMode.enumValues)[number];

/** Durable product lifecycle state for the organization Coordinator bootstrap. */
export const organizationOnboarding = pgTable("organization_onboarding", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  status: organizationOnboardingStatus("status").notNull().default("pending"),
  coordinatorId: text("coordinator_id").notNull(),
  coordinationMode: coordinationMode("coordination_mode").notNull().default("start-coordinator"),
  selectedWorkflows: jsonb("selected_workflows").$type<string[]>().notNull().default([]),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

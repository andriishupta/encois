import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { organizations } from "./organizations.js";

export const savedInvestigations = pgTable(
  "saved_investigations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    query: text("query").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("saved_investigations_id_organization_idx").on(table.id, table.organizationId),
    uniqueIndex("saved_investigations_owner_name_idx").on(table.organizationId, table.ownerUserId, table.name),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    pushEnabled: boolean("push_enabled").notNull().default(false),
    workflowUpdates: boolean("workflow_updates").notNull().default(true),
    evidenceReady: boolean("evidence_ready").notNull().default(true),
    weeklyDigest: boolean("weekly_digest").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("notification_preferences_user_idx").on(table.organizationId, table.userId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notifications_user_dedupe_idx").on(table.organizationId, table.userId, table.dedupeKey),
    uniqueIndex("notifications_id_organization_idx").on(table.id, table.organizationId),
  ],
);

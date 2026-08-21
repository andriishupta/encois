import {
  foreignKey,
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

export const organizationUnitType = pgEnum("organization_unit_type", [
  "organization",
  "department",
  "team",
  "project",
  "service",
  "custom",
]);

export const membershipStatus = pgEnum("membership_status", ["invited", "active", "suspended"]);

export const accessLevel = pgEnum("access_level", ["viewer", "contributor", "manager", "admin"]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)],
);

export const organizationUnits = pgTable(
  "organization_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    type: organizationUnitType("type").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_units_id_organization_id_idx").on(table.id, table.organizationId),
    uniqueIndex("organization_units_slug_idx").on(table.organizationId, table.parentId, table.slug),
    foreignKey({
      columns: [table.parentId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
      name: "organization_units_parent_scope_fk",
    }),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("roles_organization_key_idx").on(table.organizationId, table.key)],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    status: membershipStatus("status").notNull().default("invited"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_memberships_organization_user_idx").on(table.organizationId, table.userId),
    uniqueIndex("organization_memberships_id_organization_idx").on(table.id, table.organizationId),
  ],
);

export const membershipScopes = pgTable(
  "membership_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    organizationUnitId: uuid("organization_unit_id").notNull(),
    access: accessLevel("access").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("membership_scopes_unique_idx").on(table.membershipId, table.organizationUnitId),
    foreignKey({
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [organizationMemberships.id, organizationMemberships.organizationId],
      name: "membership_scopes_membership_scope_fk",
    }),
    foreignKey({
      columns: [table.organizationUnitId, table.organizationId],
      foreignColumns: [organizationUnits.id, organizationUnits.organizationId],
      name: "membership_scopes_unit_scope_fk",
    }),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [uniqueIndex("role_permissions_role_permission_idx").on(table.roleId, table.permission)],
);

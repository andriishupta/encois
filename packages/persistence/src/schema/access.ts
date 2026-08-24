import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { organizations, organizationUnits, roles } from "./organizations.js";

export const organizationInviteStatus = pgEnum("organization_invite_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export type OrganizationInviteStatus =
  (typeof organizationInviteStatus.enumValues)[number];

/**
 * Pre-auth access grants. This table is intentionally not tenant-RLS scoped:
 * the Gateway must resolve an invite before it knows the organization context.
 * It is server-only control-plane data and never exposed as a public list.
 */
export const organizationInvites = pgTable(
  "organization_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailNormalized: text("email_normalized").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizationUnitId: uuid("organization_unit_id"),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    status: organizationInviteStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("organization_invites_email_status_idx").on(
      table.emailNormalized,
      table.status,
    ),
    uniqueIndex("organization_invites_pending_email_idx")
      .on(table.organizationId, table.emailNormalized)
      .where(sql`status = 'pending'`),
    uniqueIndex("organization_invites_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      columns: [table.organizationUnitId, table.organizationId],
      foreignColumns: [organizationUnits.id, organizationUnits.organizationId],
      name: "organization_invites_unit_scope_fk",
    }),
  ],
);

export const waitlistRequestStatus = pgEnum("waitlist_request_status", [
  "pending",
  "contacted",
  "converted",
  "rejected",
]);
export type WaitlistRequestStatus =
  (typeof waitlistRequestStatus.enumValues)[number];

/** Public submissions are accepted, but listing and status changes are operator-only. */
export const waitlistRequests = pgTable(
  "waitlist_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailNormalized: text("email_normalized").notNull(),
    displayName: text("display_name"),
    companyName: text("company_name").notNull(),
    companyWebsite: text("company_website"),
    companyLinkedinUrl: text("company_linkedin_url"),
    message: text("message"),
    status: waitlistRequestStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("waitlist_requests_email_idx").on(table.emailNormalized),
    check(
      "waitlist_requests_company_reference_check",
      sql`NULLIF(TRIM(${table.companyWebsite}), '') IS NOT NULL OR NULLIF(TRIM(${table.companyLinkedinUrl}), '') IS NOT NULL`,
    ),
  ],
);

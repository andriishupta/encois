import {
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
import { organizations } from "./organizations.js";

export const coordinatorEventOutboxStatus = pgEnum(
  "coordinator_event_outbox_status",
  ["pending", "delivering", "delivered", "failed"],
);
export type CoordinatorEventOutboxStatus =
  (typeof coordinatorEventOutboxStatus.enumValues)[number];

/**
 * Durable delivery queue for lifecycle events sent to a Coordinator
 * Workflow. The payload is the small coordinator-event.v1 envelope, never a
 * raw provider response or the complete Workflow Change Plan.
 */
export const coordinatorEventOutbox = pgTable(
  "coordinator_event_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    coordinatorId: text("coordinator_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: coordinatorEventOutboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("coordinator_event_outbox_organization_event_idx").on(
      table.organizationId,
      table.eventId,
    ),
    index("coordinator_event_outbox_delivery_idx").on(
      table.status,
      table.availableAt,
    ),
    uniqueIndex("coordinator_event_outbox_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

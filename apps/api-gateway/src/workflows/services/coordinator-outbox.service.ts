import { type CoordinatorEvent, validateContract } from "@encois/contracts";
import {
  coordinatorEventOutbox,
  type DatabaseTransaction,
  withOrganizationContext,
} from "@encois/database";
import { and, asc, eq, lt, lte, or, sql } from "drizzle-orm";
import { database } from "../../database.js";
import type { WorkflowClient } from "../temporal-client.js";

export type CoordinatorEventSink = (event: CoordinatorEvent) => Promise<void>;

export type CoordinatorOutboxDispatchOptions = {
  sink: CoordinatorEventSink;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  now?: Date;
};

export type CoordinatorOutboxDispatchResult = {
  status: "dispatched" | "database-unavailable";
  claimed: number;
  delivered: number;
  failed: number;
};

const defaultLeaseMs = 30_000;
const defaultMaxAttempts = 8;

export function createCoordinatorEventSink(
  workflowClient: WorkflowClient,
  namespace: string,
): CoordinatorEventSink {
  return (event) =>
    workflowClient.signalCoordinator(
      event.coordinatorId,
      event.organizationId,
      namespace,
      event,
    );
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts, 8));
}

async function claimEvent(
  db: DatabaseTransaction,
  tenantId: string,
  eventId: string,
  now: Date,
  leaseUntil: Date,
): Promise<typeof coordinatorEventOutbox.$inferSelect | null> {
  const [claimed] = await db
    .update(coordinatorEventOutbox)
    .set({
      status: "delivering",
      attempts: sql`${coordinatorEventOutbox.attempts} + 1`,
      lastAttemptAt: now,
      leaseUntil,
      updatedAt: now,
    })
    .where(
      and(
        eq(coordinatorEventOutbox.organizationId, tenantId),
        eq(coordinatorEventOutbox.eventId, eventId),
        or(
          eq(coordinatorEventOutbox.status, "pending"),
          eq(coordinatorEventOutbox.status, "failed"),
          and(
            eq(coordinatorEventOutbox.status, "delivering"),
            lte(coordinatorEventOutbox.leaseUntil, now),
          ),
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

async function markDelivered(
  db: DatabaseTransaction,
  tenantId: string,
  eventId: string,
  now: Date,
): Promise<void> {
  await db
    .update(coordinatorEventOutbox)
    .set({
      status: "delivered",
      deliveredAt: now,
      leaseUntil: null,
      updatedAt: now,
      lastError: null,
    })
    .where(
      and(
        eq(coordinatorEventOutbox.organizationId, tenantId),
        eq(coordinatorEventOutbox.eventId, eventId),
      ),
    );
}

async function markFailed(
  db: DatabaseTransaction,
  tenantId: string,
  eventId: string,
  attempts: number,
  now: Date,
  error: unknown,
  maxAttempts: number,
): Promise<void> {
  const terminal = attempts >= maxAttempts;
  await db
    .update(coordinatorEventOutbox)
    .set({
      status: "failed",
      leaseUntil: null,
      lastError: boundedError(error),
      availableAt: terminal
        ? now
        : new Date(now.getTime() + retryDelayMs(attempts)),
      updatedAt: now,
    })
    .where(
      and(
        eq(coordinatorEventOutbox.organizationId, tenantId),
        eq(coordinatorEventOutbox.eventId, eventId),
      ),
    );
}

async function dispatchCoordinatorOutboxForOrganization(
  options: CoordinatorOutboxDispatchOptions,
  tenantId: string,
  now: Date,
  limit: number,
  leaseMs: number,
  maxAttempts: number,
): Promise<CoordinatorOutboxDispatchResult> {
  if (!database) {
    return {
      status: "database-unavailable",
      claimed: 0,
      delivered: 0,
      failed: 0,
    };
  }

  const candidates = await withOrganizationContext(
    database,
    tenantId,
    async (db) =>
      db
        .select()
        .from(coordinatorEventOutbox)
        .where(
          and(
            eq(coordinatorEventOutbox.organizationId, tenantId),
            lt(coordinatorEventOutbox.attempts, maxAttempts),
            or(
              and(
                or(
                  eq(coordinatorEventOutbox.status, "pending"),
                  eq(coordinatorEventOutbox.status, "failed"),
                ),
                lte(coordinatorEventOutbox.availableAt, now),
              ),
              and(
                eq(coordinatorEventOutbox.status, "delivering"),
                lte(coordinatorEventOutbox.leaseUntil, now),
              ),
            ),
          ),
        )
        .orderBy(asc(coordinatorEventOutbox.availableAt))
        .limit(limit),
  );

  let claimedCount = 0;
  let deliveredCount = 0;
  let failedCount = 0;
  for (const candidate of candidates) {
    const claimed = await withOrganizationContext(database, tenantId, (db) =>
      claimEvent(
        db,
        tenantId,
        candidate.eventId,
        now,
        new Date(now.getTime() + leaseMs),
      ),
    );
    if (!claimed) continue;
    claimedCount += 1;

    const validation = validateContract("coordinatorEvent", claimed.payload);
    if (!validation.valid) {
      await withOrganizationContext(database, tenantId, (db) =>
        markFailed(
          db,
          tenantId,
          claimed.eventId,
          claimed.attempts,
          now,
          `invalid coordinator event: ${validation.errors.join(", ")}`,
          maxAttempts,
        ),
      );
      failedCount += 1;
      continue;
    }

    try {
      await options.sink(claimed.payload as unknown as CoordinatorEvent);
      await withOrganizationContext(database, tenantId, (db) =>
        markDelivered(db, tenantId, claimed.eventId, now),
      );
      deliveredCount += 1;
    } catch (error) {
      await withOrganizationContext(database, tenantId, (db) =>
        markFailed(
          db,
          tenantId,
          claimed.eventId,
          claimed.attempts,
          now,
          error,
          maxAttempts,
        ),
      );
      failedCount += 1;
    }
  }

  return {
    status: "dispatched",
    claimed: claimedCount,
    delivered: deliveredCount,
    failed: failedCount,
  };
}

async function listDispatchableOrganizationIds(
  now: Date,
  maxAttempts: number,
): Promise<readonly string[]> {
  if (!database) return [];

  const rows = await database.execute<{ organizationId: string }>(sql`
    SELECT organization_id AS "organizationId"
    FROM public.list_dispatchable_coordinator_outbox_organizations(
      ${now},
      ${maxAttempts}
    )
  `);
  return rows.map((row) => row.organizationId);
}

/**
 * Delivers bounded batches for every organization with a dispatchable event.
 * Organization discovery is restricted to a database function; actual event
 * reads and writes still run under the normal tenant RLS context.
 */
export async function dispatchCoordinatorOutbox(
  options: CoordinatorOutboxDispatchOptions,
): Promise<CoordinatorOutboxDispatchResult> {
  if (!database)
    return {
      status: "database-unavailable",
      claimed: 0,
      delivered: 0,
      failed: 0,
    };

  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const leaseMs = Math.max(1_000, options.leaseMs ?? defaultLeaseMs);
  const maxAttempts = Math.max(1, options.maxAttempts ?? defaultMaxAttempts);

  let organizationIds: readonly string[];
  try {
    organizationIds = await listDispatchableOrganizationIds(now, maxAttempts);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "coordinator_outbox.discovery_failed",
        error: boundedError(error),
      }),
    );
    return {
      status: "database-unavailable",
      claimed: 0,
      delivered: 0,
      failed: 0,
    };
  }

  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let databaseUnavailable = false;

  for (const organizationId of organizationIds) {
    try {
      const result = await dispatchCoordinatorOutboxForOrganization(
        options,
        organizationId,
        now,
        limit,
        leaseMs,
        maxAttempts,
      );
      claimed += result.claimed;
      delivered += result.delivered;
      failed += result.failed;
      databaseUnavailable ||= result.status === "database-unavailable";
    } catch (error) {
      databaseUnavailable = true;
      console.error(
        JSON.stringify({
          event: "coordinator_outbox.organization_dispatch_failed",
          organizationId,
          error: boundedError(error),
        }),
      );
    }
  }

  return {
    status: databaseUnavailable ? "database-unavailable" : "dispatched",
    claimed,
    delivered,
    failed,
  };
}

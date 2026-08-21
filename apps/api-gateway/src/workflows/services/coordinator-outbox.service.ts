import { and, asc, eq, lt, lte, or, sql } from "drizzle-orm";
import { validateContract, type CoordinatorEvent } from "@encois/contracts";
import {
  coordinatorEventOutbox,
  type PersistenceTransaction,
  withOrganizationContext,
} from "@encois/persistence";
import { database } from "../../database.js";
import type { WorkflowClient } from "../temporal-client.js";

export type CoordinatorEventSink = (event: CoordinatorEvent) => Promise<void>;

export type CoordinatorOutboxDispatchOptions = {
  organizationId: string;
  sink: CoordinatorEventSink;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  now?: Date;
};

export type CoordinatorOutboxDispatchResult = {
  status: "dispatched" | "persistence-unavailable";
  claimed: number;
  delivered: number;
  failed: number;
};

const defaultLeaseMs = 30_000;
const defaultMaxAttempts = 8;

export function createCoordinatorEventSink(workflowClient: WorkflowClient, namespace: string): CoordinatorEventSink {
  return (event) => workflowClient.signalCoordinator(event.coordinatorId, event.organizationId, namespace, event);
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts, 8));
}

async function claimEvent(
  db: PersistenceTransaction,
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
          and(eq(coordinatorEventOutbox.status, "delivering"), lte(coordinatorEventOutbox.leaseUntil, now)),
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

async function markDelivered(db: PersistenceTransaction, tenantId: string, eventId: string, now: Date): Promise<void> {
  await db
    .update(coordinatorEventOutbox)
    .set({ status: "delivered", deliveredAt: now, leaseUntil: null, updatedAt: now, lastError: null })
    .where(and(eq(coordinatorEventOutbox.organizationId, tenantId), eq(coordinatorEventOutbox.eventId, eventId)));
}

async function markFailed(
  db: PersistenceTransaction,
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
      availableAt: terminal ? now : new Date(now.getTime() + retryDelayMs(attempts)),
      updatedAt: now,
    })
    .where(and(eq(coordinatorEventOutbox.organizationId, tenantId), eq(coordinatorEventOutbox.eventId, eventId)));
}

/**
 * Delivers a bounded batch for one tenant. The database claim is short and
 * finishes before the external Temporal call; the lease protects against two
 * dispatchers delivering the same event concurrently and allows recovery
 * after a dispatcher crash.
 */
export async function dispatchCoordinatorOutbox(
  options: CoordinatorOutboxDispatchOptions,
): Promise<CoordinatorOutboxDispatchResult> {
  if (!database) return { status: "persistence-unavailable", claimed: 0, delivered: 0, failed: 0 };

  const tenantId = options.organizationId;
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const leaseMs = Math.max(1_000, options.leaseMs ?? defaultLeaseMs);
  const maxAttempts = Math.max(1, options.maxAttempts ?? defaultMaxAttempts);
  const candidates = await withOrganizationContext(database, tenantId, async (db) =>
    db
      .select()
      .from(coordinatorEventOutbox)
      .where(
        and(
          eq(coordinatorEventOutbox.organizationId, tenantId),
          lt(coordinatorEventOutbox.attempts, maxAttempts),
          or(
            and(
              or(eq(coordinatorEventOutbox.status, "pending"), eq(coordinatorEventOutbox.status, "failed")),
              lte(coordinatorEventOutbox.availableAt, now),
            ),
            and(eq(coordinatorEventOutbox.status, "delivering"), lte(coordinatorEventOutbox.leaseUntil, now)),
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
      claimEvent(db, tenantId, candidate.eventId, now, new Date(now.getTime() + leaseMs)),
    );
    if (!claimed) continue;
    claimedCount += 1;

    const validation = validateContract("coordinatorEvent", claimed.payload);
    if (!validation.valid) {
      await withOrganizationContext(database, tenantId, (db) =>
        markFailed(db, tenantId, claimed.eventId, claimed.attempts, now, `invalid coordinator event: ${validation.errors.join(", ")}`, maxAttempts),
      );
      failedCount += 1;
      continue;
    }

    try {
      await options.sink(claimed.payload as unknown as CoordinatorEvent);
      await withOrganizationContext(database, tenantId, (db) => markDelivered(db, tenantId, claimed.eventId, now));
      deliveredCount += 1;
    } catch (error) {
      await withOrganizationContext(database, tenantId, (db) =>
        markFailed(db, tenantId, claimed.eventId, claimed.attempts, now, error, maxAttempts),
      );
      failedCount += 1;
    }
  }

  return { status: "dispatched", claimed: claimedCount, delivered: deliveredCount, failed: failedCount };
}

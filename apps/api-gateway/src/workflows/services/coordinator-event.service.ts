import { createHash } from "node:crypto";
import {
  ContractVersion,
  type CoordinatorEvent,
  type CoordinatorEventType,
} from "@encois/contracts";
import {
  coordinatorEventOutbox,
  type DatabaseTransaction,
  organizationOnboarding,
} from "@encois/database";
import { eq } from "drizzle-orm";

type CoordinatorEventInput = Omit<
  CoordinatorEvent,
  "contractVersion" | "coordinatorId" | "organizationId"
> & {
  organizationId: string;
  eventType: CoordinatorEventType;
};

export function coordinatorEventId(
  prefix: string,
  ...identity: readonly string[]
): string {
  const digest = createHash("sha256")
    .update(identity.join("\u0000"))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${digest}`;
}

/** Enqueue a small Coordinator event in the same tenant transaction as its state change. */
export async function enqueueCoordinatorEvent(
  db: DatabaseTransaction,
  input: CoordinatorEventInput,
  options: { requireReady?: boolean } = {},
): Promise<CoordinatorEvent> {
  const [coordinator] = await db
    .select({
      coordinatorId: organizationOnboarding.coordinatorId,
      status: organizationOnboarding.status,
    })
    .from(organizationOnboarding)
    .where(eq(organizationOnboarding.organizationId, input.organizationId))
    .limit(1);
  if (!coordinator || (options.requireReady && coordinator.status !== "ready"))
    throw new Error("COORDINATOR_NOT_READY");

  const { organizationId, ...payload } = input;
  const event: CoordinatorEvent = {
    ...payload,
    contractVersion: ContractVersion.CoordinatorEvent,
    organizationId,
    coordinatorId: coordinator.coordinatorId,
  };
  await db
    .insert(coordinatorEventOutbox)
    .values({
      organizationId,
      eventId: event.eventId,
      coordinatorId: event.coordinatorId,
      eventType: event.eventType,
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing();
  return event;
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { KnowledgeSourceKind, SourceIngestionTrigger } from "@encois/contracts";
import {
  integrations,
  knowledgeSources,
  sourceRevisions,
  webhookDeliveries,
  webhookEndpoints,
  withOrganizationContext,
} from "@encois/persistence";
import { and, eq, ne } from "drizzle-orm";
import { database } from "../../database.js";
import type { AosPrincipal } from "../../middleware/aos.js";
import {
  createSourceRevision,
  isSourceServiceError,
  type SourceServiceOptions,
  sourceServiceError,
  startSourceIngestion,
} from "../../sources/services/source.service.js";
import type { WebhookPayloadStore } from "../payload-store.js";
import type { WebhookSecretResolver } from "../secret-resolver.js";

const STALE_RECEIPT_MS = 60_000;
const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/iu;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type WebhookReceipt = {
  accepted: true;
  duplicate: boolean;
  matchedSources: number;
  status: "received" | "processed";
};

export type WebhookReceiverOptions = {
  secretResolver: WebhookSecretResolver;
  payloadStore?: WebhookPayloadStore;
  sourceService: SourceServiceOptions;
};

export class WebhookServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 401 | 404 | 409 | 413 | 415 | 503,
  ) {
    super(message);
    this.name = "WebhookServiceError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function normalizeHeader(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export function validateWebhookHeaders(
  eventId: string | undefined,
  signature: string | undefined,
): { eventId: string; signature: string } {
  const normalizedEventId = normalizeHeader(eventId);
  const normalizedSignature = normalizeHeader(signature);
  if (
    !normalizedEventId ||
    normalizedEventId.length > 256 ||
    hasControlCharacter(normalizedEventId)
  )
    throw new WebhookServiceError(
      "INVALID_WEBHOOK_HEADERS",
      "Webhook event headers are invalid.",
      400,
    );
  if (!normalizedSignature || !SIGNATURE_PATTERN.test(normalizedSignature))
    throw new WebhookServiceError(
      "INVALID_WEBHOOK_HEADERS",
      "Webhook signature headers are invalid.",
      400,
    );
  return { eventId: normalizedEventId, signature: normalizedSignature };
}

export function verifyWebhookSignature(
  bytes: Uint8Array,
  signature: string,
  secret: string,
): boolean {
  const match = SIGNATURE_PATTERN.exec(signature.trim());
  if (!match || secret.length === 0) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(bytes).digest("hex"),
    "utf8",
  );
  const suppliedDigest = match[1];
  if (!suppliedDigest) return false;
  const supplied = Buffer.from(suppliedDigest.toLowerCase(), "utf8");
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

export function webhookRevisionId(providerEventId: string): string {
  return `webhook-${createHash("sha256").update(providerEventId).digest("hex").slice(0, 64)}`;
}

function errorMessage(error: unknown): string {
  if (isSourceServiceError(error)) return error.message;
  return error instanceof Error ? error.message : "Webhook ingestion failed.";
}

async function getEndpoint(
  organizationId: string,
  endpointKey: string,
): Promise<typeof webhookEndpoints.$inferSelect | undefined> {
  if (!database)
    throw new WebhookServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Webhook persistence is not configured.",
      503,
    );
  return withOrganizationContext(database, organizationId, async (db) => {
    const [endpoint] = await db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, organizationId),
          eq(webhookEndpoints.endpointKey, endpointKey),
          eq(webhookEndpoints.status, "active"),
        ),
      )
      .limit(1);
    return endpoint;
  });
}

type DeliveryClaim =
  | { kind: "duplicate"; status: "received" | "processed"; payloadRef?: string }
  | { kind: "process"; payloadRef?: string };

async function claimDelivery(
  organizationId: string,
  endpointId: string,
  providerEventId: string,
  payloadChecksum: string,
): Promise<DeliveryClaim> {
  if (!database)
    throw new WebhookServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Webhook persistence is not configured.",
      503,
    );
  try {
    return await withOrganizationContext(
      database,
      organizationId,
      async (db) => {
        const [existing] = await db
          .select()
          .from(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.organizationId, organizationId),
              eq(webhookDeliveries.endpointId, endpointId),
              eq(webhookDeliveries.providerEventId, providerEventId),
            ),
          )
          .limit(1);
        if (
          existing?.payloadChecksum &&
          existing.payloadChecksum !== payloadChecksum
        ) {
          throw new WebhookServiceError(
            "WEBHOOK_EVENT_CONFLICT",
            "The provider event id was already used for a different payload.",
            409,
          );
        }
        if (existing?.status === "processed")
          return {
            kind: "duplicate",
            status: "processed",
            ...(existing.payloadRef ? { payloadRef: existing.payloadRef } : {}),
          };
        if (
          existing?.status === "received" &&
          Date.now() - existing.receivedAt.getTime() < STALE_RECEIPT_MS
        ) {
          return {
            kind: "duplicate",
            status: "received",
            ...(existing.payloadRef ? { payloadRef: existing.payloadRef } : {}),
          };
        }
        if (existing) {
          await db
            .update(webhookDeliveries)
            .set({
              status: "received",
              payloadChecksum,
              receivedAt: new Date(),
              processedAt: null,
            })
            .where(eq(webhookDeliveries.id, existing.id));
          return {
            kind: "process",
            ...(existing.payloadRef ? { payloadRef: existing.payloadRef } : {}),
          };
        }
        await db.insert(webhookDeliveries).values({
          organizationId,
          endpointId,
          providerEventId,
          payloadChecksum,
          status: "received",
        });
        return { kind: "process" };
      },
    );
  } catch (error) {
    if (isUniqueViolation(error))
      return claimDelivery(
        organizationId,
        endpointId,
        providerEventId,
        payloadChecksum,
      );
    throw error;
  }
}

async function setDeliveryPayload(
  organizationId: string,
  endpointId: string,
  providerEventId: string,
  payloadRef: string,
): Promise<void> {
  if (!database)
    throw new WebhookServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Webhook persistence is not configured.",
      503,
    );
  await withOrganizationContext(database, organizationId, async (db) => {
    await db
      .update(webhookDeliveries)
      .set({ payloadRef })
      .where(
        and(
          eq(webhookDeliveries.organizationId, organizationId),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.providerEventId, providerEventId),
        ),
      );
  });
}

async function completeDelivery(
  organizationId: string,
  endpointId: string,
  providerEventId: string,
): Promise<void> {
  if (!database) return;
  await withOrganizationContext(database, organizationId, async (db) => {
    await db
      .update(webhookDeliveries)
      .set({ status: "processed", processedAt: new Date() })
      .where(
        and(
          eq(webhookDeliveries.organizationId, organizationId),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.providerEventId, providerEventId),
        ),
      );
  });
}

async function failDelivery(
  organizationId: string,
  endpointId: string,
  providerEventId: string,
): Promise<void> {
  if (!database) return;
  await withOrganizationContext(database, organizationId, async (db) => {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", processedAt: null })
      .where(
        and(
          eq(webhookDeliveries.organizationId, organizationId),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.providerEventId, providerEventId),
        ),
      );
  });
}

type SourceMatch = {
  id: string;
  provider: string | null;
  readScope: { ids: readonly string[] };
  visibilityScope: { ids: readonly string[] };
  currentRevisionId: string | null;
  contentType: string | null;
};

async function matchingSources(
  organizationId: string,
  provider: string,
  integrationId: string | null,
): Promise<readonly SourceMatch[]> {
  if (!database)
    throw new WebhookServiceError(
      "PERSISTENCE_UNAVAILABLE",
      "Webhook persistence is not configured.",
      503,
    );
  return withOrganizationContext(database, organizationId, async (db) => {
    const conditions = [
      eq(knowledgeSources.organizationId, organizationId),
      eq(knowledgeSources.kind, KnowledgeSourceKind.Integration),
      eq(knowledgeSources.provider, provider),
      ne(knowledgeSources.status, "disabled"),
      eq(integrations.organizationId, organizationId),
      eq(integrations.status, "active"),
      eq(sourceRevisions.id, knowledgeSources.currentRevisionId),
    ];
    if (integrationId)
      conditions.push(eq(knowledgeSources.integrationId, integrationId));
    const rows = await db
      .select({
        id: knowledgeSources.id,
        provider: knowledgeSources.provider,
        readScope: knowledgeSources.readScope,
        visibilityScope: knowledgeSources.visibilityScope,
        currentRevisionId: knowledgeSources.currentRevisionId,
        contentType: knowledgeSources.contentType,
      })
      .from(knowledgeSources)
      .innerJoin(
        integrations,
        eq(integrations.id, knowledgeSources.integrationId),
      )
      .innerJoin(
        sourceRevisions,
        and(
          eq(sourceRevisions.id, knowledgeSources.currentRevisionId),
          eq(sourceRevisions.organizationId, organizationId),
        ),
      )
      .where(and(...conditions));
    return rows;
  });
}

async function processWebhook(
  organizationId: string,
  endpoint: typeof webhookEndpoints.$inferSelect,
  providerEventId: string,
  payloadRef: string,
  checksum: string,
  contentType: string,
  requestId: string,
  traceId: string,
  options: WebhookReceiverOptions,
): Promise<number> {
  const sources = await matchingSources(
    organizationId,
    endpoint.provider,
    endpoint.integrationId,
  );
  for (const source of sources) {
    if (!source.currentRevisionId) continue;
    const principal: AosPrincipal = {
      actorId: `webhook:${endpoint.id}`,
      organizationId,
      scope: source.readScope.ids,
    };
    const revision = await createSourceRevision(
      principal,
      source.id,
      {
        revision: webhookRevisionId(providerEventId),
        artifactRef: payloadRef,
        sourceObjectId: `webhook:${providerEventId}`,
        contentType,
        checksum: `sha256:${checksum}`,
        observedAt: new Date().toISOString(),
        metadata: {
          endpointKey: endpoint.endpointKey,
          provider: endpoint.provider,
          providerEventId,
        },
      },
      { system: true },
    );
    if (!revision)
      throw sourceServiceError(
        "SOURCE_NOT_FOUND",
        "A webhook source is no longer available.",
      );
    await startSourceIngestion(
      principal,
      source.id,
      revision.id,
      SourceIngestionTrigger.Webhook,
      requestId,
      traceId,
      { ...options.sourceService, system: true },
    );
  }
  return sources.length;
}

export async function receiveWebhook(
  input: {
    organizationId: string;
    endpointKey: string;
    eventId: string | undefined;
    signature: string | undefined;
    contentType: string | undefined;
    bytes: Uint8Array;
    requestId: string;
    traceId: string;
  },
  options: WebhookReceiverOptions,
): Promise<WebhookReceipt> {
  if (
    !UUID_PATTERN.test(input.organizationId) ||
    input.endpointKey.length === 0 ||
    input.endpointKey.length > 120 ||
    input.endpointKey.includes("/") ||
    hasControlCharacter(input.endpointKey)
  ) {
    throw new WebhookServiceError(
      "INVALID_WEBHOOK_PATH",
      "Webhook endpoint path is invalid.",
      400,
    );
  }
  const headers = validateWebhookHeaders(input.eventId, input.signature);
  if (input.bytes.length === 0 || input.bytes.length > 1 * 1024 * 1024)
    throw new WebhookServiceError(
      "INVALID_WEBHOOK_PAYLOAD",
      "Webhook payload is empty or too large.",
      413,
    );
  const contentType = (
    input.contentType?.split(";", 1)[0] ?? "application/json"
  )
    .trim()
    .toLowerCase();
  if (
    !new Set([
      "application/json",
      "text/plain",
      "application/octet-stream",
    ]).has(contentType)
  )
    throw new WebhookServiceError(
      "UNSUPPORTED_WEBHOOK_CONTENT_TYPE",
      "Webhook content type is not supported.",
      415,
    );
  const endpoint = await getEndpoint(input.organizationId, input.endpointKey);
  if (!endpoint)
    throw new WebhookServiceError(
      "WEBHOOK_NOT_FOUND",
      "Webhook endpoint not found.",
      404,
    );
  if (!endpoint.secretRef)
    throw new WebhookServiceError(
      "WEBHOOK_SECRET_UNAVAILABLE",
      "Webhook endpoint secret is not configured.",
      503,
    );
  let secret: string | undefined;
  try {
    secret = await options.secretResolver(endpoint.secretRef);
  } catch {
    throw new WebhookServiceError(
      "WEBHOOK_SECRET_UNAVAILABLE",
      "Webhook endpoint secret is not available.",
      503,
    );
  }
  if (!secret)
    throw new WebhookServiceError(
      "WEBHOOK_SECRET_UNAVAILABLE",
      "Webhook endpoint secret is not available.",
      503,
    );
  if (!verifyWebhookSignature(input.bytes, headers.signature, secret))
    throw new WebhookServiceError(
      "WEBHOOK_SIGNATURE_INVALID",
      "Webhook signature is invalid.",
      401,
    );
  if (!options.payloadStore)
    throw new WebhookServiceError(
      "WEBHOOK_PAYLOAD_STORE_UNAVAILABLE",
      "Webhook payload storage is not configured.",
      503,
    );

  const payloadChecksum = createHash("sha256")
    .update(input.bytes)
    .digest("hex");
  const claim = await claimDelivery(
    input.organizationId,
    endpoint.id,
    headers.eventId,
    payloadChecksum,
  );
  if (claim.kind === "duplicate") {
    return {
      accepted: true,
      duplicate: true,
      matchedSources: 0,
      status: claim.status,
    };
  }
  const reference = options.payloadStore.reference({
    organizationId: input.organizationId,
    endpointKey: endpoint.endpointKey,
    providerEventId: headers.eventId,
    contentType,
  });
  try {
    await options.payloadStore.write({
      ...reference,
      organizationId: input.organizationId,
      endpointKey: endpoint.endpointKey,
      providerEventId: headers.eventId,
      contentType,
      bytes: input.bytes,
    });
    await setDeliveryPayload(
      input.organizationId,
      endpoint.id,
      headers.eventId,
      reference.payloadRef,
    );
    const matchedSources = await processWebhook(
      input.organizationId,
      endpoint,
      headers.eventId,
      reference.payloadRef,
      payloadChecksum,
      contentType,
      input.requestId,
      input.traceId,
      options,
    );
    await completeDelivery(input.organizationId, endpoint.id, headers.eventId);
    return {
      accepted: true,
      duplicate: false,
      matchedSources,
      status: "processed",
    };
  } catch (error) {
    await failDelivery(
      input.organizationId,
      endpoint.id,
      headers.eventId,
    ).catch(() => undefined);
    if (error instanceof WebhookServiceError) throw error;
    throw new WebhookServiceError(
      "WEBHOOK_PROCESSING_FAILED",
      errorMessage(error),
      503,
    );
  }
}

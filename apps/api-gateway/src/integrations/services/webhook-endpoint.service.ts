import { and, eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { IntegrationStatus, Permission, type WebhookEndpointProjection, type WebhookEndpointSecretResponse } from "@encois/contracts";
import { auditEvents, integrations, webhookEndpoints, withOrganizationContext, type PersistenceTransaction } from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import { hasPermission } from "../../auth/authorization.js";
import { accessibleIntegrations } from "./integrations.service.js";
import type { WebhookSecretWriter } from "../../security/secret-manager.js";

type QueryDatabase = NonNullable<typeof database> | PersistenceTransaction;

export type WebhookEndpointServiceOptions = {
  secretWriter?: WebhookSecretWriter;
  publicBaseUrl?: string;
};

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/iu.test(candidate) ? candidate : null;
}

function serviceError(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

function endpointUrl(baseUrl: string | undefined, organizationId: string, endpointKey: string): string | undefined {
  if (!baseUrl) return undefined;
  const normalized = baseUrl.replace(/\/$/u, "");
  return `${normalized}/api/v1/webhooks/${encodeURIComponent(organizationId)}/${encodeURIComponent(endpointKey)}`;
}

function projectEndpoint(row: typeof webhookEndpoints.$inferSelect, options: WebhookEndpointServiceOptions): WebhookEndpointProjection {
  const url = endpointUrl(options.publicBaseUrl, row.organizationId, row.endpointKey);
  return {
    integrationId: row.integrationId ?? "",
    organizationId: row.organizationId,
    endpointKey: row.endpointKey,
    provider: row.provider,
    status: row.status,
    secretConfigured: Boolean(row.secretRef),
    ...(url ? { url } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function endpointKey(value: string | undefined, provider: string): string {
  const candidate = (value?.trim() || `${provider.trim().toLowerCase()}-events`).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/u.test(candidate)) throw serviceError("INVALID_WEBHOOK_ENDPOINT_KEY");
  return candidate;
}

async function assertManageAccess(db: QueryDatabase, principal: AosPrincipal, integrationId: string): Promise<{ userId: string; integration: Awaited<ReturnType<typeof accessibleIntegrations>>[number] }> {
  const userId = localUserId(principal);
  if (!userId) throw serviceError("IDENTITY_NOT_RESOLVED");
  if (!(await hasPermission(db, principal, Permission.IntegrationsManage))) throw serviceError("FORBIDDEN");
  const accessible = await accessibleIntegrations(db, principal.organizationId, userId, "manage", integrationId);
  const integration = accessible[0];
  if (!integration) throw serviceError("INTEGRATION_NOT_FOUND");
  return { userId, integration };
}

async function assertReadAccess(db: QueryDatabase, principal: AosPrincipal, integrationId: string): Promise<void> {
  const userId = localUserId(principal);
  if (!userId) throw serviceError("IDENTITY_NOT_RESOLVED");
  if (!(await hasPermission(db, principal, Permission.IntegrationsRead))) throw serviceError("FORBIDDEN");
  if ((await accessibleIntegrations(db, principal.organizationId, userId, "read", integrationId)).length === 0) throw serviceError("INTEGRATION_NOT_FOUND");
}

async function auditEndpoint(db: QueryDatabase, input: { organizationId: string; actorUserId: string; endpointId: string; action: string; scope: readonly string[]; status: string }): Promise<void> {
  await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    outcome: "accepted",
    resourceType: "webhook_endpoint",
    resourceId: input.endpointId,
    scope: { ids: [...input.scope] },
    metadata: { status: input.status },
  });
}

export async function getWebhookEndpointForPrincipal(
  principal: AosPrincipal,
  integrationId: string,
  options: WebhookEndpointServiceOptions,
): Promise<WebhookEndpointProjection | null> {
  if (!database) throw serviceError("PERSISTENCE_UNAVAILABLE");
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    await assertReadAccess(db, principal, integrationId);
    const [row] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.organizationId, principal.organizationId), eq(webhookEndpoints.integrationId, integrationId))).limit(1);
    return row ? projectEndpoint(row, options) : null;
  });
}

export async function provisionWebhookEndpoint(
  principal: AosPrincipal,
  integrationId: string,
  requestedEndpointKey: string | undefined,
  options: WebhookEndpointServiceOptions,
): Promise<WebhookEndpointSecretResponse> {
  if (!database) throw serviceError("PERSISTENCE_UNAVAILABLE");
  if (!options.secretWriter) throw serviceError("WEBHOOK_SECRET_WRITER_UNAVAILABLE");
  const userId = localUserId(principal);
  if (!userId) throw serviceError("IDENTITY_NOT_RESOLVED");
  const endpoint = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const access = await assertManageAccess(db, principal, integrationId);
    if (access.integration.status !== IntegrationStatus.Active || !access.integration.credentialRef) throw serviceError("INTEGRATION_NOT_ACTIVE");
    const key = endpointKey(requestedEndpointKey, access.integration.provider);
    const [existing] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.organizationId, principal.organizationId), eq(webhookEndpoints.integrationId, integrationId))).limit(1);
    if (existing?.status === IntegrationStatus.Active) throw serviceError("WEBHOOK_ENDPOINT_EXISTS");
    if (existing) {
      return { row: existing, scope: access.integration.organizationUnitId, reused: true as const };
    }
    let row: typeof webhookEndpoints.$inferSelect | undefined;
    try {
      [row] = await db.insert(webhookEndpoints).values({
        id: randomUUID(),
        organizationId: principal.organizationId,
        provider: access.integration.provider,
        endpointKey: key,
        integrationId,
        status: "pending",
      }).returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw serviceError("WEBHOOK_ENDPOINT_EXISTS");
      throw error;
    }
    if (!row) throw serviceError("WEBHOOK_ENDPOINT_CREATE_FAILED");
    return { row, scope: access.integration.organizationUnitId, reused: false as const };
  });

  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  let secretRef: string;
  try {
    secretRef = await options.secretWriter.write({ organizationId: principal.organizationId, endpointId: endpoint.row.id, endpointKey: endpoint.row.endpointKey, secret });
  } catch {
    await withOrganizationContext(database, principal.organizationId, async (db) => {
      await db.update(webhookEndpoints).set({ status: "error", updatedAt: new Date() }).where(eq(webhookEndpoints.id, endpoint.row.id));
    }).catch(() => undefined);
    throw serviceError("WEBHOOK_SECRET_STORE_UNAVAILABLE");
  }

  const updated = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [row] = await db.update(webhookEndpoints).set({ secretRef, status: "active", updatedAt: new Date() }).where(and(eq(webhookEndpoints.id, endpoint.row.id), eq(webhookEndpoints.organizationId, principal.organizationId))).returning();
    if (!row) throw serviceError("WEBHOOK_ENDPOINT_UPDATE_FAILED");
    await auditEndpoint(db, { organizationId: principal.organizationId, actorUserId: userId, endpointId: row.id, action: endpoint.reused ? "webhook_endpoint_repaired" : "webhook_endpoint_created", scope: [endpoint.scope], status: row.status });
    return row;
  });
  return { endpoint: projectEndpoint(updated, options), secret };
}

export async function rotateWebhookEndpointSecret(
  principal: AosPrincipal,
  integrationId: string,
  options: WebhookEndpointServiceOptions,
): Promise<WebhookEndpointSecretResponse> {
  if (!database) throw serviceError("PERSISTENCE_UNAVAILABLE");
  if (!options.secretWriter) throw serviceError("WEBHOOK_SECRET_WRITER_UNAVAILABLE");
  const userId = localUserId(principal);
  if (!userId) throw serviceError("IDENTITY_NOT_RESOLVED");
  const current = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const access = await assertManageAccess(db, principal, integrationId);
    const [row] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.organizationId, principal.organizationId), eq(webhookEndpoints.integrationId, integrationId))).limit(1);
    if (!row) throw serviceError("WEBHOOK_ENDPOINT_NOT_FOUND");
    if (row.status === "disabled") throw serviceError("WEBHOOK_ENDPOINT_DISABLED");
    return { row, scope: access.integration.organizationUnitId };
  });
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  let secretRef: string;
  try {
    secretRef = await options.secretWriter.write({ organizationId: principal.organizationId, endpointId: current.row.id, endpointKey: current.row.endpointKey, secret });
  } catch {
    throw serviceError("WEBHOOK_SECRET_STORE_UNAVAILABLE");
  }
  const updated = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const [row] = await db.update(webhookEndpoints).set({ secretRef, status: "active", updatedAt: new Date() }).where(and(eq(webhookEndpoints.id, current.row.id), eq(webhookEndpoints.organizationId, principal.organizationId))).returning();
    if (!row) throw serviceError("WEBHOOK_ENDPOINT_UPDATE_FAILED");
    await auditEndpoint(db, { organizationId: principal.organizationId, actorUserId: userId, endpointId: row.id, action: "webhook_endpoint_secret_rotated", scope: [current.scope], status: row.status });
    return row;
  });
  return { endpoint: projectEndpoint(updated, options), secret };
}

export async function setWebhookEndpointStatus(
  principal: AosPrincipal,
  integrationId: string,
  status: "active" | "disabled",
  options: WebhookEndpointServiceOptions,
): Promise<WebhookEndpointProjection | null> {
  if (!database) throw serviceError("PERSISTENCE_UNAVAILABLE");
  const userId = localUserId(principal);
  if (!userId) throw serviceError("IDENTITY_NOT_RESOLVED");
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const access = await assertManageAccess(db, principal, integrationId);
    const [existing] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.organizationId, principal.organizationId), eq(webhookEndpoints.integrationId, integrationId))).limit(1);
    if (!existing) throw serviceError("WEBHOOK_ENDPOINT_NOT_FOUND");
    if (status === "active" && !existing.secretRef) throw serviceError("WEBHOOK_SECRET_UNAVAILABLE");
    const [row] = await db.update(webhookEndpoints).set({ status, updatedAt: new Date() }).where(and(eq(webhookEndpoints.id, existing.id), eq(webhookEndpoints.organizationId, principal.organizationId))).returning();
    if (!row) throw serviceError("WEBHOOK_ENDPOINT_UPDATE_FAILED");
    await auditEndpoint(db, { organizationId: principal.organizationId, actorUserId: userId, endpointId: row.id, action: status === "active" ? "webhook_endpoint_enabled" : "webhook_endpoint_disabled", scope: [access.integration.organizationUnitId], status: row.status });
    return projectEndpoint(row, options);
  });
}

export function isWebhookEndpointServiceError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof (error as Partial<{ code: string }>).code === "string";
}

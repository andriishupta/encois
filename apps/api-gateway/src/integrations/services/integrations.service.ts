import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { IntegrationStatus, Permission, resolveEffectiveScope, type IntegrationCreateRequest, type IntegrationProjection, type IntegrationUpdateRequest } from "@encois/contracts";
import {
  auditEvents,
  integrationAuthorizationStates,
  integrationBindings,
  integrations,
  membershipScopes,
  organizationMemberships,
  organizationUnits,
  type PersistenceTransaction,
  withOrganizationContext,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import { hasPermission } from "../../auth/authorization.js";
import { fetchCloudRunIdentityToken } from "../../security/cloud-run-identity-token.js";
import type { IntegrationAuthorizationAdapter, IntegrationAuthorizationAdapterResult, IntegrationAuthorizationCompleteResult } from "../authorization-adapter.js";

export type IntegrationSummary = IntegrationProjection;

export type IntegrationCreate = IntegrationCreateRequest;
export type IntegrationUpdate = IntegrationUpdateRequest;
export type IntegrationAuthorizationUpdate = {
  credentialRef: string;
  status?: Extract<IntegrationStatus, "authorized" | "active" | "degraded" | "needs_reauth" | "error">;
  lastError?: string;
};

export type IntegrationAuthorizationServiceOptions = {
  allowLocalCredentialReferences?: boolean;
};

export type IntegrationHealthUpdate = {
  integrationId: string;
  status: Extract<IntegrationStatus, "active" | "degraded" | "needs_reauth" | "error">;
  lastError?: string;
};

export type IntegrationAuthorizationStart = {
  integrationId: string;
  provider: string;
  status: IntegrationAuthorizationAdapterResult["status"];
  authorizationUrl?: string;
  expiresAt?: string;
};

export type IntegrationCredentialResolutionRequest = {
  provider: string;
  capabilities: readonly string[];
  integrationId?: string;
};

export type IntegrationCredentialResolution = {
  integrationId: string;
  provider: string;
  credentialRef: string;
};

type QueryDatabase = NonNullable<typeof database> | PersistenceTransaction;

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

function providerCapabilities(provider: string): readonly string[] {
  const normalized = provider.trim().toLowerCase();
  if (["github", "gitlab"].includes(normalized)) return ["code.read", "pull-requests.read", "activity.read"];
  if (["jira", "linear"].includes(normalized)) return ["issues.read", "activity.read"];
  if (["slack", "teams"].includes(normalized)) return ["messages.read", "activity.read"];
  if (["notion", "google-drive", "google-workspace", "confluence"].includes(normalized)) return ["documents.read"];
  return [];
}

/**
 * Private Agent Gateway boundary: resolve a logical provider capability to a
 * server-side Secret Manager reference. The browser and Temporal payloads do
 * not receive integration IDs or credentials; the current service principal
 * scope is the source of truth for visibility.
 */
export async function resolveIntegrationCredentialForService(
  principal: AosPrincipal,
  request: IntegrationCredentialResolutionRequest,
): Promise<IntegrationCredentialResolution | null> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");
  const provider = request.provider.trim().toLowerCase();
  const capabilities = [...new Set(request.capabilities.map((value) => value.trim()).filter(Boolean))];
  if (!provider || capabilities.length === 0 || !capabilities.every((capability) => providerCapabilities(provider).includes(capability))) return null;

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const filters = [
      eq(integrations.organizationId, principal.organizationId),
      eq(integrations.provider, provider),
      eq(integrations.status, "active" as const),
    ];
    if (request.integrationId) filters.push(eq(integrations.id, request.integrationId));
    const rows = await db
      .select({
        integrationId: integrations.id,
        provider: integrations.provider,
        credentialRef: integrations.credentialRef,
        displayName: integrations.displayName,
        organizationUnitId: integrationBindings.organizationUnitId,
        grantedScopes: integrationBindings.grantedScopes,
      })
      .from(integrations)
      .innerJoin(
        integrationBindings,
        and(
          eq(integrationBindings.integrationId, integrations.id),
          eq(integrationBindings.organizationId, principal.organizationId),
          eq(integrationBindings.status, "active"),
        ),
      )
      .where(and(...filters));

    const match = rows
      .filter((row) => Boolean(row.credentialRef))
      .filter((row) => principal.scope.includes("*") || principal.scope.includes(row.organizationUnitId))
      .filter((row) => capabilities.every((capability) => row.grantedScopes.includes(capability)))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))[0];
    return match?.credentialRef ? { integrationId: match.integrationId, provider: match.provider, credentialRef: match.credentialRef } : null;
  });
}

export type IntegrationHealthCheckServiceOptions = {
  agentGatewayUrl?: string;
  agentGatewayServiceToken?: string;
  agentGatewayAudience?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export type IntegrationHealthCheckResult = {
  checked: number;
  succeeded: number;
  failed: number;
};

/**
 * Invoked by a protected scheduler boundary. The API owns tenant inventory;
 * the Agent Gateway owns provider credentials and performs the actual probe.
 */
export async function runIntegrationHealthChecksForService(
  principal: AosPrincipal,
  integrationId: string | undefined,
  options: IntegrationHealthCheckServiceOptions,
): Promise<IntegrationHealthCheckResult> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");
  if (!options.agentGatewayUrl || !options.agentGatewayServiceToken) throw new Error("AGENT_GATEWAY_UNAVAILABLE");
  const fetchImpl = options.fetchImpl ?? fetch;
  const rows = await withOrganizationContext(database, principal.organizationId, async (db) => {
    const candidates = await db
      .select({ id: integrations.id, provider: integrations.provider })
      .from(integrations)
      .where(and(
        eq(integrations.organizationId, principal.organizationId),
        eq(integrations.status, IntegrationStatus.Active),
        isNotNull(integrations.credentialRef),
      ));
    return candidates.filter((row) => ["github", "jira"].includes(row.provider.toLowerCase()))
      .filter((row) => !integrationId || row.id === integrationId);
  });

  let succeeded = 0;
  for (const row of rows.slice(0, 50)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const identityToken = options.agentGatewayAudience ? await fetchCloudRunIdentityToken(options.agentGatewayAudience, fetchImpl) : undefined;
      const response = await fetchImpl(`${options.agentGatewayUrl.replace(/\/$/u, "")}/v1/provider-health/check`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Encois-Service-Token": options.agentGatewayServiceToken,
          "X-Organization-ID": principal.organizationId,
          ...(identityToken ? { Authorization: `Bearer ${identityToken}` } : {}),
        },
        body: JSON.stringify({ integrationId: row.id, provider: row.provider }),
        signal: controller.signal,
      });
      if (response.ok) succeeded += 1;
    } catch {
      // The Agent Gateway records provider-level failures. A transport failure
      // remains a failed scheduler result without exposing provider details.
    } finally {
      clearTimeout(timeout);
    }
  }
  return { checked: rows.slice(0, 50).length, succeeded, failed: rows.slice(0, 50).length - succeeded };
}

/**
 * Private Agent Gateway callback. Provider failures are persisted as
 * integration lifecycle state so the dashboard and future workflow
 * resolutions stop treating a broken connection as active.
 */
export async function reportIntegrationHealthForService(
  principal: AosPrincipal,
  update: IntegrationHealthUpdate,
): Promise<IntegrationSummary | null> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");
  const lastError = update.lastError?.trim() || null;

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const [existing] = await db
      .select({
        id: integrations.id,
        displayName: integrations.displayName,
        provider: integrations.provider,
      })
      .from(integrations)
      .where(and(eq(integrations.id, update.integrationId), eq(integrations.organizationId, principal.organizationId)))
      .limit(1);
    if (!existing) return null;

    const checkedAt = new Date();
    const [row] = await db
      .update(integrations)
      .set({
        status: update.status,
        lastHealthCheckAt: checkedAt,
        lastError: update.status === IntegrationStatus.Active ? null : lastError,
        updatedAt: checkedAt,
      })
      .where(and(eq(integrations.id, update.integrationId), eq(integrations.organizationId, principal.organizationId)))
      .returning();
    if (!row) return null;

    const bindings = await db
      .select({ organizationUnitId: integrationBindings.organizationUnitId, grantedScopes: integrationBindings.grantedScopes })
      .from(integrationBindings)
      .where(and(eq(integrationBindings.integrationId, update.integrationId), eq(integrationBindings.organizationId, principal.organizationId), eq(integrationBindings.status, "active")));
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: localUserId(principal),
      action: "integration_health_reported",
      outcome: "accepted",
      resourceType: "integration",
      resourceId: update.integrationId,
      scope: { ids: bindings.map((binding) => binding.organizationUnitId) },
      metadata: {
        provider: existing.provider,
        status: update.status,
        healthCheckedAt: checkedAt.toISOString(),
        ...(lastError ? { errorReported: true } : {}),
      },
    });

    return {
      id: row.id,
      name: row.displayName,
      provider: row.provider,
      status: row.status,
      scopeIds: [...new Set(bindings.map((binding) => binding.organizationUnitId))],
      grantedScopes: [...new Set(bindings.flatMap((binding) => binding.grantedScopes ?? []))],
      credentialConfigured: Boolean(row.credentialRef),
      ...(row.authorizedAt ? { authorizedAt: row.authorizedAt.toISOString() } : {}),
      ...(row.lastHealthCheckAt ? { lastHealthCheckAt: row.lastHealthCheckAt.toISOString() } : {}),
      ...(row.lastError ? { lastError: row.lastError } : {}),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function listIntegrationsForPrincipal(
  principal: AosPrincipal,
): Promise<readonly IntegrationSummary[]> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");

  const userId = localUserId(principal);
  if (!userId) return [];

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.IntegrationsRead))) return [];
    const rows = await accessibleIntegrations(db, principal.organizationId, userId, "read");
    const projections = new Map<string, IntegrationSummary>();
    for (const row of rows) {
      const previous = projections.get(row.id);
      projections.set(row.id, {
        id: row.id,
        name: row.displayName,
        provider: row.provider,
        status: row.status,
        scopeIds: [...new Set([...(previous?.scopeIds ?? []), row.organizationUnitId])],
        grantedScopes: [...new Set([...(previous?.grantedScopes ?? []), ...(row.grantedScopes ?? [])])],
        credentialConfigured: previous?.credentialConfigured || Boolean(row.credentialRef),
        ...(row.authorizedAt ? { authorizedAt: row.authorizedAt.toISOString() } : {}),
        ...(row.lastHealthCheckAt ? { lastHealthCheckAt: row.lastHealthCheckAt.toISOString() } : {}),
        ...(row.lastError ? { lastError: row.lastError } : {}),
        updatedAt: row.updatedAt.toISOString(),
      });
    }
    return [...projections.values()];
  });
}

export async function updateIntegrationForPrincipal(
  principal: AosPrincipal,
  integrationId: string,
  update: IntegrationUpdate,
): Promise<IntegrationSummary | null> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");

  const userId = localUserId(principal);
  if (!userId) return null;

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.IntegrationsManage))) return null;
    const accessible = await accessibleIntegrations(
      db,
      principal.organizationId,
      userId,
      "manage",
      integrationId,
    );
    if (accessible.length === 0) return null;
    if (update.status === IntegrationStatus.Active && !accessible.some((row) => row.status === IntegrationStatus.Active)) {
      throw new Error("INTEGRATION_HEALTH_CHECK_REQUIRED");
    }
    if ((update.status === "authorized" || update.status === "active") && !accessible.some((row) => Boolean(row.credentialRef))) {
      throw new Error("INTEGRATION_CREDENTIAL_REQUIRED");
    }

    const [row] = await db
      .update(integrations)
      .set({
        ...(update.displayName === undefined ? {} : { displayName: update.displayName }),
        ...(update.status === undefined ? {} : { status: update.status }),
        ...(update.status === IntegrationStatus.Active ? { lastError: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, principal.organizationId)))
      .returning({
        id: integrations.id,
        displayName: integrations.displayName,
        provider: integrations.provider,
        status: integrations.status,
        authorizedAt: integrations.authorizedAt,
        lastHealthCheckAt: integrations.lastHealthCheckAt,
        lastError: integrations.lastError,
        updatedAt: integrations.updatedAt,
      });

    if (row) {
      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: userId,
        action: "integration_updated",
        outcome: "accepted",
        resourceType: "integration",
        resourceId: integrationId,
        scope: { ids: accessible.map((item) => item.organizationUnitId) },
        metadata: { changedFields: Object.keys(update), status: row.status },
      });
    }

    return row
      ? {
          id: row.id,
          name: row.displayName,
          provider: row.provider,
          status: row.status,
          scopeIds: [...new Set(accessible.map((item) => item.organizationUnitId))],
          grantedScopes: [...new Set(accessible.flatMap((item) => item.grantedScopes ?? []))],
          credentialConfigured: accessible.some((item) => Boolean(item.credentialRef)),
          ...(row.authorizedAt ? { authorizedAt: row.authorizedAt.toISOString() } : {}),
          ...(row.lastHealthCheckAt ? { lastHealthCheckAt: row.lastHealthCheckAt.toISOString() } : {}),
          ...(row.lastError ? { lastError: row.lastError } : {}),
          updatedAt: row.updatedAt.toISOString(),
        }
      : null;
  });
}

function assertCredentialReference(value: string, options: IntegrationAuthorizationServiceOptions = {}): string {
  const reference = value.trim();
  const allowsLocal = options.allowLocalCredentialReferences ?? true;
  const pattern = allowsLocal ? /^(secretmanager|local):\/\/[^\s]+$/i : /^secretmanager:\/\/[^\s]+$/i;
  if (reference.length === 0 || reference.length > 1024 || /[\u0000-\u001f\u007f\s]/.test(reference) || !pattern.test(reference)) {
    throw new Error("INVALID_CREDENTIAL_REFERENCE");
  }
  return reference;
}

/**
 * Completes provider authorization from a trusted provider/Secret Manager
 * adapter. The browser never receives or submits the credential itself.
 */
export async function authorizeIntegrationForService(
  principal: AosPrincipal,
  integrationId: string,
  update: IntegrationAuthorizationUpdate,
  options: IntegrationAuthorizationServiceOptions = {},
): Promise<IntegrationSummary | null> {
  const credentialRef = assertCredentialReference(update.credentialRef, options);
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");
  const status = update.status ?? IntegrationStatus.Authorized;
  const lastError = update.lastError?.trim() || null;

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    const [existing] = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, principal.organizationId)))
      .limit(1);
    if (!existing) return null;

    const checkedAt = new Date();
    const [row] = await db
      .update(integrations)
      .set({
        credentialRef,
        status,
        authorizedAt: existing.authorizedAt ?? checkedAt,
        lastHealthCheckAt: checkedAt,
        lastError,
        updatedAt: checkedAt,
      })
      .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, principal.organizationId)))
      .returning();
    if (!row) return null;

    const bindings = await db
      .select({ organizationUnitId: integrationBindings.organizationUnitId, grantedScopes: integrationBindings.grantedScopes })
      .from(integrationBindings)
      .where(and(eq(integrationBindings.integrationId, integrationId), eq(integrationBindings.organizationId, principal.organizationId), eq(integrationBindings.status, "active")));
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: localUserId(principal),
      action: "integration_authorization_updated",
      outcome: "accepted",
      resourceType: "integration",
      resourceId: integrationId,
      scope: { ids: bindings.map((binding) => binding.organizationUnitId) },
      metadata: {
        status,
        credentialRefScheme: credentialRef.split(":", 1)[0],
        healthCheckedAt: checkedAt.toISOString(),
        ...(lastError ? { errorReported: true } : {}),
      },
    });

    return {
      id: row.id,
      name: row.displayName,
      provider: row.provider,
      status: row.status,
      scopeIds: [...new Set(bindings.map((binding) => binding.organizationUnitId))],
      grantedScopes: [...new Set(bindings.flatMap((binding) => binding.grantedScopes ?? []))],
      credentialConfigured: true,
      ...(row.authorizedAt ? { authorizedAt: row.authorizedAt.toISOString() } : {}),
      ...(row.lastHealthCheckAt ? { lastHealthCheckAt: row.lastHealthCheckAt.toISOString() } : {}),
      ...(row.lastError ? { lastError: row.lastError } : {}),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

function safeAuthorizationUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("INVALID_AUTHORIZATION_URL");
    return url.toString();
  } catch {
    throw new Error("INVALID_AUTHORIZATION_URL");
  }
}

export async function startIntegrationAuthorizationForPrincipal(
  principal: AosPrincipal,
  integrationId: string,
  adapter: IntegrationAuthorizationAdapter | undefined,
): Promise<IntegrationAuthorizationStart | null> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");
  if (!adapter) throw new Error("INTEGRATION_AUTHORIZATION_UNAVAILABLE");

  const userId = localUserId(principal);
  if (!userId) return null;
  const integration = await withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.IntegrationsManage))) return null;
    const rows = await accessibleIntegrations(db, principal.organizationId, userId, "manage", integrationId);
    const [first] = rows;
    if (!first) return null;
    return {
      id: first.id,
      provider: first.provider,
      scopeIds: [...new Set(rows.map((row) => row.organizationUnitId))],
      grantedScopes: [...new Set(rows.flatMap((row) => row.grantedScopes ?? []))],
    };
  });
  if (!integration) return null;

  let result: IntegrationAuthorizationAdapterResult;
  try {
    result = await adapter.start({
      integrationId: integration.id,
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      ...(principal.userId ? { userId: principal.userId } : {}),
      provider: integration.provider,
      scopeIds: integration.scopeIds,
      grantedScopes: integration.grantedScopes,
    });
  } catch {
    throw new Error("INTEGRATION_AUTHORIZATION_FAILED");
  }

  if (result.status === "redirect" && result.stateHash && result.expiresAt) {
    await withOrganizationContext(database, principal.organizationId, (db) => db.insert(integrationAuthorizationStates).values({
      organizationId: principal.organizationId,
      integrationId: integration.id,
      actorUserId: userId,
      provider: integration.provider,
      stateHash: result.stateHash!,
      expiresAt: new Date(result.expiresAt!),
    }));
  }

  const authorizationUrl = result.status === "redirect" ? safeAuthorizationUrl(result.authorizationUrl) : undefined;
  await withOrganizationContext(database, principal.organizationId, (db) => db.insert(auditEvents).values({
    organizationId: principal.organizationId,
    actorUserId: userId,
    action: "integration_authorization_started",
    outcome: "accepted",
    resourceType: "integration",
    resourceId: integration.id,
    scope: { ids: integration.scopeIds },
    metadata: {
      provider: integration.provider,
      status: result.status,
      ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
    },
  }));

  return {
    integrationId: integration.id,
    provider: integration.provider,
    status: result.status,
    ...(authorizationUrl ? { authorizationUrl } : {}),
    ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
  };
}

export async function completeIntegrationAuthorization(
  adapter: IntegrationAuthorizationAdapter | undefined,
  request: { code: string; state: string },
): Promise<IntegrationSummary | null> {
  if (!adapter?.complete) throw new Error("INTEGRATION_AUTHORIZATION_UNAVAILABLE");
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");

  let completed: IntegrationAuthorizationCompleteResult;
  try {
    completed = await adapter.complete(request);
  } catch {
    throw new Error("INTEGRATION_AUTHORIZATION_FAILED");
  }

  const now = new Date();
  const state = await withOrganizationContext(database, completed.organizationId, async (db) => {
    const [row] = await db
      .update(integrationAuthorizationStates)
      .set({ consumedAt: now })
      .where(and(
        eq(integrationAuthorizationStates.stateHash, completed.stateHash),
        eq(integrationAuthorizationStates.organizationId, completed.organizationId),
        eq(integrationAuthorizationStates.integrationId, completed.integrationId),
        eq(integrationAuthorizationStates.provider, completed.provider),
        isNull(integrationAuthorizationStates.consumedAt),
        gt(integrationAuthorizationStates.expiresAt, now),
      ))
      .returning({ actorUserId: integrationAuthorizationStates.actorUserId });
    return row;
  });
  if (!state) throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  if (completed.userId && state.actorUserId && completed.userId !== state.actorUserId) {
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  }

  return authorizeIntegrationForService(
    {
      actorId: completed.actorId,
      ...(completed.userId ? { userId: completed.userId } : state.actorUserId ? { userId: state.actorUserId } : {}),
      organizationId: completed.organizationId,
      scope: [],
    },
    completed.integrationId,
    { credentialRef: completed.credentialRef, status: completed.status ?? "authorized" },
  );
}

export async function createIntegrationForPrincipal(
  principal: AosPrincipal,
  request: IntegrationCreate,
): Promise<IntegrationSummary> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");
  const userId = localUserId(principal);
  if (!userId) throw new Error("IDENTITY_NOT_RESOLVED");
  const displayName = request.displayName.trim();
  const provider = request.provider.trim().toLowerCase();
  const unitId = request.organizationUnitId.trim();
  if (displayName.length < 2 || displayName.length > 160) throw new Error("INVALID_INTEGRATION_NAME");
  if (!provider || provider.length > 80) throw new Error("INVALID_INTEGRATION_PROVIDER");
  if (!unitId || !principal.scope.includes(unitId)) throw new Error("SCOPE_DENIED");

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.IntegrationsManage))) throw new Error("FORBIDDEN");
    const [unit] = await db
      .select({ id: organizationUnits.id })
      .from(organizationUnits)
      .where(and(eq(organizationUnits.id, unitId), eq(organizationUnits.organizationId, principal.organizationId)))
      .limit(1);
    if (!unit) throw new Error("SCOPE_DENIED");

    const [integration] = await db.insert(integrations).values({
      organizationId: principal.organizationId,
      provider,
      displayName,
      status: "pending",
      createdByUserId: userId,
    }).returning({ id: integrations.id, displayName: integrations.displayName, provider: integrations.provider, status: integrations.status, updatedAt: integrations.updatedAt });
    if (!integration) throw new Error("INTEGRATION_CREATE_FAILED");

    await db.insert(integrationBindings).values({
      organizationId: principal.organizationId,
      integrationId: integration.id,
      organizationUnitId: unitId,
      grantedScopes: request.grantedScopes ?? [],
      grantedByUserId: userId,
      status: "active",
    });
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: userId,
      action: "integration_registered",
      outcome: "accepted",
      resourceType: "integration",
      resourceId: integration.id,
      scope: { ids: [unitId] },
      metadata: { provider, status: "pending" },
    });
    return { id: integration.id, name: integration.displayName, provider: integration.provider, status: integration.status, scopeIds: [unitId], grantedScopes: request.grantedScopes ?? [], credentialConfigured: false, updatedAt: new Date().toISOString() };
  });
}

export async function accessibleIntegrations(
  db: QueryDatabase,
  organizationId: string,
  userId: string,
  access: "read" | "manage",
  integrationId?: string,
) {
  const [units, membershipScopeRows] = await Promise.all([
    db
      .select({ id: organizationUnits.id, parentId: organizationUnits.parentId, type: organizationUnits.type })
      .from(organizationUnits)
      .where(eq(organizationUnits.organizationId, organizationId)),
    db
      .select({ unitId: membershipScopes.organizationUnitId, access: membershipScopes.access })
      .from(membershipScopes)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.id, membershipScopes.membershipId),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .where(eq(membershipScopes.organizationId, organizationId)),
  ]);
  const directUnitIds = membershipScopeRows
    .filter((row) => access === "read" || row.access === "manager" || row.access === "admin")
    .map((row) => row.unitId);
  const resolvedScope = resolveEffectiveScope({
    units: units.map((unit) => ({ id: unit.id, ...(unit.parentId ? { parentId: unit.parentId } : {}), type: unit.type })),
    directUnitIds,
  }).resolvedUnitIds;
  if (resolvedScope.length === 0) return [];

  return db
    .selectDistinct({
      id: integrations.id,
      displayName: integrations.displayName,
      provider: integrations.provider,
      status: integrations.status,
      credentialRef: integrations.credentialRef,
      authorizedAt: integrations.authorizedAt,
      lastHealthCheckAt: integrations.lastHealthCheckAt,
      lastError: integrations.lastError,
      updatedAt: integrations.updatedAt,
      organizationUnitId: integrationBindings.organizationUnitId,
      grantedScopes: integrationBindings.grantedScopes,
    })
    .from(integrations)
    .innerJoin(
      integrationBindings,
      and(
        eq(integrationBindings.integrationId, integrations.id),
        eq(integrationBindings.organizationId, organizationId),
        eq(integrationBindings.status, "active"),
        inArray(integrationBindings.organizationUnitId, resolvedScope),
      ),
    )
    .where(
      and(
        eq(integrations.organizationId, organizationId),
        ...(integrationId ? [eq(integrations.id, integrationId)] : []),
      ),
    );
}

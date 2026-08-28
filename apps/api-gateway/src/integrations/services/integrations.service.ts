import {
  type IntegrationCatalogProjection,
  type IntegrationCreateRequest,
  type IntegrationProjection,
  IntegrationStatus,
  IntegrationType,
  type IntegrationUpdateRequest,
  Permission,
  resolveEffectiveScope,
} from "@encois/contracts";
import {
  auditEvents,
  type DatabaseTransaction,
  integrationAuthorizationStates,
  integrationBindings,
  integrationCatalog,
  integrations,
  membershipScopes,
  organizationMemberships,
  organizationUnits,
  withOrganizationContext,
} from "@encois/database";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import {
  hasPermission,
  isOrganizationAdministrator,
} from "../../auth/authorization.js";
import { database } from "../../database.js";
import {
  filterListPage,
  type ListPage,
  type ListQuery,
} from "../../list-query.js";
import type { AosPrincipal } from "../../middleware/aos.js";
import { fetchCloudRunIdentityToken } from "../../security/cloud-run-identity-token.js";
import {
  organizationScopeCovers,
  organizationScopesOverlap,
} from "../../security/organization-scope.js";
import type {
  IntegrationAuthorizationAdapter,
  IntegrationAuthorizationAdapterResult,
  IntegrationAuthorizationCompleteResult,
} from "../authorization-adapter.js";

export type IntegrationSummary = IntegrationProjection;
export type IntegrationCatalogSummary = IntegrationCatalogProjection;
export type IntegrationCatalogChannel = "api" | "ai";

export type IntegrationCreate = IntegrationCreateRequest;
export type IntegrationUpdate = IntegrationUpdateRequest;
export type IntegrationAuthorizationUpdate = {
  credentialRef: string;
  status?: Extract<
    IntegrationStatus,
    "authorized" | "active" | "degraded" | "needs_reauth" | "error"
  >;
  lastError?: string;
};

export type IntegrationAuthorizationServiceOptions = {
  allowLocalCredentialReferences?: boolean;
};

export type IntegrationHealthUpdate = {
  integrationId: string;
  status: Extract<
    IntegrationStatus,
    "active" | "degraded" | "needs_reauth" | "error"
  >;
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

type QueryDatabase = NonNullable<typeof database> | DatabaseTransaction;

function localUserId(principal: AosPrincipal): string | null {
  const candidate = principal.userId ?? principal.actorId;
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

function providerCapabilities(provider: string): readonly string[] {
  const normalized = provider.trim().toLowerCase();
  if (["github", "gitlab"].includes(normalized))
    return ["code.read", "pull-requests.read", "activity.read"];
  if (["jira", "linear"].includes(normalized))
    return ["issues.read", "activity.read"];
  if (["slack", "teams"].includes(normalized))
    return ["messages.read", "activity.read"];
  if (
    ["notion", "google-drive", "google-workspace", "confluence"].includes(
      normalized,
    )
  )
    return ["documents.read"];
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
  if (!database) throw new Error("DATABASE_UNAVAILABLE");
  const provider = request.provider.trim().toLowerCase();
  const capabilities = [
    ...new Set(
      request.capabilities.map((value) => value.trim()).filter(Boolean),
    ),
  ];
  if (
    !provider ||
    capabilities.length === 0 ||
    !capabilities.every((capability) =>
      providerCapabilities(provider).includes(capability),
    )
  )
    return null;

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const userId = localUserId(principal);
      if (
        !userId ||
        !(await hasPermission(db, principal, Permission.IntegrationsRead))
      )
        return null;
      const filters = [
        eq(integrations.organizationId, principal.organizationId),
        eq(integrations.provider, provider),
        eq(integrations.status, "active" as const),
      ];
      if (request.integrationId)
        filters.push(eq(integrations.id, request.integrationId));
      const [units, rows, organizationWide] = await Promise.all([
        db
          .select({
            id: organizationUnits.id,
            parentId: organizationUnits.parentId,
            type: organizationUnits.type,
          })
          .from(organizationUnits)
          .where(
            eq(organizationUnits.organizationId, principal.organizationId),
          ),
        db
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
          .where(and(...filters)),
        isOrganizationAdministrator(db, principal),
      ]);

      const resolverScope = organizationWide
        ? units.map((unit) => unit.id)
        : principal.scope;
      const match = rows
        .filter((row) => Boolean(row.credentialRef))
        .filter((row) =>
          organizationScopesOverlap(
            units,
            [row.organizationUnitId],
            resolverScope,
          ),
        )
        .filter((row) =>
          capabilities.every((capability) =>
            row.grantedScopes.includes(capability),
          ),
        )
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        )[0];
      return match?.credentialRef
        ? {
            integrationId: match.integrationId,
            provider: match.provider,
            credentialRef: match.credentialRef,
          }
        : null;
    },
  );
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
  if (!database) throw new Error("DATABASE_UNAVAILABLE");
  if (!options.agentGatewayUrl || !options.agentGatewayServiceToken)
    throw new Error("AGENT_GATEWAY_UNAVAILABLE");
  const fetchImpl = options.fetchImpl ?? fetch;
  const rows = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      const userId = localUserId(principal);
      if (
        !userId ||
        !(await hasPermission(db, principal, Permission.IntegrationsRead))
      )
        throw new Error("FORBIDDEN");
      const organizationWide = await isOrganizationAdministrator(db, principal);
      const accessible = await accessibleIntegrations(
        db,
        principal.organizationId,
        userId,
        "read",
        integrationId,
        undefined,
        organizationWide,
      );
      const accessibleIds = new Set(accessible.map((row) => row.id));
      const candidates = await db
        .select({ id: integrations.id, provider: integrations.provider })
        .from(integrations)
        .where(
          and(
            eq(integrations.organizationId, principal.organizationId),
            eq(integrations.status, IntegrationStatus.Active),
            isNotNull(integrations.credentialRef),
          ),
        );
      return candidates
        .filter((row) => accessibleIds.has(row.id))
        .filter((row) =>
          ["github", "jira"].includes(row.provider.toLowerCase()),
        )
        .filter((row) => !integrationId || row.id === integrationId);
    },
  );

  let succeeded = 0;
  for (const row of rows.slice(0, 50)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const identityToken = options.agentGatewayAudience
        ? await fetchCloudRunIdentityToken(
            options.agentGatewayAudience,
            fetchImpl,
          )
        : undefined;
      const response = await fetchImpl(
        `${options.agentGatewayUrl.replace(/\/$/u, "")}/v1/provider-health/check`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Encois-Service-Token": options.agentGatewayServiceToken,
            "X-Organization-ID": principal.organizationId,
            ...(identityToken
              ? { Authorization: `Bearer ${identityToken}` }
              : {}),
          },
          body: JSON.stringify({
            integrationId: row.id,
            provider: row.provider,
          }),
          signal: controller.signal,
        },
      );
      if (response.ok) succeeded += 1;
    } catch {
      // The Agent Gateway records provider-level failures. A transport failure
      // remains a failed scheduler result without exposing provider details.
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    checked: rows.slice(0, 50).length,
    succeeded,
    failed: rows.slice(0, 50).length - succeeded,
  };
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
  if (!database) throw new Error("DATABASE_UNAVAILABLE");
  const lastError = update.lastError?.trim() || null;

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (
        !(await canManageIntegrationForPrincipal(
          db,
          principal,
          update.integrationId,
        ))
      )
        return null;
      const [existing] = await db
        .select({
          id: integrations.id,
          displayName: integrations.displayName,
          provider: integrations.provider,
        })
        .from(integrations)
        .where(
          and(
            eq(integrations.id, update.integrationId),
            eq(integrations.organizationId, principal.organizationId),
          ),
        )
        .limit(1);
      if (!existing) return null;

      const checkedAt = new Date();
      const [row] = await db
        .update(integrations)
        .set({
          status: update.status,
          lastHealthCheckAt: checkedAt,
          lastError:
            update.status === IntegrationStatus.Active ? null : lastError,
          updatedAt: checkedAt,
        })
        .where(
          and(
            eq(integrations.id, update.integrationId),
            eq(integrations.organizationId, principal.organizationId),
          ),
        )
        .returning();
      if (!row) return null;

      const bindings = await db
        .select({
          organizationUnitId: integrationBindings.organizationUnitId,
          grantedScopes: integrationBindings.grantedScopes,
        })
        .from(integrationBindings)
        .where(
          and(
            eq(integrationBindings.integrationId, update.integrationId),
            eq(integrationBindings.organizationId, principal.organizationId),
            eq(integrationBindings.status, "active"),
          ),
        );
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
        type: row.type,
        status: row.status,
        scopeIds: [
          ...new Set(bindings.map((binding) => binding.organizationUnitId)),
        ],
        grantedScopes: [
          ...new Set(
            bindings.flatMap((binding) => binding.grantedScopes ?? []),
          ),
        ],
        credentialConfigured: Boolean(row.credentialRef),
        ...(row.authorizedAt
          ? { authorizedAt: row.authorizedAt.toISOString() }
          : {}),
        ...(row.lastHealthCheckAt
          ? { lastHealthCheckAt: row.lastHealthCheckAt.toISOString() }
          : {}),
        ...(row.lastError ? { lastError: row.lastError } : {}),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );
}

export async function listIntegrationsForPrincipal(
  principal: AosPrincipal,
  options: { scopeUnitId?: string } = {},
): Promise<readonly IntegrationSummary[]> {
  if (!database) throw new Error("DATABASE_UNAVAILABLE");

  const userId = localUserId(principal);
  if (!userId) return [];

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.IntegrationsRead)))
        return [];
      const organizationWide = await isOrganizationAdministrator(db, principal);
      const rows = await accessibleIntegrations(
        db,
        principal.organizationId,
        userId,
        "read",
        undefined,
        options.scopeUnitId,
        organizationWide,
      );
      const projections = new Map<string, IntegrationSummary>();
      for (const row of rows) {
        const previous = projections.get(row.id);
        projections.set(row.id, {
          id: row.id,
          name: row.displayName,
          provider: row.provider,
          type: row.type,
          status: row.status,
          scopeIds: [
            ...new Set([...(previous?.scopeIds ?? []), row.organizationUnitId]),
          ],
          grantedScopes: [
            ...new Set([
              ...(previous?.grantedScopes ?? []),
              ...(row.grantedScopes ?? []),
            ]),
          ],
          credentialConfigured:
            previous?.credentialConfigured || Boolean(row.credentialRef),
          ...(row.authorizedAt
            ? { authorizedAt: row.authorizedAt.toISOString() }
            : {}),
          ...(row.lastHealthCheckAt
            ? { lastHealthCheckAt: row.lastHealthCheckAt.toISOString() }
            : {}),
          ...(row.lastError ? { lastError: row.lastError } : {}),
          updatedAt: row.updatedAt.toISOString(),
        });
      }
      return [...projections.values()];
    },
  );
}

export async function listIntegrationsPageForPrincipal(
  principal: AosPrincipal,
  options: { scopeUnitId?: string; query: ListQuery },
): Promise<ListPage<IntegrationSummary>> {
  const integrations = await listIntegrationsForPrincipal(principal, {
    scopeUnitId: options.scopeUnitId,
  });
  return filterListPage(integrations, options.query, {
    matches: (integration, query) =>
      [integration.name, integration.provider, integration.status].some(
        (value) => value.toLowerCase().includes(query),
      ),
    getStatus: (integration) => integration.status,
    compare: compareIntegrations,
  });
}

export async function listIntegrationCatalogPageForPrincipal(
  principal: AosPrincipal,
  options: {
    channel?: IntegrationCatalogChannel;
    type?: IntegrationType;
    query: ListQuery;
  },
): Promise<ListPage<IntegrationCatalogSummary>> {
  if (!database) throw new Error("DATABASE_UNAVAILABLE");

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.IntegrationsRead)))
        return filterListPage([], options.query, {});

      const rows = await db
        .select()
        .from(integrationCatalog)
        .orderBy(integrationCatalog.sortOrder);
      const catalog = rows.map<IntegrationCatalogSummary>((row) => ({
        key: row.key,
        provider: row.provider,
        name: row.displayName,
        description: row.description,
        type: row.type,
        status: row.status,
        capabilities: row.capabilities,
        updatedAt: row.updatedAt.toISOString(),
      }));
      const channelCatalog = catalog.filter((item) =>
        options.channel === "api"
          ? item.type === IntegrationType.Api ||
            item.type === IntegrationType.Custom
          : options.channel === "ai"
            ? item.type === IntegrationType.Ai ||
              item.type === IntegrationType.Mcp
            : true,
      );
      const filteredCatalog = options.type
        ? channelCatalog.filter((item) => item.type === options.type)
        : channelCatalog;
      return filterListPage(filteredCatalog, options.query, {
        matches: (item, query) =>
          [
            item.key,
            item.name,
            item.provider,
            item.description,
            item.type,
            ...item.capabilities,
          ].some((value) => value.toLowerCase().includes(query)),
        getStatus: (item) => item.status,
        compare: compareIntegrationCatalog,
      });
    },
  );
}

function compareIntegrationCatalog(
  left: IntegrationCatalogSummary,
  right: IntegrationCatalogSummary,
  sort: ListQuery["sort"],
): number {
  const statusRank = (status: IntegrationCatalogSummary["status"]) =>
    status === "active" ? 0 : status === "pending" ? 1 : 2;
  if (sort === "status")
    return (
      statusRank(left.status) - statusRank(right.status) ||
      left.name.localeCompare(right.name)
    );
  if (sort === "name-asc") return left.name.localeCompare(right.name);
  return (
    statusRank(left.status) - statusRank(right.status) ||
    left.name.localeCompare(right.name)
  );
}

function compareIntegrations(
  left: IntegrationSummary,
  right: IntegrationSummary,
  sort: ListQuery["sort"],
): number {
  if (sort === "name-asc") return left.name.localeCompare(right.name);
  if (sort === "status")
    return (
      left.status.localeCompare(right.status) ||
      left.name.localeCompare(right.name)
    );
  const comparison = (left.updatedAt ?? "").localeCompare(
    right.updatedAt ?? "",
  );
  return sort === "updated-asc" ? comparison : -comparison;
}

export async function updateIntegrationForPrincipal(
  principal: AosPrincipal,
  integrationId: string,
  update: IntegrationUpdate,
): Promise<IntegrationSummary | null> {
  if (!database) throw new Error("DATABASE_UNAVAILABLE");

  const userId = localUserId(principal);
  if (!userId) return null;

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.IntegrationsManage)))
        return null;
      const organizationWide = await isOrganizationAdministrator(db, principal);
      const accessible = await accessibleIntegrations(
        db,
        principal.organizationId,
        userId,
        "manage",
        integrationId,
        undefined,
        organizationWide,
      );
      if (accessible.length === 0) return null;
      const [row] = await db
        .update(integrations)
        .set({
          ...(update.displayName === undefined
            ? {}
            : { displayName: update.displayName }),
          ...(update.status === undefined ? {} : { status: update.status }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrations.id, integrationId),
            eq(integrations.organizationId, principal.organizationId),
          ),
        )
        .returning({
          id: integrations.id,
          displayName: integrations.displayName,
          provider: integrations.provider,
          type: integrations.type,
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
            type: row.type,
            status: row.status,
            scopeIds: [
              ...new Set(accessible.map((item) => item.organizationUnitId)),
            ],
            grantedScopes: [
              ...new Set(
                accessible.flatMap((item) => item.grantedScopes ?? []),
              ),
            ],
            credentialConfigured: accessible.some((item) =>
              Boolean(item.credentialRef),
            ),
            ...(row.authorizedAt
              ? { authorizedAt: row.authorizedAt.toISOString() }
              : {}),
            ...(row.lastHealthCheckAt
              ? { lastHealthCheckAt: row.lastHealthCheckAt.toISOString() }
              : {}),
            ...(row.lastError ? { lastError: row.lastError } : {}),
            updatedAt: row.updatedAt.toISOString(),
          }
        : null;
    },
  );
}

function assertCredentialReference(
  value: string,
  options: IntegrationAuthorizationServiceOptions = {},
): string {
  const reference = value.trim();
  const allowsLocal = options.allowLocalCredentialReferences ?? true;
  const pattern = allowsLocal
    ? /^(secretmanager|local):\/\/[^\s]+$/i
    : /^secretmanager:\/\/[^\s]+$/i;
  if (
    reference.length === 0 ||
    reference.length > 1024 ||
    hasControlOrWhitespace(reference) ||
    !pattern.test(reference)
  ) {
    throw new Error("INVALID_CREDENTIAL_REFERENCE");
  }
  return reference;
}

function hasControlOrWhitespace(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f || /\s/u.test(character);
  });
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
  const credentialRef = assertCredentialReference(
    update.credentialRef,
    options,
  );
  if (!database) throw new Error("DATABASE_UNAVAILABLE");
  const status = update.status ?? IntegrationStatus.Authorized;
  const lastError = update.lastError?.trim() || null;

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (
        !(await canManageIntegrationForPrincipal(db, principal, integrationId))
      )
        return null;
      const [existing] = await db
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.id, integrationId),
            eq(integrations.organizationId, principal.organizationId),
          ),
        )
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
        .where(
          and(
            eq(integrations.id, integrationId),
            eq(integrations.organizationId, principal.organizationId),
          ),
        )
        .returning();
      if (!row) return null;

      const bindings = await db
        .select({
          organizationUnitId: integrationBindings.organizationUnitId,
          grantedScopes: integrationBindings.grantedScopes,
        })
        .from(integrationBindings)
        .where(
          and(
            eq(integrationBindings.integrationId, integrationId),
            eq(integrationBindings.organizationId, principal.organizationId),
            eq(integrationBindings.status, "active"),
          ),
        );
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
        type: row.type,
        status: row.status,
        scopeIds: [
          ...new Set(bindings.map((binding) => binding.organizationUnitId)),
        ],
        grantedScopes: [
          ...new Set(
            bindings.flatMap((binding) => binding.grantedScopes ?? []),
          ),
        ],
        credentialConfigured: true,
        ...(row.authorizedAt
          ? { authorizedAt: row.authorizedAt.toISOString() }
          : {}),
        ...(row.lastHealthCheckAt
          ? { lastHealthCheckAt: row.lastHealthCheckAt.toISOString() }
          : {}),
        ...(row.lastError ? { lastError: row.lastError } : {}),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );
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
  if (!database) throw new Error("DATABASE_UNAVAILABLE");
  if (!adapter) throw new Error("INTEGRATION_AUTHORIZATION_UNAVAILABLE");

  const userId = localUserId(principal);
  if (!userId) return null;
  const integration = await withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (!(await hasPermission(db, principal, Permission.IntegrationsManage)))
        return null;
      const organizationWide = await isOrganizationAdministrator(db, principal);
      const rows = await accessibleIntegrations(
        db,
        principal.organizationId,
        userId,
        "manage",
        integrationId,
        undefined,
        organizationWide,
      );
      const [first] = rows;
      if (!first) return null;
      return {
        id: first.id,
        provider: first.provider,
        scopeIds: [...new Set(rows.map((row) => row.organizationUnitId))],
        grantedScopes: [
          ...new Set(rows.flatMap((row) => row.grantedScopes ?? [])),
        ],
      };
    },
  );
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

  const stateHash = result.status === "redirect" ? result.stateHash : undefined;
  const expiresAt = result.status === "redirect" ? result.expiresAt : undefined;
  if (stateHash && expiresAt) {
    await withOrganizationContext(database, principal.organizationId, (db) =>
      db.insert(integrationAuthorizationStates).values({
        organizationId: principal.organizationId,
        integrationId: integration.id,
        actorUserId: userId,
        provider: integration.provider,
        stateHash,
        expiresAt: new Date(expiresAt),
      }),
    );
  }

  const authorizationUrl =
    result.status === "redirect"
      ? safeAuthorizationUrl(result.authorizationUrl)
      : undefined;
  await withOrganizationContext(database, principal.organizationId, (db) =>
    db.insert(auditEvents).values({
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
    }),
  );

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
  if (!adapter?.complete || !adapter.inspectState)
    throw new Error("INTEGRATION_AUTHORIZATION_UNAVAILABLE");
  if (!database) throw new Error("DATABASE_UNAVAILABLE");

  let inspected: Awaited<
    ReturnType<NonNullable<IntegrationAuthorizationAdapter["inspectState"]>>
  >;
  try {
    inspected = await adapter.inspectState(request);
  } catch {
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  }

  const now = new Date();
  const pendingState = await withOrganizationContext(
    database,
    inspected.organizationId,
    async (db) => {
      const [row] = await db
        .select({ actorUserId: integrationAuthorizationStates.actorUserId })
        .from(integrationAuthorizationStates)
        .where(
          and(
            eq(integrationAuthorizationStates.stateHash, inspected.stateHash),
            eq(
              integrationAuthorizationStates.organizationId,
              inspected.organizationId,
            ),
            eq(
              integrationAuthorizationStates.integrationId,
              inspected.integrationId,
            ),
            eq(integrationAuthorizationStates.provider, inspected.provider),
            isNull(integrationAuthorizationStates.consumedAt),
            gt(integrationAuthorizationStates.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row) return null;
      const actorUserId = row.actorUserId ?? inspected.userId;
      if (!actorUserId) return null;
      const callbackPrincipal: AosPrincipal = {
        actorId: inspected.actorId,
        userId: actorUserId,
        organizationId: inspected.organizationId,
        scope: [],
      };
      if (
        !(await canManageIntegrationForPrincipal(
          db,
          callbackPrincipal,
          inspected.integrationId,
        ))
      )
        return false;
      return { actorUserId };
    },
  );
  if (pendingState === false) throw new Error("FORBIDDEN");
  if (!pendingState) throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  if (inspected.userId && inspected.userId !== pendingState.actorUserId) {
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  }

  let completed: IntegrationAuthorizationCompleteResult;
  try {
    completed = await adapter.complete(request);
  } catch {
    throw new Error("INTEGRATION_AUTHORIZATION_FAILED");
  }
  if (
    completed.stateHash !== inspected.stateHash ||
    completed.integrationId !== inspected.integrationId ||
    completed.organizationId !== inspected.organizationId ||
    completed.provider !== inspected.provider ||
    completed.actorId !== inspected.actorId ||
    (completed.userId ?? pendingState.actorUserId) !== pendingState.actorUserId
  ) {
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  }

  const completionNow = new Date();
  const state = await withOrganizationContext(
    database,
    inspected.organizationId,
    async (db) => {
      const callbackPrincipal: AosPrincipal = {
        actorId: inspected.actorId,
        userId: pendingState.actorUserId,
        organizationId: inspected.organizationId,
        scope: [],
      };
      if (
        !(await canManageIntegrationForPrincipal(
          db,
          callbackPrincipal,
          inspected.integrationId,
        ))
      )
        return null;
      const [row] = await db
        .update(integrationAuthorizationStates)
        .set({ consumedAt: completionNow })
        .where(
          and(
            eq(integrationAuthorizationStates.stateHash, inspected.stateHash),
            eq(
              integrationAuthorizationStates.organizationId,
              inspected.organizationId,
            ),
            eq(
              integrationAuthorizationStates.integrationId,
              inspected.integrationId,
            ),
            eq(integrationAuthorizationStates.provider, inspected.provider),
            eq(
              integrationAuthorizationStates.actorUserId,
              pendingState.actorUserId,
            ),
            isNull(integrationAuthorizationStates.consumedAt),
            gt(integrationAuthorizationStates.expiresAt, completionNow),
          ),
        )
        .returning({ actorUserId: integrationAuthorizationStates.actorUserId });
      return row;
    },
  );
  if (!state) throw new Error("FORBIDDEN");

  return authorizeIntegrationForService(
    {
      actorId: inspected.actorId,
      userId: pendingState.actorUserId,
      organizationId: inspected.organizationId,
      scope: [],
    },
    inspected.integrationId,
    {
      credentialRef: completed.credentialRef,
      status: completed.status ?? "authorized",
    },
  );
}

export async function createIntegrationForPrincipal(
  principal: AosPrincipal,
  request: IntegrationCreate,
): Promise<IntegrationSummary> {
  if (!database) throw new Error("DATABASE_UNAVAILABLE");
  const userId = localUserId(principal);
  if (!userId) throw new Error("IDENTITY_NOT_RESOLVED");
  const displayName = request.displayName.trim();
  const provider = request.provider.trim().toLowerCase();
  const type = request.type ?? IntegrationType.Api;
  if (displayName.length < 2 || displayName.length > 160)
    throw new Error("INVALID_INTEGRATION_NAME");
  if (!provider || provider.length > 80)
    throw new Error("INVALID_INTEGRATION_PROVIDER");
  if (!Object.values(IntegrationType).includes(type))
    throw new Error("INVALID_INTEGRATION_TYPE");

  return withOrganizationContext(
    database,
    principal.organizationId,
    async (db) => {
      if (
        !(await hasPermission(db, principal, Permission.IntegrationsManage)) ||
        !(await isOrganizationAdministrator(db, principal))
      )
        throw new Error("FORBIDDEN");
      const units = await db
        .select({
          id: organizationUnits.id,
          parentId: organizationUnits.parentId,
          type: organizationUnits.type,
        })
        .from(organizationUnits)
        .where(eq(organizationUnits.organizationId, principal.organizationId));
      const rootUnit = units.find(
        (unit) => unit.type === "organization" && unit.parentId === null,
      );
      if (!rootUnit) throw new Error("ORGANIZATION_ROOT_NOT_FOUND");
      const [integration] = await db
        .insert(integrations)
        .values({
          organizationId: principal.organizationId,
          provider,
          type,
          displayName,
          status: "pending",
          createdByUserId: userId,
        })
        .returning({
          id: integrations.id,
          displayName: integrations.displayName,
          provider: integrations.provider,
          type: integrations.type,
          status: integrations.status,
          updatedAt: integrations.updatedAt,
        });
      if (!integration) throw new Error("INTEGRATION_CREATE_FAILED");

      await db.insert(integrationBindings).values({
        organizationId: principal.organizationId,
        integrationId: integration.id,
        organizationUnitId: rootUnit.id,
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
        scope: { ids: [rootUnit.id] },
        metadata: { provider, status: "pending", scopeLevel: "organization" },
      });
      return {
        id: integration.id,
        name: integration.displayName,
        provider: integration.provider,
        type: integration.type,
        status: integration.status,
        scopeIds: [rootUnit.id],
        grantedScopes: request.grantedScopes ?? [],
        credentialConfigured: false,
        updatedAt: new Date().toISOString(),
      };
    },
  );
}

export async function accessibleIntegrations(
  db: QueryDatabase,
  organizationId: string,
  userId: string,
  access: "read" | "manage",
  integrationId?: string,
  scopeUnitId?: string,
  organizationWide = false,
) {
  const [units, membershipScopeRows] = await Promise.all([
    db
      .select({
        id: organizationUnits.id,
        parentId: organizationUnits.parentId,
        type: organizationUnits.type,
      })
      .from(organizationUnits)
      .where(eq(organizationUnits.organizationId, organizationId)),
    db
      .select({
        unitId: membershipScopes.organizationUnitId,
        access: membershipScopes.access,
      })
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
  const directUnitIds = organizationWide
    ? units.map((unit) => unit.id)
    : membershipScopeRows
        .filter(
          (row) =>
            access === "read" ||
            row.access === "manager" ||
            row.access === "admin",
        )
        .map((row) => row.unitId);
  const resolvedScope = resolveEffectiveScope({
    units: units.map((unit) => ({
      id: unit.id,
      ...(unit.parentId ? { parentId: unit.parentId } : {}),
      type: unit.type,
    })),
    directUnitIds,
  }).resolvedUnitIds;
  if (resolvedScope.length === 0) return [];
  if (
    scopeUnitId &&
    !organizationScopeCovers(units, resolvedScope, [scopeUnitId])
  )
    throw new Error("SCOPE_DENIED");

  const rows = await db
    .selectDistinct({
      id: integrations.id,
      displayName: integrations.displayName,
      provider: integrations.provider,
      type: integrations.type,
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
      ),
    )
    .where(
      and(
        eq(integrations.organizationId, organizationId),
        ...(integrationId ? [eq(integrations.id, integrationId)] : []),
      ),
    );
  const visibleRows = rows.filter((row) => {
    const principalCanRead =
      access === "read"
        ? organizationScopesOverlap(
            units,
            [row.organizationUnitId],
            resolvedScope,
          )
        : resolvedScope.includes(row.organizationUnitId);
    const selectedScopeMatches =
      !scopeUnitId ||
      organizationScopesOverlap(units, [row.organizationUnitId], [scopeUnitId]);
    return principalCanRead && selectedScopeMatches;
  });
  if (access !== "manage" || organizationWide) return visibleRows;

  const bindingUnitsByIntegration = new Map<string, string[]>();
  for (const row of rows) {
    const bindingUnits = bindingUnitsByIntegration.get(row.id) ?? [];
    bindingUnits.push(row.organizationUnitId);
    bindingUnitsByIntegration.set(row.id, bindingUnits);
  }
  return visibleRows.filter((row) => {
    const bindingUnits = bindingUnitsByIntegration.get(row.id) ?? [];
    return (
      bindingUnits.length > 0 &&
      bindingUnits.every((unitId) => resolvedScope.includes(unitId))
    );
  });
}

async function canManageIntegrationForPrincipal(
  db: QueryDatabase,
  principal: AosPrincipal,
  integrationId: string,
): Promise<boolean> {
  const userId = localUserId(principal);
  if (
    !userId ||
    !(await hasPermission(db, principal, Permission.IntegrationsManage))
  )
    return false;
  const organizationWide = await isOrganizationAdministrator(db, principal);
  return (
    (
      await accessibleIntegrations(
        db,
        principal.organizationId,
        userId,
        "manage",
        integrationId,
        undefined,
        organizationWide,
      )
    ).length > 0
  );
}

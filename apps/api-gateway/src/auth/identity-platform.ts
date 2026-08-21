import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { and, eq } from "drizzle-orm";
import { resolveEffectiveScope, type OrganizationUnitNode } from "@encois/contracts";
import { membershipScopes, organizationMemberships, organizationUnits, users, withOrganizationContext, type PersistenceTransaction } from "@encois/persistence";
import type { Context } from "hono";
import type { AosAuthenticationResult, AosAuthenticator, AosPrincipal, GatewayEnv } from "../middleware/aos.js";
import { database } from "../database.js";

export type IdentityPlatformIdentity = {
  email?: string;
  emailVerified: boolean;
  identityProvider: string;
  subject: string;
  tenantId?: string;
};

export type IdentityPlatformAuthenticatorOptions = {
  checkRevoked?: boolean;
  projectId: string;
  resolvePrincipal: (identity: IdentityPlatformIdentity, context: Context<GatewayEnv>) => Promise<AosPrincipal | null>;
};

function bearerToken(context: Context<GatewayEnv>): string | null {
  const header = context.req.header("Authorization");
  if (!header) return null;

  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function identityFromToken(token: DecodedIdToken): IdentityPlatformIdentity {
  const firebase = token.firebase as { identities?: Record<string, unknown>; sign_in_provider?: string } | undefined;
  const identityProvider = firebase?.sign_in_provider ?? "identity-platform";

  return {
    email: typeof token.email === "string" ? token.email : undefined,
    emailVerified: token.email_verified === true,
    identityProvider,
    subject: token.uid,
    tenantId: typeof token.firebase?.tenant === "string" ? token.firebase.tenant : undefined,
  };
}

export function createIdentityPlatformAuthenticator(
  options: IdentityPlatformAuthenticatorOptions,
): AosAuthenticator {
  const app =
    getApps().find((candidate) => candidate.options.projectId === options.projectId) ??
    initializeApp({
      credential: applicationDefault(),
      projectId: options.projectId,
    }, `identity-platform-${options.projectId}`);
  const auth = getAuth(app);

  return async (context): Promise<AosAuthenticationResult> => {
    const token = bearerToken(context);
    if (!token) {
      return { reason: "missing_bearer_token", status: "unauthenticated" };
    }

    try {
      const decodedToken = await auth.verifyIdToken(token, options.checkRevoked ?? false);
      const principal = await options.resolvePrincipal(identityFromToken(decodedToken), context);

      return principal
        ? { principal, status: "authenticated" }
        : { reason: "identity_has_no_active_membership", status: "unauthenticated" };
    } catch {
      return { reason: "invalid_identity_platform_token", status: "unauthenticated" };
    }
  };
}

export type InternalServiceAuthenticatorOptions = {
  serviceToken: string;
  serviceUserId?: string;
};

async function resolveOrganizationScope(
  db: PersistenceTransaction,
  organizationId: string,
  membershipId: string,
): Promise<readonly string[]> {
  const [units, directScopes] = await Promise.all([
    db
      .select({ id: organizationUnits.id, parentId: organizationUnits.parentId, type: organizationUnits.type, slug: organizationUnits.slug })
      .from(organizationUnits)
      .where(eq(organizationUnits.organizationId, organizationId)),
    db
      .select({ unitId: membershipScopes.organizationUnitId })
      .from(membershipScopes)
      .where(and(eq(membershipScopes.membershipId, membershipId), eq(membershipScopes.organizationId, organizationId))),
  ]);

  // Direct membership scopes currently act as roots. Explicit grants and
  // restrictions have a typed domain boundary, but their persistence table is
  // intentionally deferred until the control-plane permission UI is needed.
  const effective = resolveEffectiveScope({
    units: units.map((unit) => ({
      id: unit.id,
      ...(unit.parentId ? { parentId: unit.parentId } : {}),
      type: unit.type as OrganizationUnitNode["type"],
    })),
    directUnitIds: directScopes.map((scope) => scope.unitId),
  });
  const resolved = new Set(effective.resolvedUnitIds);
  return units.filter((unit) => resolved.has(unit.id)).flatMap((unit) => [unit.id, unit.slug]);
}

/**
 * Authenticates the private Runtime -> Gateway control-plane boundary. In a
 * database-backed environment the configured service user must have an active
 * organization membership, and its scopes are loaded from persistence. The
 * header scope fallback exists only for the database-free local scaffold.
 */
export function createInternalServiceAuthenticator(options: InternalServiceAuthenticatorOptions): AosAuthenticator {
  return async (context): Promise<AosAuthenticationResult> => {
    const suppliedToken = context.req.header("X-Encois-Service-Token")?.trim();
    if (!suppliedToken) return { reason: "missing_service_token", status: "unauthenticated" };
    if (!options.serviceToken || suppliedToken !== options.serviceToken) {
      return { reason: "invalid_service_token", status: "unauthenticated" };
    }

    const organizationId = context.req.header("X-Organization-ID")?.trim();
    if (!organizationId) return { reason: "missing_organization_id", status: "unauthenticated" };

    const actorId = context.req.header("X-Actor-ID")?.trim() || "agent-runtime";
    if (database) {
      if (!options.serviceUserId) return { reason: "missing_service_user_id", status: "unauthenticated" };

      const principal = await withOrganizationContext(database, organizationId, async (db) => {
        const [membership] = await db
          .select({ userId: users.id, membershipId: organizationMemberships.id })
          .from(users)
          .innerJoin(
            organizationMemberships,
            and(
              eq(organizationMemberships.userId, users.id),
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.status, "active"),
            ),
          )
          .where(eq(users.id, options.serviceUserId!))
          .limit(1);
        if (!membership) return null;

        return {
          actorId,
          userId: membership.userId,
          organizationId,
          scope: await resolveOrganizationScope(db, organizationId, membership.membershipId),
        } satisfies AosPrincipal;
      });

      return principal
        ? { principal, status: "authenticated" }
        : { reason: "service_user_has_no_active_membership", status: "unauthenticated" };
    }

    const scope = (context.req.header("X-Encois-Scope") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return {
      principal: {
        actorId,
        ...(options.serviceUserId ? { userId: options.serviceUserId } : {}),
        organizationId,
        scope,
      },
      status: "authenticated",
    };
  };
}

/**
 * Resolves the external Identity Platform subject into the local tenant and
 * exact organization-unit scope. The organization header is only a lookup
 * hint; the membership query remains the source of truth.
 */
export function createDatabasePrincipalResolver() {
  return async (identity: IdentityPlatformIdentity, context: Context<GatewayEnv>): Promise<AosPrincipal | null> => {
    if (!database) return null;
    const organizationId = context.req.header("X-Organization-ID")?.trim() || identity.tenantId;
    if (!organizationId) return null;

    return withOrganizationContext(database, organizationId, async (db) => {
      const [membership] = await db
        .select({ userId: users.id, membershipId: organizationMemberships.id })
        .from(users)
        .innerJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.userId, users.id),
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.status, "active"),
          ),
        )
        .where(
          and(
            eq(users.identityProvider, identity.identityProvider),
            eq(users.identitySubject, identity.subject),
          ),
        )
        .limit(1);
      if (!membership) return null;

      return {
        actorId: identity.subject,
        userId: membership.userId,
        organizationId,
        scope: await resolveOrganizationScope(db, organizationId, membership.membershipId),
      };
    });
  };
}

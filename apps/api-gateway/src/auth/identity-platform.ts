import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { isPermission, resolveEffectiveScope, type OrganizationUnitNode, type PermissionKey } from "@encois/contracts";
import {
  membershipScopes,
  organizationInvites,
  organizationMemberships,
  organizationUnits,
  rolePermissions,
  roles,
  users,
  withOrganizationContext,
  type PersistenceTransaction,
} from "@encois/persistence";
import type { Context } from "hono";
import type { AosAuthenticationResult, AosAuthenticator, AosPrincipal, GatewayEnv } from "../middleware/aos.js";
import { database } from "../database.js";

export type IdentityPlatformIdentity = {
  displayName?: string;
  email?: string;
  emailVerified: boolean;
  /** Stable Encois provider namespace, not the provider used for this sign-in. */
  identityProvider: "identity-platform";
  signInProvider: string;
  subject: string;
  tenantId?: string;
};

export type IdentityPlatformVerificationResult =
  | { identity: IdentityPlatformIdentity; status: "authenticated" }
  | { reason?: string; status: "unauthenticated" | "unconfigured" };

export type IdentityPlatformVerifier = (
  context: Context<GatewayEnv>,
) => Promise<IdentityPlatformVerificationResult>;

export type IdentityAccessResolution =
  | { principal: AosPrincipal; status: "active" }
  | { organizationId?: string; status: "pending" }
  | { status: "unavailable" };

export type IdentityAccessResolver = (
  identity: IdentityPlatformIdentity,
  context: Context<GatewayEnv>,
) => Promise<IdentityAccessResolution>;

export type IdentityPlatformAuthenticatorOptions = {
  checkRevoked?: boolean;
  projectId: string;
  resolvePrincipal: (identity: IdentityPlatformIdentity, context: Context<GatewayEnv>) => Promise<AosPrincipal | null>;
  allowedSignInProviders?: readonly string[];
};

export type IdentityPlatformVerifierOptions = {
  allowedSignInProviders?: readonly string[];
  checkRevoked?: boolean;
  projectId: string;
};

function bearerToken(context: Context<GatewayEnv>): string | null {
  const header = context.req.header("Authorization");
  if (!header) return null;

  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function identityFromToken(token: DecodedIdToken): IdentityPlatformIdentity {
  const firebase = token.firebase as { identities?: Record<string, unknown>; sign_in_provider?: string } | undefined;
  const signInProvider = firebase?.sign_in_provider ?? "identity-platform";

  return {
    displayName: typeof token.name === "string" ? token.name : undefined,
    email: typeof token.email === "string" ? token.email : undefined,
    emailVerified: token.email_verified === true,
    identityProvider: "identity-platform",
    signInProvider,
    subject: token.uid,
    tenantId: typeof token.firebase?.tenant === "string" ? token.firebase.tenant : undefined,
  };
}

function createIdentityPlatformVerifier(options: IdentityPlatformVerifierOptions): IdentityPlatformVerifier {
  const app =
    getApps().find((candidate) => candidate.options.projectId === options.projectId) ??
    initializeApp(
      {
        credential: applicationDefault(),
        projectId: options.projectId,
      },
      `identity-platform-${options.projectId}`,
    );
  const auth = getAuth(app);
  const allowedProviders = new Set(options.allowedSignInProviders ?? ["google.com"]);

  return async (context): Promise<IdentityPlatformVerificationResult> => {
    const token = bearerToken(context);
    if (!token) return { reason: "missing_bearer_token", status: "unauthenticated" };

    try {
      const decodedToken = await auth.verifyIdToken(token, options.checkRevoked ?? false);
      const identity = identityFromToken(decodedToken);
      if (!allowedProviders.has(identity.signInProvider)) {
        return { reason: "identity_provider_not_allowed", status: "unauthenticated" };
      }
      return { identity, status: "authenticated" };
    } catch {
      return { reason: "invalid_identity_platform_token", status: "unauthenticated" };
    }
  };
}

export function createIdentityPlatformIdentityVerifier(options: IdentityPlatformVerifierOptions): IdentityPlatformVerifier {
  return createIdentityPlatformVerifier(options);
}

export function createIdentityPlatformAuthenticator(
  options: IdentityPlatformAuthenticatorOptions,
): AosAuthenticator {
  const verifyIdentity = createIdentityPlatformVerifier(options);

  return async (context): Promise<AosAuthenticationResult> => {
    const result = await verifyIdentity(context);
    if (result.status !== "authenticated") return result;

    const principal = await options.resolvePrincipal(result.identity, context);
    return principal ? { principal, status: "authenticated" } : { reason: "identity_has_no_active_membership", status: "unauthenticated" };
  };
}

export type InternalServiceAuthenticatorOptions = {
  allowDatabaseScopeFallback?: boolean;
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

  // Direct membership scopes are the durable roots. Effective descendants are
  // computed deterministically; separate explicit grant/restriction records
  // are not part of the current control-plane model.
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

async function resolveRolePermissions(
  db: PersistenceTransaction,
  roleId: string,
): Promise<readonly PermissionKey[]> {
  const permissions = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return permissions.map(({ permission }) => permission).filter(isPermission);
}

/**
 * Authenticates the private Runtime -> Gateway control-plane boundary. In a
 * database-backed environment the configured service user must have an active
 * organization membership, and its scopes are loaded from persistence. The
 * The header scope fallback exists only when the caller explicitly enables the
 * database-free local/test scaffold.
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
          .select({ userId: users.id, membershipId: organizationMemberships.id, roleId: organizationMemberships.roleId })
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
          permissions: await resolveRolePermissions(db, membership.roleId),
        } satisfies AosPrincipal;
      });

      return principal
        ? { principal, status: "authenticated" }
        : { reason: "service_user_has_no_active_membership", status: "unauthenticated" };
    }

    if (!options.allowDatabaseScopeFallback) {
      return { reason: "database_authorization_unavailable", status: "unconfigured" };
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
        permissions: [],
      },
      status: "authenticated",
    };
  };
}

export function normalizeEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

function accessForRoleKey(roleKey: string): "admin" | "manager" | "contributor" | "viewer" {
  if (roleKey === "organization_admin" || roleKey === "admin") return "admin";
  if (roleKey === "manager") return "manager";
  if (roleKey === "member") return "contributor";
  return "viewer";
}

async function findPendingInvite(identity: IdentityPlatformIdentity, organizationId?: string) {
  if (!database || !identity.email || !identity.emailVerified) return null;

  const now = new Date();
  const conditions = [
    eq(organizationInvites.emailNormalized, normalizeEmail(identity.email)),
    eq(organizationInvites.status, "pending"),
    or(isNull(organizationInvites.expiresAt), gt(organizationInvites.expiresAt, now)),
  ];
  if (organizationId) conditions.push(eq(organizationInvites.organizationId, organizationId));

  const [invite] = await database
    .select()
    .from(organizationInvites)
    .where(and(...conditions))
    .orderBy(asc(organizationInvites.createdAt))
    .limit(1);
  return invite ?? null;
}

async function provisionInvitedIdentity(identity: IdentityPlatformIdentity, organizationId?: string): Promise<AosPrincipal | null> {
  if (!database) return null;

  const invite = await findPendingInvite(identity, organizationId);
  if (!invite) return null;

  return withOrganizationContext(database, invite.organizationId, async (db) => {
    const [user] = await db
      .insert(users)
      .values({
        identityProvider: identity.identityProvider,
        identitySubject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
      })
      .onConflictDoUpdate({
        target: [users.identityProvider, users.identitySubject],
        set: {
          email: identity.email,
          displayName: identity.displayName,
          updatedAt: new Date(),
        },
      })
      .returning({ id: users.id });
    if (!user) return null;

    const [existingMembership] = await db
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, invite.organizationId),
          eq(organizationMemberships.userId, user.id),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .limit(1);

    const membershipId = existingMembership?.id ?? (
      await db
        .insert(organizationMemberships)
        .values({
          organizationId: invite.organizationId,
          userId: user.id,
          roleId: invite.roleId,
          status: "active",
        })
        .onConflictDoNothing({ target: [organizationMemberships.organizationId, organizationMemberships.userId] })
        .returning({ id: organizationMemberships.id })
    )[0]?.id ?? (
      await db
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, invite.organizationId),
            eq(organizationMemberships.userId, user.id),
            eq(organizationMemberships.status, "active"),
          ),
        )
        .limit(1)
    )[0]?.id;
    if (!membershipId) return null;

    const organizationUnitId = invite.organizationUnitId ?? (
      await db
        .select({ id: organizationUnits.id })
        .from(organizationUnits)
        .where(and(eq(organizationUnits.organizationId, invite.organizationId), eq(organizationUnits.type, "organization")))
        .limit(1)
    )[0]?.id;
    if (!organizationUnitId) return null;

    const [role] = await db
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(eq(roles.id, invite.roleId))
      .limit(1);
    const permissions = role ? await resolveRolePermissions(db, role.id) : [];

    await db
      .insert(membershipScopes)
      .values({
        organizationId: invite.organizationId,
        membershipId,
        organizationUnitId,
        access: accessForRoleKey(role?.key ?? "viewer"),
      })
      .onConflictDoNothing();

    await db
      .update(organizationInvites)
      .set({
        status: "accepted",
        acceptedUserId: user.id,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(organizationInvites.id, invite.id), eq(organizationInvites.status, "pending")));

    return {
      actorId: identity.subject,
      userId: user.id,
      organizationId: invite.organizationId,
      scope: await resolveOrganizationScope(db, invite.organizationId, membershipId),
      permissions,
    } satisfies AosPrincipal;
  });
}

export function createDatabaseAccessResolver(): IdentityAccessResolver {
  return async (identity, context): Promise<IdentityAccessResolution> => {
    if (!database) return { status: "unavailable" };

    const organizationId = context.req.header("X-Organization-ID")?.trim() || undefined;
    if (organizationId) {
      const existingPrincipal = await resolvePrincipalForOrganization(identity, organizationId);
      if (existingPrincipal) return { principal: existingPrincipal, status: "active" };
    } else {
      const existingPrincipal = await resolveExistingIdentity(identity);
      if (existingPrincipal) return { principal: existingPrincipal, status: "active" };
    }

    const provisioned = await provisionInvitedIdentity(identity, organizationId);
    if (provisioned) return { principal: provisioned, status: "active" };

    const invite = await findPendingInvite(identity, organizationId);
    return {
      ...(invite ? { organizationId: invite.organizationId } : {}),
      status: "pending",
    };
  };
}

async function resolvePrincipalForOrganization(
  identity: IdentityPlatformIdentity,
  organizationId: string,
): Promise<AosPrincipal | null> {
  if (!database) return null;

  return withOrganizationContext(database, organizationId, async (db) => {
    const [membership] = await db
      .select({ userId: users.id, membershipId: organizationMemberships.id, roleId: roles.id })
      .from(users)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.userId, users.id),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .innerJoin(roles, eq(roles.id, organizationMemberships.roleId))
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
      permissions: await resolveRolePermissions(db, membership.roleId),
    } satisfies AosPrincipal;
  });
}

async function resolveExistingIdentity(identity: IdentityPlatformIdentity): Promise<AosPrincipal | null> {
  if (!database) return null;

  // Memberships are tenant-RLS protected, so an /auth/me request without an
  // organization cannot enumerate them. Accepted invites are pre-auth
  // control-plane records and retain the safe bridge to the admitted tenant.
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.identityProvider, identity.identityProvider), eq(users.identitySubject, identity.subject)))
    .limit(1);
  if (!user) return null;

  const acceptedInvites = await database
    .select({ organizationId: organizationInvites.organizationId })
    .from(organizationInvites)
    .where(and(eq(organizationInvites.acceptedUserId, user.id), eq(organizationInvites.status, "accepted")))
    .orderBy(asc(organizationInvites.acceptedAt), asc(organizationInvites.createdAt));
  const organizationIds = [...new Set(acceptedInvites.map((invite) => invite.organizationId))];
  if (organizationIds.length !== 1) return null;

  return resolvePrincipalForOrganization(identity, organizationIds[0]!);
}

/**
 * Resolves the external Identity Platform subject into the local tenant and
 * exact organization-unit scope. The organization header is only a lookup
 * hint; the membership query remains the source of truth.
 */
export function createDatabasePrincipalResolver() {
  return async (identity: IdentityPlatformIdentity, context: Context<GatewayEnv>): Promise<AosPrincipal | null> => {
    const access = await createDatabaseAccessResolver()(identity, context);
    return access.status === "active" ? access.principal : null;
  };
}

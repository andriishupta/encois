import { and, asc, eq } from "drizzle-orm";
import { resolveEffectiveScope, AccessLevel, OrganizationMembershipStatus, OrganizationUnitType, type OrganizationProjection, type OrganizationPermissionCreateRequest, type OrganizationPermissionUpdateRequest, type OrganizationUnitCreateRequest, type OrganizationUnitProjection, type OrganizationMemberProjection, type OrganizationPermissionProjection } from "@encois/contracts";
import {
  auditEvents,
  membershipScopes,
  organizationMemberships,
  organizationUnits,
  organizations,
  roles,
  users,
  withOrganizationContext,
  type PersistenceTransaction,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OrganizationServiceErrorCode =
  | "PERSISTENCE_UNAVAILABLE"
  | "FORBIDDEN"
  | "ORGANIZATION_NOT_FOUND"
  | "ORGANIZATION_UNIT_NOT_FOUND"
  | "ORGANIZATION_MEMBER_NOT_FOUND"
  | "ORGANIZATION_PERMISSION_NOT_FOUND"
  | "INVALID_PARENT"
  | "INVALID_REQUEST"
  | "DUPLICATE_ORGANIZATION_UNIT";

export type OrganizationServiceError = Error & { code: OrganizationServiceErrorCode };

function organizationError(code: OrganizationServiceErrorCode, message: string): OrganizationServiceError {
  const error = new Error(message) as OrganizationServiceError;
  error.code = code;
  return error;
}

export function isOrganizationServiceError(error: unknown): error is OrganizationServiceError {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

function requireUuid(value: string, field: string): void {
  if (!uuidPattern.test(value)) throw organizationError("INVALID_REQUEST", `${field} must be a UUID.`);
}

function localUserId(principal: AosPrincipal): string {
  const userId = principal.userId ?? principal.actorId;
  requireUuid(userId, "userId");
  return userId;
}

type UnitRow = {
  id: string;
  organizationId: string;
  parentId: string | null;
  type: OrganizationUnitType;
  slug: string;
  name: string;
};

type MemberRow = {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  roleKey: string;
  status: OrganizationMembershipStatus;
};

type ScopeRow = {
  id: string;
  membershipId: string;
  userId: string;
  unitId: string;
  access: AccessLevel;
};

type OrganizationContext = {
  organization: { id: string; slug: string; name: string };
  units: UnitRow[];
  members: MemberRow[];
  scopes: ScopeRow[];
  actor: MemberRow;
  actorScopeIds: Set<string>;
  managedUnitIds: Set<string>;
  isAdministrator: boolean;
};

function unitNodes(units: readonly UnitRow[]) {
  return units.map((unit) => ({
    id: unit.id,
    ...(unit.parentId ? { parentId: unit.parentId } : {}),
    type: unit.type,
  }));
}

function effectiveUnitIds(units: readonly UnitRow[], directUnitIds: readonly string[]): Set<string> {
  return new Set(resolveEffectiveScope({ units: unitNodes(units), directUnitIds }).resolvedUnitIds);
}

function isAdministrator(roleKey: string): boolean {
  return roleKey === "organization_admin" || roleKey === "admin";
}

function displayName(member: MemberRow): string {
  return member.name?.trim() || member.email?.trim() || "Unnamed member";
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : name.slice(0, 2)).toUpperCase();
}

function descriptionForUnit(type: OrganizationUnitType): string {
  if (type === OrganizationUnitType.Organization) return "The top-level organization boundary.";
  if (type === OrganizationUnitType.Department) return "An organization department and its descendant teams.";
  if (type === OrganizationUnitType.Team) return "A team-owned organizational scope.";
  if (type === OrganizationUnitType.Project) return "A project-owned organizational scope.";
  if (type === OrganizationUnitType.Service) return "A service-owned organizational scope.";
  return "A custom organizational scope.";
}

function canManageUnit(context: OrganizationContext, unitId: string): boolean {
  return context.isAdministrator || context.managedUnitIds.has(unitId);
}

function canAssignAccess(context: OrganizationContext, access: AccessLevel): boolean {
  return context.isAdministrator || access !== AccessLevel.Admin;
}

async function loadContext(
  db: PersistenceTransaction,
  principal: AosPrincipal,
): Promise<OrganizationContext> {
  const userId = localUserId(principal);
  const [organization, units, members, scopes] = await Promise.all([
    db
      .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, principal.organizationId))
      .limit(1),
    db
      .select({
        id: organizationUnits.id,
        organizationId: organizationUnits.organizationId,
        parentId: organizationUnits.parentId,
        type: organizationUnits.type,
        slug: organizationUnits.slug,
        name: organizationUnits.name,
      })
      .from(organizationUnits)
      .where(eq(organizationUnits.organizationId, principal.organizationId))
      .orderBy(asc(organizationUnits.createdAt)),
    db
      .select({
        membershipId: organizationMemberships.id,
        userId: users.id,
        name: users.displayName,
        email: users.email,
        role: roles.name,
        roleKey: roles.key,
        status: organizationMemberships.status,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .innerJoin(roles, eq(roles.id, organizationMemberships.roleId))
      .where(eq(organizationMemberships.organizationId, principal.organizationId))
      .orderBy(asc(users.displayName), asc(users.email)),
    db
      .select({
        id: membershipScopes.id,
        membershipId: membershipScopes.membershipId,
        userId: organizationMemberships.userId,
        unitId: membershipScopes.organizationUnitId,
        access: membershipScopes.access,
      })
      .from(membershipScopes)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.id, membershipScopes.membershipId),
          eq(organizationMemberships.organizationId, principal.organizationId),
        ),
      )
      .where(eq(membershipScopes.organizationId, principal.organizationId)),
  ]);

  const organizationRow = organization[0];
  if (!organizationRow) throw organizationError("ORGANIZATION_NOT_FOUND", "Organization not found.");
  const actor = members.find((member) => member.userId === userId && member.status === OrganizationMembershipStatus.Active);
  if (!actor) throw organizationError("FORBIDDEN", "The current user has no active organization membership.");

  const scopesByMembership = new Map<string, ScopeRow[]>();
  for (const scope of scopes) {
    const existing = scopesByMembership.get(scope.membershipId) ?? [];
    existing.push(scope);
    scopesByMembership.set(scope.membershipId, existing);
  }
  const actorScopeIds = effectiveUnitIds(
    units,
    (scopesByMembership.get(actor.membershipId) ?? []).map((scope) => scope.unitId),
  );
  const managedUnitIds = new Set<string>();
  for (const scope of scopesByMembership.get(actor.membershipId) ?? []) {
    if (scope.access === AccessLevel.Manager || scope.access === AccessLevel.Admin) {
      for (const unitId of effectiveUnitIds(units, [scope.unitId])) managedUnitIds.add(unitId);
    }
  }

  return {
    organization: organizationRow,
    units,
    members,
    scopes,
    actor,
    actorScopeIds,
    managedUnitIds,
    isAdministrator: isAdministrator(actor.roleKey),
  };
}

function projectContext(context: OrganizationContext): OrganizationProjection {
  const visibleUnitIds = context.isAdministrator ? new Set(context.units.map((unit) => unit.id)) : context.actorScopeIds;
  const visibleUnits = context.units.filter((unit) => visibleUnitIds.has(unit.id));
  const visibleMemberIds = new Set<string>();
  const effectiveByMember = new Map<string, Set<string>>();
  for (const member of context.members) {
    const effective = effectiveUnitIds(
      context.units,
      context.scopes.filter((scope) => scope.membershipId === member.membershipId).map((scope) => scope.unitId),
    );
    effectiveByMember.set(member.membershipId, effective);
    if (context.isAdministrator || member.userId === context.actor.userId || [...effective].some((unitId) => context.managedUnitIds.has(unitId))) {
      visibleMemberIds.add(member.userId);
    }
  }

  const units: OrganizationUnitProjection[] = visibleUnits.map((unit) => {
    const scopedMembers = context.members.filter((member) => effectiveByMember.get(member.membershipId)?.has(unit.id));
    const manager = context.scopes
      .filter((scope) => scope.unitId === unit.id && (scope.access === AccessLevel.Manager || scope.access === AccessLevel.Admin))
      .map((scope) => context.members.find((member) => member.userId === scope.userId))
      .find((member): member is MemberRow => Boolean(member));
    return {
      id: unit.id,
      organizationId: unit.organizationId,
      parentId: unit.parentId,
      type: unit.type,
      slug: unit.slug,
      name: unit.name,
      description: descriptionForUnit(unit.type),
      manager: manager ? displayName(manager) : "Not assigned",
      memberCount: new Set(scopedMembers.map((member) => member.userId)).size,
    };
  });

  const members: OrganizationMemberProjection[] = context.members
    .filter((member) => visibleMemberIds.has(member.userId))
    .map((member) => {
      const name = displayName(member);
      const homeUnitId = context.scopes.find((scope) => scope.membershipId === member.membershipId)?.unitId;
      return {
        id: member.userId,
        initials: initials(name),
        name,
        ...(member.email ? { email: member.email } : {}),
        role: member.role,
        roleKey: member.roleKey,
        ...(homeUnitId ? { homeUnitId } : {}),
        status: member.status,
      };
    });

  const permissions: OrganizationPermissionProjection[] = context.scopes
    .filter((scope) => visibleMemberIds.has(scope.userId) && (context.isAdministrator || context.managedUnitIds.has(scope.unitId)))
    .map((scope) => ({
      id: scope.id,
      memberId: scope.userId,
      unitId: scope.unitId,
      access: scope.access,
      propagateToChildren: true,
    }));

  return { organization: context.organization, units, members, permissions };
}

async function withContext<T>(principal: AosPrincipal, callback: (context: OrganizationContext, db: PersistenceTransaction) => Promise<T>): Promise<T> {
  if (!database) throw organizationError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  return withOrganizationContext(database, principal.organizationId, async (db) => callback(await loadContext(db, principal), db));
}

export async function getOrganizationForPrincipal(principal: AosPrincipal): Promise<OrganizationProjection> {
  return withContext(principal, async (context) => projectContext(context));
}

export async function listOrganizationUnitsForPrincipal(principal: AosPrincipal): Promise<readonly OrganizationUnitProjection[]> {
  return withContext(principal, async (context) => projectContext(context).units);
}

export async function listOrganizationMembersForPrincipal(principal: AosPrincipal): Promise<readonly OrganizationMemberProjection[]> {
  return withContext(principal, async (context) => projectContext(context).members);
}

export async function listOrganizationPermissionsForPrincipal(principal: AosPrincipal): Promise<readonly OrganizationPermissionProjection[]> {
  return withContext(principal, async (context) => projectContext(context).permissions);
}

function slugify(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

export async function createOrganizationUnitForPrincipal(
  principal: AosPrincipal,
  request: OrganizationUnitCreateRequest,
): Promise<OrganizationUnitProjection> {
  return withContext(principal, async (context, db) => {
    if (!context.isAdministrator && (!request.parentId || !canManageUnit(context, request.parentId))) {
      throw organizationError("FORBIDDEN", "The current user cannot create a unit in this scope.");
    }
    if (request.type === OrganizationUnitType.Organization || !request.parentId) {
      throw organizationError("INVALID_PARENT", "New organization units must have a parent unit.");
    }
    const parent = context.units.find((unit) => unit.id === request.parentId);
    if (!parent) throw organizationError("ORGANIZATION_UNIT_NOT_FOUND", "Parent organization unit not found.");
    const name = request.name.normalize("NFKC").trim();
    if (name.length < 1 || name.length > 120) throw organizationError("INVALID_REQUEST", "Unit name must be 1–120 characters.");
    const slug = slugify(request.slug ?? name);
    if (!slug) throw organizationError("INVALID_REQUEST", "Unit slug must contain a letter or number.");

    const existing = context.units.find((unit) => unit.parentId === request.parentId && unit.slug === slug);
    if (existing) throw organizationError("DUPLICATE_ORGANIZATION_UNIT", "A unit with this slug already exists under the selected parent.");

    const [created] = await db
      .insert(organizationUnits)
      .values({ organizationId: principal.organizationId, parentId: parent.id, type: request.type, slug, name })
      .returning({ id: organizationUnits.id, organizationId: organizationUnits.organizationId, parentId: organizationUnits.parentId, type: organizationUnits.type, slug: organizationUnits.slug, name: organizationUnits.name });
    if (!created) throw organizationError("ORGANIZATION_UNIT_NOT_FOUND", "The organization unit could not be created.");
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: context.actor.userId,
      action: "organization.unit.created",
      outcome: "success",
      resourceType: "organization_unit",
      resourceId: created.id,
      scope: { parentId: parent.id },
      metadata: { type: created.type, slug: created.slug },
    });

    return {
      ...created,
      description: descriptionForUnit(created.type),
      manager: "Not assigned",
      memberCount: 0,
    };
  });
}

export async function createOrganizationPermissionForPrincipal(
  principal: AosPrincipal,
  request: OrganizationPermissionCreateRequest,
): Promise<OrganizationPermissionProjection> {
  requireUuid(request.memberId, "memberId");
  requireUuid(request.unitId, "unitId");
  return withContext(principal, async (context, db) => {
    if (!canManageUnit(context, request.unitId)) throw organizationError("FORBIDDEN", "The current user cannot manage this organization unit.");
    if (!canAssignAccess(context, request.access)) throw organizationError("FORBIDDEN", "Managers cannot assign administrator access.");
    const member = context.members.find((candidate) => candidate.userId === request.memberId && candidate.status !== OrganizationMembershipStatus.Suspended);
    if (!member) throw organizationError("ORGANIZATION_MEMBER_NOT_FOUND", "Organization member not found.");
    if (!context.units.some((unit) => unit.id === request.unitId)) throw organizationError("ORGANIZATION_UNIT_NOT_FOUND", "Organization unit not found.");
    const existing = context.scopes.find((scope) => scope.userId === request.memberId && scope.unitId === request.unitId);
    const [scope] = existing
      ? await db.update(membershipScopes).set({ access: request.access }).where(eq(membershipScopes.id, existing.id)).returning({ id: membershipScopes.id })
      : await db.insert(membershipScopes).values({ organizationId: principal.organizationId, membershipId: member.membershipId, organizationUnitId: request.unitId, access: request.access }).returning({ id: membershipScopes.id });
    if (!scope) throw organizationError("ORGANIZATION_PERMISSION_NOT_FOUND", "The organization permission could not be saved.");
    await db.insert(auditEvents).values({ organizationId: principal.organizationId, actorUserId: context.actor.userId, action: existing ? "organization.permission.updated" : "organization.permission.created", outcome: "success", resourceType: "membership_scope", resourceId: scope.id, scope: { unitId: request.unitId, memberId: request.memberId }, metadata: { access: request.access } });
    return { id: scope.id, memberId: request.memberId, unitId: request.unitId, access: request.access, propagateToChildren: true };
  });
}

export async function updateOrganizationPermissionForPrincipal(
  principal: AosPrincipal,
  permissionId: string,
  request: OrganizationPermissionUpdateRequest,
): Promise<OrganizationPermissionProjection> {
  requireUuid(permissionId, "permissionId");
  return withContext(principal, async (context, db) => {
    const existing = context.scopes.find((scope) => scope.id === permissionId);
    if (!existing) throw organizationError("ORGANIZATION_PERMISSION_NOT_FOUND", "Organization permission not found.");
    if (!canManageUnit(context, existing.unitId)) throw organizationError("FORBIDDEN", "The current user cannot manage this organization unit.");
    if (!canAssignAccess(context, request.access)) throw organizationError("FORBIDDEN", "Managers cannot assign administrator access.");
    const [updated] = await db.update(membershipScopes).set({ access: request.access }).where(eq(membershipScopes.id, permissionId)).returning({ id: membershipScopes.id });
    if (!updated) throw organizationError("ORGANIZATION_PERMISSION_NOT_FOUND", "Organization permission not found.");
    await db.insert(auditEvents).values({ organizationId: principal.organizationId, actorUserId: context.actor.userId, action: "organization.permission.updated", outcome: "success", resourceType: "membership_scope", resourceId: permissionId, scope: { unitId: existing.unitId, memberId: existing.userId }, metadata: { access: request.access } });
    return { id: permissionId, memberId: existing.userId, unitId: existing.unitId, access: request.access, propagateToChildren: true };
  });
}

export async function deleteOrganizationPermissionForPrincipal(principal: AosPrincipal, permissionId: string): Promise<void> {
  requireUuid(permissionId, "permissionId");
  return withContext(principal, async (context, db) => {
    const existing = context.scopes.find((scope) => scope.id === permissionId);
    if (!existing) throw organizationError("ORGANIZATION_PERMISSION_NOT_FOUND", "Organization permission not found.");
    if (!canManageUnit(context, existing.unitId)) throw organizationError("FORBIDDEN", "The current user cannot manage this organization unit.");
    await db.delete(membershipScopes).where(eq(membershipScopes.id, permissionId));
    await db.insert(auditEvents).values({ organizationId: principal.organizationId, actorUserId: context.actor.userId, action: "organization.permission.deleted", outcome: "success", resourceType: "membership_scope", resourceId: permissionId, scope: { unitId: existing.unitId, memberId: existing.userId }, metadata: {} });
  });
}

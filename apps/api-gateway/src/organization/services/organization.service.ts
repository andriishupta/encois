import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { ContractVersion, CoordinatorEventType, CoordinationMode, permissionIncludes, resolveEffectiveScope, AccessLevel, OrganizationAccessRequestStatus, OrganizationMembershipStatus, OrganizationOnboardingStatus, OrganizationUnitType, Permission, TemporalWorkflowType, type CoordinatorEvent, type OrganizationAccessRequestCreateRequest, type OrganizationAccessRequestRecord, type OrganizationOnboardingProjection, type OrganizationOnboardingUpdateRequest, type OrganizationProjection, type OrganizationPermissionCreateRequest, type OrganizationPermissionUpdateRequest, type OrganizationUnitCreateRequest, type OrganizationUnitProjection, type OrganizationMemberProjection, type OrganizationPermissionProjection, type PermissionKey } from "@encois/contracts";
import {
  auditEvents,
  coordinatorEventOutbox,
  membershipScopes,
  organizationAccessRequests,
  organizationMemberships,
  organizationOnboarding,
  organizationUnits,
  organizations,
  roles,
  users,
  workflowDefinitions,
  workflowEvents,
  workflowRuns,
  workflowBlueprints,
  workflowTemplateVersions,
  workflowTemplates,
  withOrganizationContext,
  type PersistenceTransaction,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";
import { getGrantedPermissions } from "../../auth/authorization.js";
import type { WorkflowClient } from "../../workflows/temporal-client.js";
import { buildCoordinatorWorkflowId, type WorkflowStartCommand } from "../../workflows/types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OrganizationServiceErrorCode =
  | "PERSISTENCE_UNAVAILABLE"
  | "FORBIDDEN"
  | "ORGANIZATION_NOT_FOUND"
  | "ORGANIZATION_UNIT_NOT_FOUND"
  | "ORGANIZATION_MEMBER_NOT_FOUND"
  | "ORGANIZATION_PERMISSION_NOT_FOUND"
  | "ORGANIZATION_ACCESS_REQUEST_NOT_FOUND"
  | "ORGANIZATION_ACCESS_REQUEST_CONFLICT"
  | "ORGANIZATION_ACCESS_REQUEST_NOT_DECIDABLE"
  | "ORGANIZATION_ACCESS_REQUEST_NOT_APPLICABLE"
  | "ORGANIZATION_ONBOARDING_NOT_FOUND"
  | "ORGANIZATION_ONBOARDING_CONFLICT"
  | "ONBOARDING_START_FAILED"
  | "INVALID_PARENT"
  | "INVALID_REQUEST"
  | "DUPLICATE_ORGANIZATION_UNIT";

export type CoordinatorOnboardingStatusUpdate = {
  coordinatorId: string;
  status: Extract<OrganizationOnboardingStatus, "ready" | "failed">;
  lastError?: string;
};

export type OrganizationServiceError = Error & { code: OrganizationServiceErrorCode };

export type OrganizationOnboardingServiceOptions = {
  workflowClient: WorkflowClient;
  namespace: string;
  taskQueue: string;
  policyVersion: string;
};

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

type OnboardingRow = typeof organizationOnboarding.$inferSelect;

type OrganizationContext = {
  organization: { id: string; slug: string; name: string };
  onboarding: OnboardingRow;
  units: UnitRow[];
  members: MemberRow[];
  scopes: ScopeRow[];
  actor: MemberRow;
  actorScopeIds: Set<string>;
  managedUnitIds: Set<string>;
  actorPermissions: Set<PermissionKey>;
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
  const [organization, onboarding, units, members, scopes] = await Promise.all([
    db
      .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, principal.organizationId))
      .limit(1),
    db
      .select()
      .from(organizationOnboarding)
      .where(eq(organizationOnboarding.organizationId, principal.organizationId))
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
  const onboardingRow = onboarding[0];
  if (!onboardingRow) throw organizationError("ORGANIZATION_ONBOARDING_NOT_FOUND", "Organization onboarding state not found. Apply the current control-plane migration.");
  const actor = members.find((member) => member.userId === userId && member.status === OrganizationMembershipStatus.Active);
  if (!actor) throw organizationError("FORBIDDEN", "The current user has no active organization membership.");
  const actorPermissions = new Set(await getGrantedPermissions(db, principal));

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
    onboarding: onboardingRow,
    units,
    members,
    scopes,
    actor,
    actorScopeIds,
    managedUnitIds,
    actorPermissions,
    isAdministrator: isAdministrator(actor.roleKey),
  };
}

function projectContext(context: OrganizationContext): OrganizationProjection {
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

  const units: OrganizationUnitProjection[] = context.units.map((unit) => {
    const canView = context.isAdministrator || context.actorScopeIds.has(unit.id);
    const canManage = canManageUnit(context, unit.id);
    const scopedMembers = canView ? context.members.filter((member) => effectiveByMember.get(member.membershipId)?.has(unit.id)) : [];
    const manager = canView
      ? context.scopes
          .filter((scope) => scope.unitId === unit.id && (scope.access === AccessLevel.Manager || scope.access === AccessLevel.Admin))
          .map((scope) => context.members.find((member) => member.userId === scope.userId))
          .find((member): member is MemberRow => Boolean(member))
      : undefined;
    return {
      id: unit.id,
      organizationId: unit.organizationId,
      parentId: unit.parentId,
      type: unit.type,
      slug: unit.slug,
      name: unit.name,
      description: descriptionForUnit(unit.type),
      canView,
      canManage,
      ...(canView ? {
        manager: manager ? displayName(manager) : "Not assigned",
        memberCount: new Set(scopedMembers.map((member) => member.userId)).size,
      } : {}),
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
    .filter((scope) => visibleMemberIds.has(scope.userId) && (context.isAdministrator || scope.userId === context.actor.userId || context.managedUnitIds.has(scope.unitId)))
    .map((scope) => ({
      id: scope.id,
      memberId: scope.userId,
      unitId: scope.unitId,
      access: scope.access,
      propagateToChildren: true,
    }));

  return {
    organization: context.organization,
    units,
    members,
    permissions,
    onboarding: projectOnboarding(context.onboarding),
  };
}

function projectOnboarding(row: OnboardingRow): OrganizationOnboardingProjection {
  return {
    organizationId: row.organizationId,
    status: row.status,
    coordinatorId: row.coordinatorId,
    coordinationMode: row.coordinationMode,
    selectedWorkflows: row.selectedWorkflows,
    ...(row.lastError ? { lastError: row.lastError } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function withContext<T>(principal: AosPrincipal, callback: (context: OrganizationContext, db: PersistenceTransaction) => Promise<T>): Promise<T> {
  if (!database) throw organizationError("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  return withOrganizationContext(database, principal.organizationId, async (db) => callback(await loadContext(db, principal), db));
}

function requirePermission(context: OrganizationContext, permission: PermissionKey): void {
  if (!permissionIncludes([...context.actorPermissions], permission)) {
    throw organizationError("FORBIDDEN", "The current user does not have permission for this organization action.");
  }
}

export async function getOrganizationForPrincipal(principal: AosPrincipal): Promise<OrganizationProjection> {
  return withContext(principal, async (context) => {
    requirePermission(context, Permission.OrganizationRead);
    return projectContext(context);
  });
}

function onboardingRequestHash(request: OrganizationOnboardingUpdateRequest, organizationId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ organizationId, coordinationMode: request.coordinationMode, selectedWorkflows: request.selectedWorkflows }))
    .digest("hex");
}

function normalizedSelectedWorkflows(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (value.length > 50) throw organizationError("INVALID_REQUEST", "At most 50 workflow selections can be saved.");
  const normalized = [...new Set(value.map((item) => item.normalize("NFKC").trim()).filter(Boolean))];
  if (normalized.some((item) => item.length > 128)) throw organizationError("INVALID_REQUEST", "Workflow selections must be 128 characters or fewer.");
  return normalized;
}

async function validateWorkflowCatalogSelections(
  db: PersistenceTransaction,
  organizationId: string,
  selectedWorkflows: readonly string[],
): Promise<void> {
  if (selectedWorkflows.length === 0) return;

  const [templates, blueprints] = await Promise.all([
    db
      .select({ key: workflowTemplates.key })
      .from(workflowTemplates)
      .innerJoin(workflowTemplateVersions, eq(workflowTemplateVersions.workflowTemplateId, workflowTemplates.id))
      .where(and(
        inArray(workflowTemplates.key, selectedWorkflows),
        eq(workflowTemplates.status, "published"),
        eq(workflowTemplateVersions.status, "published"),
        eq(workflowTemplateVersions.version, workflowTemplates.publishedVersion!),
        or(
          and(isNull(workflowTemplateVersions.organizationId), isNull(workflowTemplates.organizationId)),
          eq(workflowTemplateVersions.organizationId, workflowTemplates.organizationId),
        ),
      )),
    db
      .select({ blueprintId: workflowBlueprints.blueprintId })
      .from(workflowBlueprints)
      .where(and(
        eq(workflowBlueprints.organizationId, organizationId),
        eq(workflowBlueprints.status, "approved"),
        eq(workflowBlueprints.isCurrent, true),
        inArray(workflowBlueprints.blueprintId, selectedWorkflows),
      )),
  ]);

  const available = new Set([...templates.map((row) => row.key), ...blueprints.map((row) => row.blueprintId)]);
  const missing = selectedWorkflows.filter((selection) => !available.has(selection));
  if (missing.length > 0) {
    const visible = missing.slice(0, 3).join(", ");
    const suffix = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
    throw organizationError("INVALID_REQUEST", `Selected workflow catalog entries are not available in this organization: ${visible}${suffix}.`);
  }
}

export async function updateOrganizationOnboardingForPrincipal(
  principal: AosPrincipal,
  request: OrganizationOnboardingUpdateRequest,
): Promise<OrganizationOnboardingProjection> {
  const selectedWorkflows = normalizedSelectedWorkflows(request.selectedWorkflows);
  if (request.coordinationMode !== undefined && !Object.values(CoordinationMode).includes(request.coordinationMode)) {
    throw organizationError("INVALID_REQUEST", "The coordination mode is invalid.");
  }
  return withContext(principal, async (context, db) => {
    requirePermission(context, Permission.OnboardingManage);
    if (context.onboarding.status === OrganizationOnboardingStatus.Initializing) {
      throw organizationError("ORGANIZATION_ONBOARDING_CONFLICT", "Onboarding is already initializing.");
    }
    if (selectedWorkflows) await validateWorkflowCatalogSelections(db, principal.organizationId, selectedWorkflows);
    const [updated] = await db
      .update(organizationOnboarding)
      .set({
        ...(request.coordinationMode ? { coordinationMode: request.coordinationMode } : {}),
        ...(selectedWorkflows ? { selectedWorkflows } : {}),
        status: OrganizationOnboardingStatus.Pending,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(organizationOnboarding.organizationId, principal.organizationId))
      .returning();
    if (!updated) throw organizationError("ORGANIZATION_ONBOARDING_NOT_FOUND", "Organization onboarding state not found.");
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: context.actor.userId,
      action: "organization.onboarding.updated",
      outcome: "accepted",
      resourceType: "organization_onboarding",
      resourceId: principal.organizationId,
      scope: { organizationId: principal.organizationId },
      metadata: { requestHash: onboardingRequestHash(request, principal.organizationId) },
    });
    return projectOnboarding(updated);
  });
}

function coordinatorStartCommand(
  principal: AosPrincipal,
  onboarding: OnboardingRow,
  requestId: string,
  options: OrganizationOnboardingServiceOptions,
): WorkflowStartCommand {
  const workflowId = buildCoordinatorWorkflowId(principal.organizationId, onboarding.coordinatorId);
  return {
    workflowType: TemporalWorkflowType.Coordinator,
    workflowId,
    taskQueue: options.taskQueue,
    input: {
      contractVersion: ContractVersion.Coordinator,
      actorId: principal.actorId,
      organizationId: principal.organizationId,
      requestId,
      workflowId,
      policyVersion: options.policyVersion,
      scope: { ids: principal.scope.length > 0 ? [...principal.scope] : ["*"] },
      capability: "coordinator-bootstrap",
      userId: principal.userId,
      coordinatorId: onboarding.coordinatorId,
      coordinationMode: onboarding.coordinationMode,
      selectedWorkflowRefs: [...onboarding.selectedWorkflows],
      scopeType: "organization",
      state: {
        status: "ONBOARDING",
        version: 0,
        onboardingComplete: false,
        reconciliationCount: 0,
      },
    },
    requestHash: createHash("sha256").update(JSON.stringify({ workflowId, selectedWorkflows: onboarding.selectedWorkflows, coordinationMode: onboarding.coordinationMode })).digest("hex"),
  };
}

export async function startOrganizationOnboardingForPrincipal(
  principal: AosPrincipal,
  requestId: string,
  options: OrganizationOnboardingServiceOptions,
): Promise<OrganizationOnboardingProjection> {
  return withContext(principal, async (context, db) => {
    requirePermission(context, Permission.OnboardingManage);
    if (context.onboarding.status === OrganizationOnboardingStatus.Ready) return projectOnboarding(context.onboarding);
    await validateWorkflowCatalogSelections(db, principal.organizationId, context.onboarding.selectedWorkflows);

    const command = coordinatorStartCommand(principal, context.onboarding, requestId, options);
    const event: CoordinatorEvent = {
      contractVersion: ContractVersion.CoordinatorEvent,
      eventId: `onboarding-reconcile:${principal.organizationId}:${requestId}`,
      eventType: CoordinatorEventType.ReconcileRequested,
      coordinatorId: context.onboarding.coordinatorId,
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      reason: "Initial organization onboarding reconciliation.",
    };

    const [initialized] = await db
      .update(organizationOnboarding)
      .set({ status: OrganizationOnboardingStatus.Initializing, lastError: null, updatedAt: new Date() })
      .where(eq(organizationOnboarding.organizationId, principal.organizationId))
      .returning();
    if (!initialized) throw organizationError("ORGANIZATION_ONBOARDING_NOT_FOUND", "Organization onboarding state not found.");

    try {
      const projection = await options.workflowClient.start(command, options.namespace);
      if (projection.reused) {
        // A failed onboarding retry may reuse the long-lived Coordinator
        // execution. Wake it explicitly; the initial start is reconciled by
        // the workflow itself and does not need a synthetic browser signal.
        await options.workflowClient.signalCoordinator(
          context.onboarding.coordinatorId,
          principal.organizationId,
          options.namespace,
          event,
        );
      }
      const [definition] = await db
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(and(
          eq(workflowDefinitions.organizationId, principal.organizationId),
          eq(workflowDefinitions.key, TemporalWorkflowType.Coordinator),
          eq(workflowDefinitions.version, "v1"),
        ))
        .limit(1);
      const definitionRow = definition ?? (await db.insert(workflowDefinitions).values({
        organizationId: principal.organizationId,
        key: TemporalWorkflowType.Coordinator,
        version: "v1",
        status: "approved",
        inputSchemaRef: "contract://coordinator.v1",
        outputSchemaRef: "contract://coordinator-state.v1",
      }).returning({ id: workflowDefinitions.id }))[0];
      if (!definitionRow) throw new Error("Coordinator workflow definition could not be persisted.");

      const [workflowRun] = await db.insert(workflowRuns).values({
        organizationId: principal.organizationId,
        definitionId: definitionRow.id,
        actorUserId: context.actor.userId,
        temporalNamespace: projection.namespace,
        temporalTaskQueue: projection.taskQueue,
        temporalWorkflowId: projection.workflowId,
        temporalRunId: projection.runId,
        trigger: "onboarding",
        status: projection.status,
        scope: command.input.scope,
        businessInput: {
          coordinationMode: context.onboarding.coordinationMode,
          selectedWorkflowRefs: [...context.onboarding.selectedWorkflows],
        },
      }).onConflictDoNothing().returning({ id: workflowRuns.id });
      if (workflowRun) {
        await db.insert(workflowEvents).values({
          organizationId: principal.organizationId,
          workflowRunId: workflowRun.id,
          eventType: "coordinator_started",
          status: projection.status,
          metadata: { requestId, coordinatorId: context.onboarding.coordinatorId },
        });
      }
      await db.insert(coordinatorEventOutbox).values({
        organizationId: principal.organizationId,
        eventId: event.eventId,
        coordinatorId: event.coordinatorId,
        eventType: event.eventType,
        payload: event as unknown as Record<string, unknown>,
      }).onConflictDoNothing();
      await db.insert(auditEvents).values({
        organizationId: principal.organizationId,
        actorUserId: context.actor.userId,
        action: "organization.onboarding.started",
        outcome: "accepted",
        resourceType: "organization_onboarding",
        resourceId: principal.organizationId,
        scope: { organizationId: principal.organizationId },
        metadata: {
          requestId,
          coordinatorId: context.onboarding.coordinatorId,
          workflowId: projection.workflowId,
          eventId: event.eventId,
        },
      });
      // Starting Temporal proves only that the Coordinator was accepted by
      // the runtime. Readiness is reported by the Coordinator after its
      // first successful bootstrap reconciliation.
      return projectOnboarding(initialized);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Coordinator could not be started.";
      await db.update(organizationOnboarding).set({ status: OrganizationOnboardingStatus.Failed, lastError: message.slice(0, 1000), updatedAt: new Date() }).where(eq(organizationOnboarding.organizationId, principal.organizationId));
      throw organizationError("ONBOARDING_START_FAILED", message);
    }
  });
}

export async function updateOrganizationOnboardingFromCoordinator(
  principal: AosPrincipal,
  update: CoordinatorOnboardingStatusUpdate,
): Promise<OrganizationOnboardingProjection> {
  return withContext(principal, async (context, db) => {
    requirePermission(context, Permission.OnboardingManage);
    if (context.onboarding.coordinatorId !== update.coordinatorId) {
      throw organizationError("ORGANIZATION_ONBOARDING_CONFLICT", "The Coordinator does not belong to this organization onboarding record.");
    }
    if (context.onboarding.status === OrganizationOnboardingStatus.Ready && update.status === OrganizationOnboardingStatus.Ready) {
      return projectOnboarding(context.onboarding);
    }
    if (context.onboarding.status !== OrganizationOnboardingStatus.Initializing) {
      throw organizationError("ORGANIZATION_ONBOARDING_CONFLICT", "The onboarding record is not waiting for a Coordinator bootstrap result.");
    }

    const [updated] = await db
      .update(organizationOnboarding)
      .set({
        status: update.status,
        lastError: update.status === OrganizationOnboardingStatus.Failed ? (update.lastError?.slice(0, 1000) || "Coordinator bootstrap failed.") : null,
        updatedAt: new Date(),
      })
      .where(eq(organizationOnboarding.organizationId, principal.organizationId))
      .returning();
    if (!updated) throw organizationError("ORGANIZATION_ONBOARDING_NOT_FOUND", "Organization onboarding state not found.");

    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: context.actor.userId,
      action: `organization.onboarding.${update.status}`,
      outcome: "accepted",
      resourceType: "organization_onboarding",
      resourceId: principal.organizationId,
      scope: { organizationId: principal.organizationId },
      metadata: { coordinatorId: update.coordinatorId },
    });
    return projectOnboarding(updated);
  });
}

export async function listOrganizationUnitsForPrincipal(principal: AosPrincipal): Promise<readonly OrganizationUnitProjection[]> {
  return withContext(principal, async (context) => {
    requirePermission(context, Permission.OrganizationRead);
    return projectContext(context).units;
  });
}

export async function listOrganizationMembersForPrincipal(principal: AosPrincipal): Promise<readonly OrganizationMemberProjection[]> {
  return withContext(principal, async (context) => {
    requirePermission(context, Permission.OrganizationRead);
    return projectContext(context).members;
  });
}

function accessRequestRecord(
  row: typeof organizationAccessRequests.$inferSelect,
  context: OrganizationContext,
): OrganizationAccessRequestRecord {
  const requester = context.members.find((member) => member.userId === row.requestedByUserId);
  const unit = context.units.find((candidate) => candidate.id === row.organizationUnitId);
  return {
    id: row.id,
    organizationId: row.organizationId,
    requestedByUserId: row.requestedByUserId,
    requesterName: displayName(requester ?? { name: null, email: null } as MemberRow),
    ...(requester?.email ? { requesterEmail: requester.email } : {}),
    unitId: row.organizationUnitId,
    unitName: unit?.name ?? "Organization unit",
    access: nonAdminAccess(row.requestedAccess),
    reason: row.reason,
    status: row.status,
    ...(row.reviewedByUserId ? { reviewedByUserId: row.reviewedByUserId } : {}),
    ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.reviewedAt ? { reviewedAt: row.reviewedAt.toISOString() } : {}),
    ...(row.appliedAt ? { appliedAt: row.appliedAt.toISOString() } : {}),
  };
}

function nonAdminAccess(access: AccessLevel): Exclude<AccessLevel, "admin"> {
  if (access === AccessLevel.Admin) throw organizationError("INVALID_REQUEST", "Administrator access requests are not supported.");
  return access;
}

function requireOrganizationAdministrator(context: OrganizationContext): void {
  if (!context.isAdministrator) throw organizationError("FORBIDDEN", "Only an organization administrator can decide access requests.");
}

function accessRank(access: AccessLevel): number {
  return { [AccessLevel.Viewer]: 1, [AccessLevel.Contributor]: 2, [AccessLevel.Manager]: 3, [AccessLevel.Admin]: 4 }[access];
}

export async function listOrganizationAccessRequestsForPrincipal(principal: AosPrincipal): Promise<readonly OrganizationAccessRequestRecord[]> {
  return withContext(principal, async (context, db) => {
    requirePermission(context, Permission.OrganizationRead);
    const rows = await db
      .select()
      .from(organizationAccessRequests)
      .where(eq(organizationAccessRequests.organizationId, principal.organizationId))
      .orderBy(desc(organizationAccessRequests.updatedAt))
      .limit(100);
    return rows
      .filter((row) => context.isAdministrator || row.requestedByUserId === context.actor.userId)
      .map((row) => accessRequestRecord(row, context));
  });
}

export async function createOrganizationAccessRequestForPrincipal(
  principal: AosPrincipal,
  request: OrganizationAccessRequestCreateRequest,
): Promise<OrganizationAccessRequestRecord> {
  requireUuid(request.unitId, "unitId");
  return withContext(principal, async (context, db) => {
    requirePermission(context, Permission.OrganizationRead);
    nonAdminAccess(request.access as AccessLevel);
    const reason = request.reason.normalize("NFKC").trim();
    if (reason.length < 5 || reason.length > 2_000) throw organizationError("INVALID_REQUEST", "Explain the access need in 5–2,000 characters.");
    const unit = context.units.find((candidate) => candidate.id === request.unitId);
    if (!unit || (!context.isAdministrator && !context.actorScopeIds.has(unit.id))) {
      throw organizationError("FORBIDDEN", "The requested organization unit is outside the visible scope.");
    }
    const existing = await db
      .select({ id: organizationAccessRequests.id })
      .from(organizationAccessRequests)
      .where(and(
        eq(organizationAccessRequests.organizationId, principal.organizationId),
        eq(organizationAccessRequests.requestedByUserId, context.actor.userId),
        eq(organizationAccessRequests.organizationUnitId, request.unitId),
        inArray(organizationAccessRequests.status, [OrganizationAccessRequestStatus.Proposed, OrganizationAccessRequestStatus.Approved]),
      ))
      .limit(1);
    if (existing[0]) throw organizationError("ORGANIZATION_ACCESS_REQUEST_CONFLICT", "An open access request already exists for this organization unit.");
    const [created] = await db.insert(organizationAccessRequests).values({
      organizationId: principal.organizationId,
      requestedByUserId: context.actor.userId,
      organizationUnitId: request.unitId,
      requestedAccess: request.access,
      reason,
      status: "proposed",
    }).returning();
    if (!created) throw organizationError("ORGANIZATION_ACCESS_REQUEST_NOT_FOUND", "The access request could not be created.");
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: context.actor.userId,
      action: "organization.access_request.submitted",
      outcome: "accepted",
      resourceType: "organization_access_request",
      resourceId: created.id,
      scope: { unitId: request.unitId },
      metadata: { requestedAccess: request.access },
    });
    return accessRequestRecord(created, context);
  });
}

async function getOrganizationAccessRequest(
  principal: AosPrincipal,
  context: OrganizationContext,
  db: PersistenceTransaction,
  requestId: string,
): Promise<typeof organizationAccessRequests.$inferSelect> {
  requireUuid(requestId, "requestId");
  const [row] = await db.select().from(organizationAccessRequests).where(and(
    eq(organizationAccessRequests.id, requestId),
    eq(organizationAccessRequests.organizationId, principal.organizationId),
  )).limit(1);
  if (!row || (!context.isAdministrator && row.requestedByUserId !== context.actor.userId)) {
    throw organizationError("ORGANIZATION_ACCESS_REQUEST_NOT_FOUND", "Organization access request not found.");
  }
  return row;
}

export async function decideOrganizationAccessRequestForPrincipal(
  principal: AosPrincipal,
  requestId: string,
  decision: "approved" | "rejected",
): Promise<OrganizationAccessRequestRecord> {
  requireUuid(requestId, "requestId");
  return withContext(principal, async (context, db) => {
    requireOrganizationAdministrator(context);
    const row = await getOrganizationAccessRequest(principal, context, db, requestId);
    if (row.requestedByUserId === context.actor.userId) throw organizationError("FORBIDDEN", "An access request must be decided by a different organization administrator.");
    if (row.status !== OrganizationAccessRequestStatus.Proposed) throw organizationError("ORGANIZATION_ACCESS_REQUEST_NOT_DECIDABLE", `The access request is already ${row.status}.`);
    const now = new Date();
    const [updated] = await db.update(organizationAccessRequests).set({
      status: decision,
      reviewedByUserId: context.actor.userId,
      reviewedAt: now,
      updatedAt: now,
      ...(decision === OrganizationAccessRequestStatus.Rejected ? { rejectionReason: "Declined by an organization administrator." } : {}),
    }).where(and(
      eq(organizationAccessRequests.id, requestId),
      eq(organizationAccessRequests.organizationId, principal.organizationId),
      eq(organizationAccessRequests.status, OrganizationAccessRequestStatus.Proposed),
    )).returning();
    if (!updated) throw organizationError("ORGANIZATION_ACCESS_REQUEST_CONFLICT", "The access request changed concurrently.");
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: context.actor.userId,
      action: `organization.access_request.${decision}`,
      outcome: "accepted",
      resourceType: "organization_access_request",
      resourceId: requestId,
      scope: { unitId: row.organizationUnitId },
      metadata: { requestedAccess: row.requestedAccess },
    });
    return accessRequestRecord(updated, context);
  });
}

export async function applyOrganizationAccessRequestForPrincipal(
  principal: AosPrincipal,
  requestId: string,
): Promise<OrganizationAccessRequestRecord> {
  requireUuid(requestId, "requestId");
  return withContext(principal, async (context, db) => {
    requireOrganizationAdministrator(context);
    const row = await getOrganizationAccessRequest(principal, context, db, requestId);
    if (row.status === OrganizationAccessRequestStatus.Applied) return accessRequestRecord(row, context);
    if (row.status !== OrganizationAccessRequestStatus.Approved) throw organizationError("ORGANIZATION_ACCESS_REQUEST_NOT_APPLICABLE", `The access request is ${row.status}.`);
    const member = context.members.find((candidate) => candidate.userId === row.requestedByUserId && candidate.status === OrganizationMembershipStatus.Active);
    if (!member) throw organizationError("ORGANIZATION_MEMBER_NOT_FOUND", "The requesting member is no longer active.");
    const existing = context.scopes.find((scope) => scope.userId === row.requestedByUserId && scope.unitId === row.organizationUnitId);
    const effectiveAccess = existing && accessRank(existing.access) > accessRank(row.requestedAccess) ? existing.access : row.requestedAccess;
    if (existing) {
      await db.update(membershipScopes).set({ access: effectiveAccess }).where(eq(membershipScopes.id, existing.id));
    } else {
      await db.insert(membershipScopes).values({ organizationId: principal.organizationId, membershipId: member.membershipId, organizationUnitId: row.organizationUnitId, access: effectiveAccess });
    }
    const now = new Date();
    const [updated] = await db.update(organizationAccessRequests).set({ status: OrganizationAccessRequestStatus.Applied, appliedAt: now, updatedAt: now }).where(and(
      eq(organizationAccessRequests.id, requestId),
      eq(organizationAccessRequests.organizationId, principal.organizationId),
      eq(organizationAccessRequests.status, OrganizationAccessRequestStatus.Approved),
    )).returning();
    if (!updated) throw organizationError("ORGANIZATION_ACCESS_REQUEST_CONFLICT", "The access request changed concurrently.");
    await db.insert(auditEvents).values({
      organizationId: principal.organizationId,
      actorUserId: context.actor.userId,
      action: "organization.access_request.applied",
      outcome: "accepted",
      resourceType: "organization_access_request",
      resourceId: requestId,
      scope: { unitId: row.organizationUnitId, memberId: row.requestedByUserId },
      metadata: { requestedAccess: row.requestedAccess, effectiveAccess },
    });
    return accessRequestRecord(updated, context);
  });
}

export async function listOrganizationPermissionsForPrincipal(principal: AosPrincipal): Promise<readonly OrganizationPermissionProjection[]> {
  return withContext(principal, async (context) => {
    requirePermission(context, Permission.OrganizationManage);
    return projectContext(context).permissions;
  });
}

function slugify(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

export async function createOrganizationUnitForPrincipal(
  principal: AosPrincipal,
  request: OrganizationUnitCreateRequest,
): Promise<OrganizationUnitProjection> {
  return withContext(principal, async (context, db) => {
    requirePermission(context, Permission.OrganizationManage);
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
      canView: true,
      canManage: true,
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
    requirePermission(context, Permission.OrganizationManage);
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
    requirePermission(context, Permission.OrganizationManage);
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
    requirePermission(context, Permission.OrganizationManage);
    const existing = context.scopes.find((scope) => scope.id === permissionId);
    if (!existing) throw organizationError("ORGANIZATION_PERMISSION_NOT_FOUND", "Organization permission not found.");
    if (!canManageUnit(context, existing.unitId)) throw organizationError("FORBIDDEN", "The current user cannot manage this organization unit.");
    await db.delete(membershipScopes).where(eq(membershipScopes.id, permissionId));
    await db.insert(auditEvents).values({ organizationId: principal.organizationId, actorUserId: context.actor.userId, action: "organization.permission.deleted", outcome: "success", resourceType: "membership_scope", resourceId: permissionId, scope: { unitId: existing.unitId, memberId: existing.userId }, metadata: {} });
  });
}

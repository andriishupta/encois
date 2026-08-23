import { and, count, eq, inArray } from "drizzle-orm";
import {
  createDatabase,
  integrations,
  knowledgeSources,
  membershipScopes,
  organizationInvites,
  organizationMemberships,
  organizationUnits,
  organizations,
  roles,
  sourceRevisions,
  sourceIngestionRuns,
  workflowEvents,
  workflowRuns,
  users,
} from "@encois/persistence";

const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim();
if (process.env.NODE_ENV === "production") throw new Error("Local fixture verification cannot run in production.");
if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL is required for local fixture verification.");

const expectedOrganizations = ["organization-sun"] as const;
const expectedActiveUsers = [
  { email: "owner@local.test", organizationSlug: "organization-sun", roleKey: "organization_admin", unitSlug: "root", access: "admin" },
  { email: "manager@local.test", organizationSlug: "organization-sun", roleKey: "manager", unitSlug: "engineering", access: "manager" },
  { email: "dev@local.test", organizationSlug: "organization-sun", roleKey: "manager", unitSlug: "development", access: "manager" },
  { email: "viewer@local.test", organizationSlug: "organization-sun", roleKey: "viewer", unitSlug: "checkout", access: "viewer" },
] as const;
const expectedOnboardingUsers = [
  { email: "onboarding1@local.test", organizationSlug: "organization-sun" },
  { email: "onboarding2@local.test", organizationSlug: "organization-sun" },
  { email: "onboarding3@local.test", organizationSlug: "organization-sun" },
] as const;
const database = createDatabase({ url: databaseUrl });

async function verifyFixtures(): Promise<void> {
  const organizationRows = await database.db
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.slug, [...expectedOrganizations]));
  const bySlug = new Map(organizationRows.map((organization) => [organization.slug, organization]));
  for (const slug of expectedOrganizations) {
    if (!bySlug.has(slug)) throw new Error(`Missing local organization fixture: ${slug}`);
  }
  if (new Set(organizationRows.map((organization) => organization.id)).size !== expectedOrganizations.length) {
    throw new Error("Local organizations must have distinct database identities.");
  }

  const organizationIdBySlug = new Map(organizationRows.map((organization) => [organization.slug, organization.id]));
  const activeUserRows = await database.db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, expectedActiveUsers.map(({ email }) => email)));
  const activeUsersByEmail = new Map(
    activeUserRows
      .filter((user): user is { id: string; email: string } => Boolean(user.email))
      .map((user) => [user.email, user]),
  );
  for (const expected of expectedActiveUsers) {
    const user = activeUsersByEmail.get(expected.email);
    const organizationId = organizationIdBySlug.get(expected.organizationSlug);
    if (!user || !organizationId) throw new Error(`Missing active local user fixture: ${expected.email}`);
    const [membership] = await database.db
      .select({ id: organizationMemberships.id, roleKey: roles.key })
      .from(organizationMemberships)
      .innerJoin(roles, eq(roles.id, organizationMemberships.roleId))
      .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, user.id), eq(organizationMemberships.status, "active")))
      .limit(1);
    if (!membership) throw new Error(`Active fixture ${expected.email} has no active membership in ${expected.organizationSlug}.`);
    if (membership.roleKey !== expected.roleKey) throw new Error(`Active fixture ${expected.email} has role ${membership.roleKey}, expected ${expected.roleKey}.`);
    const [scope] = await database.db
      .select({ slug: organizationUnits.slug, access: membershipScopes.access })
      .from(membershipScopes)
      .innerJoin(organizationUnits, eq(organizationUnits.id, membershipScopes.organizationUnitId))
      .where(and(eq(membershipScopes.organizationId, organizationId), eq(membershipScopes.membershipId, membership.id)))
      .limit(1);
    if (!scope || scope.slug !== expected.unitSlug || scope.access !== expected.access) {
      throw new Error(`Active fixture ${expected.email} has scope ${scope?.slug ?? "missing"}/${scope?.access ?? "missing"}, expected ${expected.unitSlug}/${expected.access}.`);
    }
    const memberships = await database.db
      .select({ organizationId: organizationMemberships.organizationId, status: organizationMemberships.status })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, user.id));
    if (memberships.length !== 1 || memberships[0]?.organizationId !== organizationId) {
      throw new Error(`Active fixture ${expected.email} crosses organization membership boundaries.`);
    }
    const [acceptedInvite] = await database.db
      .select({ id: organizationInvites.id })
      .from(organizationInvites)
      .where(and(eq(organizationInvites.organizationId, organizationId), eq(organizationInvites.emailNormalized, expected.email), eq(organizationInvites.status, "accepted"), eq(organizationInvites.acceptedUserId, user.id)))
      .limit(1);
    if (!acceptedInvite) throw new Error(`Active fixture ${expected.email} has no accepted invite in ${expected.organizationSlug}.`);
  }

  const onboardingRows = await database.db
    .select({ email: organizationInvites.emailNormalized, organizationId: organizationInvites.organizationId, status: organizationInvites.status, acceptedUserId: organizationInvites.acceptedUserId })
    .from(organizationInvites)
    .where(inArray(organizationInvites.emailNormalized, expectedOnboardingUsers.map(({ email }) => email)));
  for (const expected of expectedOnboardingUsers) {
    const organizationId = organizationIdBySlug.get(expected.organizationSlug);
    const invite = onboardingRows.find((candidate) => candidate.organizationId === organizationId && candidate.email === expected.email);
    if (!organizationId || !invite) {
      throw new Error(`Missing onboarding invite: ${expected.email}`);
    }
    if (invite.status === "accepted" && invite.acceptedUserId) {
      const [membership] = await database.db
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, invite.acceptedUserId), eq(organizationMemberships.status, "active")))
        .limit(1);
      if (!membership) throw new Error(`Accepted onboarding fixture ${expected.email} has no active membership.`);
      const memberships = await database.db
        .select({ organizationId: organizationMemberships.organizationId })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, invite.acceptedUserId));
      if (memberships.length !== 1 || memberships[0]?.organizationId !== organizationId) {
        throw new Error(`Accepted onboarding fixture ${expected.email} crosses organization membership boundaries.`);
      }
    } else if (invite.status !== "pending") {
      throw new Error(`Onboarding fixture ${expected.email} has an invalid invite state: ${invite.status}`);
    }
  }

  const report: Record<string, unknown> = {};
  for (const slug of expectedOrganizations) {
    const organization = bySlug.get(slug)!;
    const units = await database.db
      .select({ id: organizationUnits.id })
      .from(organizationUnits)
      .where(eq(organizationUnits.organizationId, organization.id));
    const unitIds = new Set(units.map(({ id }) => id));
    const sourceRuns = await database.db
      .select({ temporalWorkflowId: sourceIngestionRuns.temporalWorkflowId })
      .from(sourceIngestionRuns)
      .where(eq(sourceIngestionRuns.organizationId, organization.id));
    for (const row of sourceRuns) {
      if (!row.temporalWorkflowId.startsWith(`workflow:${organization.id}:`)) {
        throw new Error(`Source ingestion ${row.temporalWorkflowId} is outside organization ${slug}.`);
      }
    }
    const workflowRows = await database.db
      .select({ id: workflowRuns.id, workflowId: workflowRuns.temporalWorkflowId, status: workflowRuns.status, scope: workflowRuns.scope })
      .from(workflowRuns)
      .where(eq(workflowRuns.organizationId, organization.id));
    const workflowRunIds = new Set(workflowRows.map((row) => row.id));
    const workflowEventRows = await database.db
      .select({ workflowRunId: workflowEvents.workflowRunId })
      .from(workflowEvents)
      .where(eq(workflowEvents.organizationId, organization.id));
    if (workflowRows.length < 5 || !workflowRows.some((row) => row.status === "running") || !workflowRows.some((row) => row.status === "failed")) {
      throw new Error(`Local workflow run fixtures are incomplete for ${slug}.`);
    }
    if (workflowEventRows.length < workflowRows.length * 2 || workflowEventRows.some((row) => !workflowRunIds.has(row.workflowRunId))) {
      throw new Error(`Local workflow event fixtures are incomplete for ${slug}.`);
    }

    const [activeMemberships] = await database.db
      .select({ value: count() })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, organization.id), eq(organizationMemberships.status, "active")));
    const [pendingInvites] = await database.db
      .select({ value: count() })
      .from(organizationInvites)
      .where(and(eq(organizationInvites.organizationId, organization.id), eq(organizationInvites.status, "pending")));

    const [integrationCount] = await database.db.select({ value: count() }).from(integrations).where(eq(integrations.organizationId, organization.id));
    const [sourceCount] = await database.db.select({ value: count() }).from(knowledgeSources).where(eq(knowledgeSources.organizationId, organization.id));
    const [revisionCount] = await database.db.select({ value: count() }).from(sourceRevisions).where(eq(sourceRevisions.organizationId, organization.id));
    const revisionRows = await database.db
      .select({ artifactRef: sourceRevisions.artifactRef })
      .from(sourceRevisions)
      .where(eq(sourceRevisions.organizationId, organization.id));
    if (revisionRows.some((revision) => revision.artifactRef && !revision.artifactRef.startsWith(`artifact://local/${organization.id}/`))) {
      throw new Error(`Organization ${slug} has a source artifact outside its tenant prefix.`);
    }
    const counts = {
      integrations: Number(integrationCount?.value ?? 0),
      knowledgeSources: Number(sourceCount?.value ?? 0),
      sourceRevisions: Number(revisionCount?.value ?? 0),
      sourceIngestionRuns: sourceRuns.length,
      workflowRuns: workflowRows.length,
      workflowEvents: workflowEventRows.length,
      activeMemberships: Number(activeMemberships?.value ?? 0),
      pendingInvites: Number(pendingInvites?.value ?? 0),
    };
    if (counts.integrations < 3 || counts.knowledgeSources < 4 || counts.sourceRevisions < 4 || counts.sourceIngestionRuns < 4) {
      throw new Error(`Local fixture counts are incomplete for ${slug}: ${JSON.stringify(counts)}`);
    }
    report[slug] = { id: organization.id, name: organization.name, counts };
  }

  console.log(JSON.stringify({ ok: true, organizations: report }, null, 2));
}

try {
  await verifyFixtures();
} finally {
  await database.client.end({ timeout: 5 });
}

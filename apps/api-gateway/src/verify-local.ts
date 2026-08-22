import { and, count, eq, inArray } from "drizzle-orm";
import {
  createDatabase,
  integrations,
  knowledgeSources,
  organizationInvites,
  organizationMemberships,
  organizationUnits,
  organizations,
  sourceRevisions,
  sourceIngestionRuns,
  users,
  workflowEvents,
  workflowRuns,
} from "@encois/persistence";

const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL is required for local fixture verification.");

const expectedOrganizations = ["organization-test", "organization-avengers"] as const;
const expectedWorkflowStatuses: readonly string[] = ["queued", "running", "waiting", "partial", "failed", "completed"];
const expectedActiveUsers = [
  { email: "owner@local.test", organizationSlug: "organization-test" },
  { email: "dev@local.test", organizationSlug: "organization-test" },
  { email: "manager@local.test", organizationSlug: "organization-test" },
  { email: "test@local.test", organizationSlug: "organization-test" },
  { email: "avengers-owner@local.test", organizationSlug: "organization-avengers" },
  { email: "avengers-manager@local.test", organizationSlug: "organization-avengers" },
] as const;
const expectedOnboardingUsers = [
  { email: "onboarding1@local.test", organizationSlug: "organization-test" },
  { email: "onboarding2@local.test", organizationSlug: "organization-test" },
  { email: "onboarding3@local.test", organizationSlug: "organization-test" },
  { email: "onboarding4@local.test", organizationSlug: "organization-avengers" },
  { email: "onboarding5@local.test", organizationSlug: "organization-avengers" },
] as const;
const database = createDatabase({ url: databaseUrl });

function scopeIds(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const ids = (value as { ids?: unknown }).ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function metadataString(metadata: unknown, key: string): string | undefined {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

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
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, user.id), eq(organizationMemberships.status, "active")))
      .limit(1);
    if (!membership) throw new Error(`Active fixture ${expected.email} has no active membership in ${expected.organizationSlug}.`);
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
    const [workflowCount] = await database.db
      .select({ value: count() })
      .from(workflowRuns)
      .where(eq(workflowRuns.organizationId, organization.id));
    const [eventCount] = await database.db
      .select({ value: count() })
      .from(workflowEvents)
      .where(eq(workflowEvents.organizationId, organization.id));
    const eventRows = await database.db
      .select({ eventType: workflowEvents.eventType, activityName: workflowEvents.activityName, metadata: workflowEvents.metadata, evidenceRef: workflowEvents.evidenceRef })
      .from(workflowEvents)
      .where(eq(workflowEvents.organizationId, organization.id));
    const statuses = await database.db
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.organizationId, organization.id));
    const units = await database.db
      .select({ id: organizationUnits.id })
      .from(organizationUnits)
      .where(eq(organizationUnits.organizationId, organization.id));
    const unitIds = new Set(units.map(({ id }) => id));
    const workflowRows = await database.db
      .select({ temporalWorkflowId: workflowRuns.temporalWorkflowId, temporalNamespace: workflowRuns.temporalNamespace, temporalTaskQueue: workflowRuns.temporalTaskQueue, scope: workflowRuns.scope })
      .from(workflowRuns)
      .where(eq(workflowRuns.organizationId, organization.id));
    for (const row of workflowRows) {
      if (!row.temporalWorkflowId.startsWith(`workflow:${organization.id}:`)) {
        throw new Error(`Workflow ${row.temporalWorkflowId} is outside organization ${slug}.`);
      }
      if (scopeIds(row.scope).some((id) => !unitIds.has(id))) {
        throw new Error(`Workflow ${row.temporalWorkflowId} has a scope outside organization ${slug}.`);
      }
      if (row.temporalNamespace !== "default" || row.temporalTaskQueue !== "encois-agent-runtime") {
        throw new Error(`Workflow ${row.temporalWorkflowId} has an unexpected local Temporal namespace or task queue.`);
      }
    }
    const sourceRuns = await database.db
      .select({ temporalWorkflowId: sourceIngestionRuns.temporalWorkflowId })
      .from(sourceIngestionRuns)
      .where(eq(sourceIngestionRuns.organizationId, organization.id));
    for (const row of sourceRuns) {
      if (!row.temporalWorkflowId.startsWith(`workflow:${organization.id}:`)) {
        throw new Error(`Source ingestion ${row.temporalWorkflowId} is outside organization ${slug}.`);
      }
    }
    const workflowStatusSet = new Set<string>(statuses.map(({ status }) => status));
    for (const status of expectedWorkflowStatuses) {
      if (!workflowStatusSet.has(status)) throw new Error(`Organization ${slug} is missing workflow status fixture: ${status}`);
    }
    const activityEvents = eventRows.filter((event) => event.eventType.startsWith("activity_") && Boolean(event.activityName));
    const shardEvents = eventRows.filter((event) => Boolean(metadataString(event.metadata, "shard")));
    const issueEvents = eventRows.filter((event) => Boolean(metadataString(event.metadata, "issue")));
    if (activityEvents.length < 2) throw new Error(`Organization ${slug} is missing seeded activity events.`);
    if (shardEvents.length < 4) throw new Error(`Organization ${slug} is missing seeded workflow shard metadata.`);
    if (issueEvents.length < 1) throw new Error(`Organization ${slug} is missing a seeded workflow issue.`);
    if (!eventRows.some((event) => event.evidenceRef?.startsWith(`evidence://local/${slug}/`))) {
      throw new Error(`Organization ${slug} is missing organization-scoped evidence references.`);
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
      workflows: Number(workflowCount?.value ?? 0),
      workflowEvents: Number(eventCount?.value ?? 0),
      sourceIngestionRuns: sourceRuns.length,
      activeMemberships: Number(activeMemberships?.value ?? 0),
      pendingInvites: Number(pendingInvites?.value ?? 0),
      activities: activityEvents.length,
      shards: shardEvents.length,
      issueEvents: issueEvents.length,
    };
    if (counts.integrations < 3 || counts.knowledgeSources < 4 || counts.sourceRevisions < 4 || counts.sourceIngestionRuns < 4 || counts.workflows < 6 || counts.workflowEvents < 24) {
      throw new Error(`Local fixture counts are incomplete for ${slug}: ${JSON.stringify(counts)}`);
    }
    report[slug] = { id: organization.id, name: organization.name, counts, statuses: [...workflowStatusSet].sort() };
  }

  console.log(JSON.stringify({ ok: true, organizations: report }, null, 2));
}

try {
  await verifyFixtures();
} finally {
  await database.client.end({ timeout: 5 });
}

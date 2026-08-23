import { initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  createDatabase,
  integrationBindings,
  integrations,
  knowledgeSources,
  membershipScopes,
  organizationInvites,
  organizationMemberships,
  organizationOnboarding,
  organizationUnits,
  organizations,
  roles,
  sourceIngestionRuns,
  sourceRevisions,
  workflowDefinitions,
  workflowEvents,
  workflowRuns,
  users,
  webhookDeliveries,
  webhookEndpoints,
  type PersistenceTransaction,
} from "@encois/persistence";

const projectId = process.env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || "demo-encois";
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim();
const ownerEmail = process.env.LOCAL_AUTH_EMAIL?.trim().toLowerCase() || "owner@local.test";
const ownerPassword = process.env.LOCAL_AUTH_PASSWORD?.trim() || "local-password-1234";
const ownerUid = process.env.LOCAL_AUTH_UID?.trim() || "local-owner";
const controlPlaneServiceUserId = "00000000-0000-4000-8000-000000000010";

if (process.env.NODE_ENV === "production") throw new Error("The local auth seed cannot run in production.");
if (!emulatorHost) throw new Error("FIREBASE_AUTH_EMULATOR_HOST is required for the local auth seed.");
if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL is required for the local auth seed.");
if (ownerPassword.length < 6) throw new Error("LOCAL_AUTH_PASSWORD must contain at least six characters.");

type OrganizationFixture = {
  slug: string;
  name: string;
  units: readonly { slug: string; name: string; type: "department" | "project" | "team"; parent: string }[];
};

const organizationsFixture: readonly OrganizationFixture[] = [
  {
    slug: "organization-sun",
    name: "Organization Sun",
    units: [
      { slug: "engineering", name: "Engineering", type: "department", parent: "root" },
      { slug: "development", name: "Development", type: "team", parent: "engineering" },
      { slug: "operations", name: "Operations", type: "department", parent: "root" },
      { slug: "checkout", name: "Checkout", type: "project", parent: "development" },
      { slug: "payments-api", name: "Payments API", type: "project", parent: "engineering" },
      { slug: "customer-success", name: "Customer Success", type: "team", parent: "operations" },
    ],
  },
];

type ActiveUserFixture = {
  key: string;
  uid: string;
  email: string;
  password: string;
  displayName: string;
  organizationSlug: string;
  roleKey: "organization_admin" | "manager" | "member" | "viewer";
  unitSlug: string;
  access: "admin" | "manager" | "contributor" | "viewer";
};

const activeUsers: readonly ActiveUserFixture[] = [
  { key: "owner", uid: ownerUid, email: ownerEmail, password: ownerPassword, displayName: "Organization Sun Owner", organizationSlug: "organization-sun", roleKey: "organization_admin", unitSlug: "root", access: "admin" },
  { key: "engineering-manager", uid: "local-manager", email: "manager@local.test", password: "local-manager-1234", displayName: "Engineering Manager", organizationSlug: "organization-sun", roleKey: "manager", unitSlug: "engineering", access: "manager" },
  { key: "dev-manager", uid: "local-dev", email: "dev@local.test", password: "local-dev-1234", displayName: "Dev Manager", organizationSlug: "organization-sun", roleKey: "manager", unitSlug: "development", access: "manager" },
  { key: "viewer", uid: "local-viewer", email: "viewer@local.test", password: "local-viewer-1234", displayName: "Viewer", organizationSlug: "organization-sun", roleKey: "viewer", unitSlug: "checkout", access: "viewer" },
];

type OnboardingFixture = {
  email: string;
  password: string;
  displayName: string;
  uid: string;
  organizationSlug: string;
  unitSlug: string;
  roleKey: "organization_admin";
};

const onboardingUsers: readonly OnboardingFixture[] = [
  { email: "onboarding1@local.test", password: "local-onboarding-1", displayName: "Onboarding One", uid: "local-onboarding-1", organizationSlug: "organization-sun", unitSlug: "root", roleKey: "organization_admin" },
  { email: "onboarding2@local.test", password: "local-onboarding-2", displayName: "Onboarding Two", uid: "local-onboarding-2", organizationSlug: "organization-sun", unitSlug: "engineering", roleKey: "organization_admin" },
  { email: "onboarding3@local.test", password: "local-onboarding-3", displayName: "Onboarding Three", uid: "local-onboarding-3", organizationSlug: "organization-sun", unitSlug: "checkout", roleKey: "organization_admin" },
];

const firebaseApp = initializeApp({ projectId }, `local-auth-seed-${projectId}`);
const auth = getAuth(firebaseApp);
const database = createDatabase({ url: databaseUrl });

type FixtureUnit = { id: string; slug: string };
type FixtureUser = { id: string; email: string };
type FixtureIntegration = { id: string; displayName: string; provider: string };
type FixtureSource = { id: string; name: string; revisionId: string };
type FixtureOrganization = { id: string; slug: string; name: string; units: Map<string, FixtureUnit> };
type WorkflowFixtureStatus = "running" | "waiting" | "partial" | "failed" | "completed";

type WorkflowFixture = {
  key: string;
  status: WorkflowFixtureStatus;
  scopeUnit: string;
  actorKey: string;
  activityName: string;
};

const workflowFixtures: readonly WorkflowFixture[] = [
  { key: "release-readiness", status: "running", scopeUnit: "engineering", actorKey: "owner", activityName: "collect-code-changes" },
  { key: "engineering-delivery-health", status: "waiting", scopeUnit: "engineering", actorKey: "engineering-manager", activityName: "review-evidence" },
  { key: "automation-test-readiness", status: "completed", scopeUnit: "checkout", actorKey: "dev-manager", activityName: "assess-test-readiness" },
  { key: "critical-issues", status: "failed", scopeUnit: "operations", actorKey: "owner", activityName: "collect-incidents" },
  { key: "documentation-state", status: "partial", scopeUnit: "root", actorKey: "owner", activityName: "find-documentation-drift" },
];

async function waitForAuthEmulator(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await auth.listUsers(1);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Firebase Auth Emulator did not become ready at ${emulatorHost}.`);
}

async function ensureAuthUser(uid: string, email: string, password: string, displayName: string): Promise<UserRecord> {
  try {
    const existing = await auth.getUserByEmail(email);
    return auth.updateUser(existing.uid, { displayName, emailVerified: true, password });
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    return auth.createUser({ uid, displayName, email, emailVerified: true, password });
  }
}

async function ensureOrganization(tx: PersistenceTransaction, fixture: OrganizationFixture): Promise<FixtureOrganization> {
  const [existing] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, fixture.slug)).limit(1);
  const organization = existing
    ? (await tx.update(organizations).set({ name: fixture.name, updatedAt: new Date() }).where(eq(organizations.id, existing.id)).returning({ id: organizations.id }))[0]
    : (await tx.insert(organizations).values({ name: fixture.name, slug: fixture.slug }).returning({ id: organizations.id }))[0];
  if (!organization) throw new Error(`Local organization ${fixture.slug} was not created.`);

  // This is explicit fixture data, not an API fallback. The seeded
  // organizations represent an already bootstrapped local demo; real
  // organizations get this row during creation or migration and transition
  // through the Coordinator lifecycle.
  await tx.insert(organizationOnboarding).values({
    organizationId: organization.id,
    coordinatorId: `organization:${organization.id}`,
    status: "ready",
  }).onConflictDoUpdate({
    target: organizationOnboarding.organizationId,
    set: { status: "ready", lastError: null, updatedAt: new Date() },
  });

  const root = await ensureUnit(tx, organization.id, null, "organization", "root", fixture.name);
  await ensureControlPlaneServiceUser(tx, organization.id, root.id, fixture.name);
  const units = new Map<string, FixtureUnit>([[root.slug, root]]);
  for (const unit of fixture.units) {
    const parent = units.get(unit.parent);
    if (!parent) throw new Error(`Parent unit ${unit.parent} is missing for ${unit.slug}.`);
    units.set(unit.slug, await ensureUnit(tx, organization.id, parent.id, unit.type, unit.slug, unit.name));
  }
  return { id: organization.id, slug: fixture.slug, name: fixture.name, units };
}

async function ensureControlPlaneServiceUser(
  tx: PersistenceTransaction,
  organizationId: string,
  rootUnitId: string,
  organizationName: string,
): Promise<void> {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, controlPlaneServiceUserId))
    .limit(1);
  if (!user) {
    await tx.insert(users).values({
      id: controlPlaneServiceUserId,
      identityProvider: "identity-platform",
      identitySubject: "local-control-plane",
      email: "control-plane@local.test",
      displayName: "Local Control Plane",
    });
  }
  const role = await systemRole(tx, "organization_admin");
  const [membership] = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, controlPlaneServiceUserId)))
    .limit(1);
  const membershipId = membership?.id ?? (await tx.insert(organizationMemberships).values({ organizationId, userId: controlPlaneServiceUserId, roleId: role.id, status: "active" }).returning({ id: organizationMemberships.id }))[0]?.id;
  if (!membershipId) throw new Error(`Local control-plane membership for ${organizationName} was not persisted.`);
  await tx.insert(membershipScopes).values({ organizationId, membershipId, organizationUnitId: rootUnitId, access: "admin" }).onConflictDoUpdate({ target: [membershipScopes.membershipId, membershipScopes.organizationUnitId], set: { access: "admin" } });
}

async function ensureUnit(
  tx: PersistenceTransaction,
  organizationId: string,
  parentId: string | null,
  type: "organization" | "department" | "project" | "team",
  slug: string,
  name: string,
): Promise<FixtureUnit> {
  const [existing] = await tx
    .select({ id: organizationUnits.id })
    .from(organizationUnits)
    .where(and(eq(organizationUnits.organizationId, organizationId), parentId ? eq(organizationUnits.parentId, parentId) : isNull(organizationUnits.parentId), eq(organizationUnits.type, type), eq(organizationUnits.slug, slug)))
    .limit(1);
  const unit = existing
    ? (await tx.update(organizationUnits).set({ name, updatedAt: new Date() }).where(eq(organizationUnits.id, existing.id)).returning({ id: organizationUnits.id }))[0]
    : (await tx.insert(organizationUnits).values({ organizationId, parentId, type, slug, name }).returning({ id: organizationUnits.id }))[0];
  if (!unit) throw new Error(`Local organization unit ${slug} was not created.`);
  return { id: unit.id, slug };
}

async function systemRole(tx: PersistenceTransaction, key: string): Promise<{ id: string; key: string }> {
  const [role] = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(and(eq(roles.key, key), isNull(roles.organizationId))).limit(1);
  if (!role) throw new Error(`System ${key} role is missing. Run database migrations first.`);
  return role;
}

async function resolvePersistentUser(tx: PersistenceTransaction, identity: UserRecord): Promise<FixtureUser | undefined> {
  const email = identity.email?.trim().toLowerCase();
  const [bySubject] = await tx.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.identityProvider, "identity-platform"), eq(users.identitySubject, identity.uid))).limit(1);
  const [existing] = bySubject
    ? [bySubject]
    : email
      ? await tx.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.identityProvider, "identity-platform"), eq(users.email, email))).orderBy(desc(users.updatedAt), desc(users.createdAt)).limit(1)
      : [];
  if (!existing) return undefined;
  await tx.update(users).set({ email, identitySubject: identity.uid, displayName: identity.displayName, updatedAt: new Date() }).where(eq(users.id, existing.id));
  return { id: existing.id, email: email ?? existing.email ?? identity.uid };
}

async function ensureActiveFixtureUser(
  tx: PersistenceTransaction,
  organization: FixtureOrganization,
  identity: UserRecord,
  spec: Pick<ActiveUserFixture, "roleKey" | "unitSlug" | "access">,
): Promise<FixtureUser> {
  const user = await resolvePersistentUser(tx, identity) ?? (
    await tx.insert(users).values({ identityProvider: "identity-platform", identitySubject: identity.uid, email: identity.email, displayName: identity.displayName }).returning({ id: users.id, email: users.email })
  )[0];
  if (!user) throw new Error(`Local user ${identity.email} was not persisted.`);
  const role = await systemRole(tx, spec.roleKey);
  const unit = organization.units.get(spec.unitSlug);
  if (!unit) throw new Error(`Scope unit ${spec.unitSlug} is missing in ${organization.slug}.`);
  const [existingMembership] = await tx.select({ id: organizationMemberships.id }).from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, organization.id), eq(organizationMemberships.userId, user.id))).limit(1);
  const membershipId = existingMembership?.id ?? (await tx.insert(organizationMemberships).values({ organizationId: organization.id, userId: user.id, roleId: role.id, status: "active" }).returning({ id: organizationMemberships.id }))[0]?.id;
  if (!membershipId) throw new Error(`Local membership for ${identity.email} was not persisted.`);
  await tx.update(organizationMemberships).set({ roleId: role.id, status: "active", updatedAt: new Date() }).where(eq(organizationMemberships.id, membershipId));
  await tx.insert(membershipScopes).values({ organizationId: organization.id, membershipId, organizationUnitId: unit.id, access: spec.access }).onConflictDoUpdate({ target: [membershipScopes.membershipId, membershipScopes.organizationUnitId], set: { access: spec.access } });
  const email = (identity.email ?? "").trim().toLowerCase();
  if (!email) throw new Error(`Local fixture ${identity.uid} has no email.`);
  const [existingInvite] = await tx
    .select({ id: organizationInvites.id })
    .from(organizationInvites)
    .where(and(eq(organizationInvites.organizationId, organization.id), eq(organizationInvites.emailNormalized, email)))
    .orderBy(desc(organizationInvites.updatedAt))
    .limit(1);
  const acceptedInvite = {
    organizationUnitId: unit.id,
    roleId: role.id,
    status: "accepted" as const,
    acceptedUserId: user.id,
    acceptedAt: new Date(),
    updatedAt: new Date(),
  };
  if (existingInvite) await tx.update(organizationInvites).set(acceptedInvite).where(eq(organizationInvites.id, existingInvite.id));
  else await tx.insert(organizationInvites).values({ organizationId: organization.id, emailNormalized: email, ...acceptedInvite });
  return { id: user.id, email: user.email ?? identity.email ?? "unknown@local.test" };
}

async function ensurePendingInvite(tx: PersistenceTransaction, organization: FixtureOrganization, spec: OnboardingFixture): Promise<void> {
  const unit = organization.units.get(spec.unitSlug);
  if (!unit) throw new Error(`Onboarding scope unit ${spec.unitSlug} is missing in ${organization.slug}.`);
  const role = await systemRole(tx, spec.roleKey);
  const email = spec.email.toLowerCase();
  const [existing] = await tx.select({ id: organizationInvites.id, status: organizationInvites.status }).from(organizationInvites).where(and(eq(organizationInvites.organizationId, organization.id), eq(organizationInvites.emailNormalized, email))).orderBy(desc(organizationInvites.updatedAt)).limit(1);
  if (existing?.status === "accepted") return;
  if (existing) {
    await tx.update(organizationInvites).set({ organizationUnitId: unit.id, roleId: role.id, status: "pending", acceptedUserId: null, acceptedAt: null, updatedAt: new Date() }).where(eq(organizationInvites.id, existing.id));
    return;
  }
  await tx.insert(organizationInvites).values({ emailNormalized: email, organizationId: organization.id, organizationUnitId: unit.id, roleId: role.id, status: "pending" });
}

async function ensureIntegration(
  tx: PersistenceTransaction,
  organization: FixtureOrganization,
  displayName: string,
  provider: string,
  unitSlug: string,
  createdByUserId: string,
  status: "pending" | "active" | "disabled" | "error" = "active",
): Promise<FixtureIntegration> {
  const unit = organization.units.get(unitSlug);
  if (!unit) throw new Error(`Integration scope unit ${unitSlug} is missing in ${organization.slug}.`);
  const [existing] = await tx.select({ id: integrations.id, displayName: integrations.displayName, provider: integrations.provider }).from(integrations).where(and(eq(integrations.organizationId, organization.id), eq(integrations.displayName, displayName))).limit(1);
  const integration = existing
    ? (await tx.update(integrations).set({ provider, status, credentialRef: status === "active" ? `local://mock/${provider}` : null, createdByUserId, updatedAt: new Date() }).where(eq(integrations.id, existing.id)).returning({ id: integrations.id, displayName: integrations.displayName, provider: integrations.provider }))[0]
    : (await tx.insert(integrations).values({ organizationId: organization.id, provider, displayName, status, credentialRef: status === "active" ? `local://mock/${provider}` : null, createdByUserId }).returning({ id: integrations.id, displayName: integrations.displayName, provider: integrations.provider }))[0];
  if (!integration) throw new Error(`Local integration ${displayName} was not created.`);
  const grantedScopes = provider === "github" ? ["code.read", "pull-requests.read", "activity.read"] : provider === "jira" ? ["issues.read", "activity.read"] : provider === "slack" ? ["messages.read", "activity.read"] : ["read"];
  await tx.insert(integrationBindings).values({ organizationId: organization.id, integrationId: integration.id, organizationUnitId: unit.id, status: "active", grantedScopes, grantedByUserId: createdByUserId }).onConflictDoUpdate({ target: [integrationBindings.integrationId, integrationBindings.organizationUnitId], set: { status: "active", grantedScopes, grantedByUserId: createdByUserId, revokedAt: null } });
  return integration;
}

async function ensureKnowledgeSource(
  tx: PersistenceTransaction,
  organization: FixtureOrganization,
  sourceKey: string,
  name: string,
  kind: "integration" | "manual",
  unitSlug: string,
  sourceStatus: "active" | "degraded" | "failed" | "ingesting",
  provider?: string,
  integrationId?: string,
): Promise<FixtureSource> {
  const unit = organization.units.get(unitSlug);
  if (!unit) throw new Error(`Knowledge source scope unit ${unitSlug} is missing in ${organization.slug}.`);
  const sourceValues = {
    organizationId: organization.id,
    name,
    kind,
    ...(provider ? { provider } : {}),
    ...(integrationId ? { integrationId } : {}),
    status: sourceStatus,
    readScope: { ids: [unit.id] },
    visibilityScope: { ids: [unit.id] },
    contentType: "application/json",
    configuration: { fixture: true, sourceKey },
  } as const;
  const [existing] = await tx.select({ id: knowledgeSources.id }).from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, organization.id), eq(knowledgeSources.name, name))).limit(1);
  const source = existing
    ? (await tx.update(knowledgeSources).set({ ...sourceValues, updatedAt: new Date() }).where(eq(knowledgeSources.id, existing.id)).returning({ id: knowledgeSources.id }))[0]
    : (await tx.insert(knowledgeSources).values(sourceValues).returning({ id: knowledgeSources.id }))[0];
  if (!source) throw new Error(`Local knowledge source ${name} was not created.`);

  const revisionStatus = sourceStatus === "failed" ? "failed" : sourceStatus === "ingesting" ? "ingesting" : "active";
  const [revision] = await tx.select({ id: sourceRevisions.id }).from(sourceRevisions).where(and(eq(sourceRevisions.organizationId, organization.id), eq(sourceRevisions.sourceId, source.id), eq(sourceRevisions.revision, "r1"))).limit(1);
  const revisionRow = revision
    ? (await tx.update(sourceRevisions).set({ status: revisionStatus, artifactRef: `artifact://local/${organization.id}/${sourceKey}/r1`, sourceObjectId: `${organization.slug}/${sourceKey}/r1`, contentType: "application/json", checksum: `fixture-${organization.slug}-${sourceKey}-r1`, observedAt: new Date(Date.now() - 60 * 60 * 1000), ingestedAt: revisionStatus === "active" ? new Date(Date.now() - 30 * 60 * 1000) : null, metadata: { fixture: true, sourceKey } }).where(eq(sourceRevisions.id, revision.id)).returning({ id: sourceRevisions.id }))[0]
    : (await tx.insert(sourceRevisions).values({ organizationId: organization.id, sourceId: source.id, revision: "r1", status: revisionStatus, artifactRef: `artifact://local/${organization.id}/${sourceKey}/r1`, sourceObjectId: `${organization.slug}/${sourceKey}/r1`, contentType: "application/json", checksum: `fixture-${organization.slug}-${sourceKey}-r1`, observedAt: new Date(Date.now() - 60 * 60 * 1000), ingestedAt: revisionStatus === "active" ? new Date(Date.now() - 30 * 60 * 1000) : undefined, metadata: { fixture: true, sourceKey } }).returning({ id: sourceRevisions.id }))[0];
  if (!revisionRow) throw new Error(`Revision for ${name} was not created.`);
  await tx.update(knowledgeSources).set({ currentRevisionId: revisionRow.id }).where(eq(knowledgeSources.id, source.id));
  return { id: source.id, name, revisionId: revisionRow.id };
}

async function ensureSourceIngestion(tx: PersistenceTransaction, organization: FixtureOrganization, source: FixtureSource, status: "queued" | "running" | "completed" | "failed", stage: string, factsCount: number): Promise<void> {
  const temporalWorkflowId = `workflow:${organization.id}:encois.source-ingestion.v1:${source.id}:r1`;
  const [existing] = await tx.select({ id: sourceIngestionRuns.id }).from(sourceIngestionRuns).where(and(eq(sourceIngestionRuns.organizationId, organization.id), eq(sourceIngestionRuns.temporalWorkflowId, temporalWorkflowId))).limit(1);
  const now = new Date();
  const values = { organizationId: organization.id, sourceId: source.id, sourceRevisionId: source.revisionId, temporalWorkflowId, temporalRunId: `mock-run:${organization.slug}:source:${source.id}`, trigger: "bootstrap" as const, status, currentStage: stage, factsCount, ...(status === "failed" ? { error: "Fixture provider returned a retryable error." } : {}), startedAt: status === "queued" ? undefined : new Date(now.getTime() - 10 * 60 * 1000), completedAt: status === "completed" || status === "failed" ? new Date(now.getTime() - 2 * 60 * 1000) : undefined, updatedAt: now };
  if (existing) await tx.update(sourceIngestionRuns).set(values).where(eq(sourceIngestionRuns.id, existing.id));
  else await tx.insert(sourceIngestionRuns).values(values);
}

async function ensureWorkflowFixtures(
  tx: PersistenceTransaction,
  organization: FixtureOrganization,
  usersByKey: ReadonlyMap<string, FixtureUser>,
): Promise<void> {
  const now = new Date();
  const [definition] = await tx
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.organizationId, organization.id), eq(workflowDefinitions.key, "encois.user-blueprint.v1"), eq(workflowDefinitions.version, "v1")))
    .limit(1);
  const definitionRow = definition ?? (await tx.insert(workflowDefinitions).values({
    organizationId: organization.id,
    key: "encois.user-blueprint.v1",
    version: "v1",
    status: "approved",
    inputSchemaRef: "contract://workflow-blueprint.v1",
    outputSchemaRef: "contract://workflow-result.v1",
  }).returning({ id: workflowDefinitions.id }))[0];
  if (!definitionRow) throw new Error("Local workflow definition was not created.");

  for (const fixture of workflowFixtures) {
    const unit = organization.units.get(fixture.scopeUnit);
    const actor = usersByKey.get(fixture.actorKey);
    if (!unit) throw new Error(`Workflow scope unit ${fixture.scopeUnit} is missing in ${organization.slug}.`);
    if (!actor) throw new Error(`Workflow actor ${fixture.actorKey} is missing in ${organization.slug}.`);

    const workflowId = `workflow:${organization.id}:encois.user-blueprint.v1:${fixture.key}`;
    const startedAt = new Date(now.getTime() - 25 * 60 * 1000);
    const completedAt = fixture.status === "completed" || fixture.status === "failed"
      ? new Date(now.getTime() - 5 * 60 * 1000)
      : null;
    const runValues = {
      organizationId: organization.id,
      definitionId: definitionRow.id,
      actorUserId: actor.id,
      temporalNamespace: "local-fixture",
      temporalTaskQueue: "encois-agent-runtime",
      temporalWorkflowId: workflowId,
      temporalRunId: null,
      blueprintId: fixture.key,
      blueprintVersion: "1.0.0",
      trigger: "local-fixture",
      status: fixture.status,
      scope: { ids: [unit.id] },
      businessInput: { fixture: true, temporalExecution: "not-created" },
      inputRef: `artifact://local/${organization.id}/workflows/${fixture.key}/input.json`,
      resultRef: completedAt ? `artifact://local/${organization.id}/workflows/${fixture.key}/result.json` : null,
      startedAt,
      completedAt,
      retentionUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    } as const;
    const [existingRun] = await tx
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.organizationId, organization.id), eq(workflowRuns.temporalWorkflowId, workflowId)))
      .limit(1);
    const run = existingRun
      ? (await tx.update(workflowRuns).set(runValues).where(eq(workflowRuns.id, existingRun.id)).returning({ id: workflowRuns.id }))[0]
      : (await tx.insert(workflowRuns).values(runValues).returning({ id: workflowRuns.id }))[0];
    if (!run) throw new Error(`Local workflow run ${fixture.key} was not created.`);

    const eventValues = [
      {
        eventType: "workflow_started",
        status: "running",
        activityName: "workflow-start",
        evidenceRef: `artifact://local/${organization.id}/workflows/${fixture.key}/input.json`,
        metadata: { fixture: true, temporalExecution: "not-created" },
      },
      {
        eventType: fixture.status === "failed" ? "workflow_failed" : "workflow_status",
        status: fixture.status,
        activityName: fixture.activityName,
        evidenceRef: `artifact://local/${organization.id}/workflows/${fixture.key}/evidence.json`,
        metadata: {
          fixture: true,
          temporalExecution: "not-created",
          ...(fixture.status === "failed" ? { error: "The local fixture has no Temporal execution." } : {}),
        },
      },
    ] as const;
    for (const event of eventValues) {
      const [existingEvent] = await tx
        .select({ id: workflowEvents.id })
        .from(workflowEvents)
        .where(and(eq(workflowEvents.organizationId, organization.id), eq(workflowEvents.workflowRunId, run.id), eq(workflowEvents.eventType, event.eventType), eq(workflowEvents.activityName, event.activityName)))
        .limit(1);
      if (existingEvent) {
        await tx.update(workflowEvents).set({ ...event, occurredAt: now }).where(eq(workflowEvents.id, existingEvent.id));
      } else {
        await tx.insert(workflowEvents).values({ organizationId: organization.id, workflowRunId: run.id, ...event });
      }
    }
  }
}

async function ensureWebhookFixture(tx: PersistenceTransaction, organization: FixtureOrganization, provider: string, endpointKey: string, integrationId?: string): Promise<void> {
  const [existing] = await tx.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(and(eq(webhookEndpoints.organizationId, organization.id), eq(webhookEndpoints.endpointKey, endpointKey))).limit(1);
  const endpoint = existing
    ? (await tx.update(webhookEndpoints).set({ provider, integrationId, secretRef: `local://mock/${endpointKey}`, status: "active", updatedAt: new Date() }).where(eq(webhookEndpoints.id, existing.id)).returning({ id: webhookEndpoints.id }))[0]
    : (await tx.insert(webhookEndpoints).values({ organizationId: organization.id, provider, endpointKey, integrationId, secretRef: `local://mock/${endpointKey}`, status: "active" }).returning({ id: webhookEndpoints.id }))[0];
  if (!endpoint) throw new Error(`Webhook endpoint ${endpointKey} was not created.`);
  const [delivery] = await tx.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(and(eq(webhookDeliveries.organizationId, organization.id), eq(webhookDeliveries.endpointId, endpoint.id), eq(webhookDeliveries.providerEventId, `${endpointKey}-event-1`))).limit(1);
  if (!delivery) await tx.insert(webhookDeliveries).values({ organizationId: organization.id, endpointId: endpoint.id, providerEventId: `${endpointKey}-event-1`, status: "processed", payloadRef: `artifact://local/${organization.id}/webhooks/${endpointKey}/event-1`, receivedAt: new Date(Date.now() - 15 * 60 * 1000), processedAt: new Date(Date.now() - 14 * 60 * 1000) });
}

async function seedFixtures(): Promise<unknown> {
  await waitForAuthEmulator();
  const identities = new Map<string, UserRecord>();
  for (const spec of [...activeUsers, ...onboardingUsers]) identities.set(spec.email, await ensureAuthUser(spec.uid, spec.email, spec.password, spec.displayName));

  return database.db.transaction(async (tx) => {
    const organizationsBySlug = new Map<string, FixtureOrganization>();
    for (const fixture of organizationsFixture) organizationsBySlug.set(fixture.slug, await ensureOrganization(tx, fixture));

    const usersByKey = new Map<string, FixtureUser>();
    for (const spec of activeUsers) {
      const organization = organizationsBySlug.get(spec.organizationSlug);
      const identity = identities.get(spec.email);
      if (!organization || !identity) throw new Error(`Active fixture ${spec.key} is incomplete.`);
      usersByKey.set(spec.key, await ensureActiveFixtureUser(tx, organization, identity, spec));
    }
    for (const spec of onboardingUsers) {
      const organization = organizationsBySlug.get(spec.organizationSlug);
      if (!organization) throw new Error(`Onboarding fixture ${spec.email} has no organization.`);
      await ensurePendingInvite(tx, organization, spec);
    }

    const outputOrganizations: unknown[] = [];
    for (const organizationSpec of organizationsFixture) {
      const organization = organizationsBySlug.get(organizationSpec.slug)!;
      const owner = usersByKey.get("owner")!;
      const engineeringUnit = organization.units.get("engineering")!;
      const operationsUnit = organization.units.get("operations")!;
      const firstIntegration = await ensureIntegration(tx, organization, "GitHub Engineering", "github", engineeringUnit.slug, owner.id);
      const secondIntegration = await ensureIntegration(tx, organization, "Jira Operations", "jira", operationsUnit.slug, owner.id);
      const thirdIntegration = await ensureIntegration(tx, organization, "Slack Notifications", "slack", "root", owner.id, "disabled");
      const sources = [
        await ensureKnowledgeSource(tx, organization, "github", "GitHub Engineering context", "integration", engineeringUnit.slug, "active", "github", firstIntegration.id),
        await ensureKnowledgeSource(tx, organization, "jira", "Jira Operations context", "integration", operationsUnit.slug, "degraded", "jira", secondIntegration.id),
        await ensureKnowledgeSource(tx, organization, "handbook", "Company handbook", "manual", "root", "active"),
        await ensureKnowledgeSource(tx, organization, "incident-log", "Incident log", "integration", operationsUnit.slug, "failed", "slack", thirdIntegration.id),
      ];
      await ensureSourceIngestion(tx, organization, sources[0]!, "completed", "memory_distilled", 48);
      await ensureSourceIngestion(tx, organization, sources[1]!, "running", "normalized", 17);
      await ensureSourceIngestion(tx, organization, sources[2]!, "completed", "graph_projected", 12);
      await ensureSourceIngestion(tx, organization, sources[3]!, "failed", "acquired", 0);
      await ensureWebhookFixture(tx, organization, "github", "github-events", firstIntegration.id);
      await ensureWebhookFixture(tx, organization, "jira", "jira-events", secondIntegration.id);
      await ensureWorkflowFixtures(tx, organization, usersByKey);
      outputOrganizations.push({ id: organization.id, slug: organization.slug, name: organization.name, units: [...organization.units.values()], integrations: [firstIntegration, secondIntegration, thirdIntegration], sources: sources.map(({ id, name, revisionId }) => ({ id, name, revisionId })) });
    }
    return {
      organizations: outputOrganizations,
      activeUsers: activeUsers.map((user) => ({ email: user.email, password: user.password, organization: user.organizationSlug, role: user.roleKey, scope: user.unitSlug })),
      onboardingUsers: onboardingUsers.map((user) => ({ email: user.email, password: user.password, organization: user.organizationSlug, scope: user.unitSlug })),
      workflowMode: "temporal (persisted fixture runs intentionally have no execution)",
      memoryMode: "mock (process-scoped; source ingestion warms it when workflows execute)",
    };
  });
}

try {
  console.log(JSON.stringify(await seedFixtures(), null, 2));
} finally {
  await database.client.end({ timeout: 5 });
}

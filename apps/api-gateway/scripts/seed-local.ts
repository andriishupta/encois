import {
  ContractVersion,
  TemporalWorkflowType,
  type WorkflowBlueprint,
} from "@encois/contracts";
import {
  createDatabase,
  type DatabaseTransaction,
  integrationBindings,
  integrationCatalog,
  integrations,
  knowledgeSources,
  membershipScopes,
  organizationInvites,
  organizationMemberships,
  organizationOnboarding,
  organizations,
  organizationUnits,
  roles,
  sourceIngestionRuns,
  sourceRevisions,
  users,
  webhookDeliveries,
  webhookEndpoints,
  workflowBlueprints,
  workflowDefinitions,
  workflowEvents,
  workflowRuns,
} from "@encois/database";
import {
  Client,
  Connection,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { and, desc, eq, isNull } from "drizzle-orm";
import { initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { buildCoordinatorWorkflowId } from "../src/workflows/types.js";

const projectId =
  process.env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || "demo-encois";
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const databaseUrl =
  process.env.DATABASE_SEED_URL?.trim() ||
  process.env.DATABASE_MIGRATION_URL?.trim();
const identityMode =
  process.env.DEMO_SEED_IDENTITY_MODE?.trim() ||
  (emulatorHost ? "emulator" : "none");
const allowManagedSeed = process.env.DEMO_SEED_ALLOW_MANAGED === "true";
const demoOrganizationSlug =
  process.env.SEED_ORGANIZATION_SLUG?.trim() || "organization-sun";
const demoOrganizationName =
  process.env.DEMO_SEED_ORGANIZATION_NAME?.trim() || "Sun Inc";
const managedOwnerEmail =
  process.env.DEMO_SEED_OWNER_EMAIL?.trim().toLowerCase() || undefined;
const ownerEmail =
  process.env.LOCAL_AUTH_EMAIL?.trim().toLowerCase() || "owner@local.test";
const ownerPassword =
  process.env.LOCAL_AUTH_PASSWORD?.trim() || "local-password-1234";
const ownerUid = process.env.LOCAL_AUTH_UID?.trim() || "local-owner";
const controlPlaneServiceUserId =
  process.env.CONTROL_PLANE_SERVICE_USER_ID?.trim() ||
  "00000000-0000-4000-8000-000000000010";

if (identityMode !== "emulator" && identityMode !== "none")
  throw new Error("DEMO_SEED_IDENTITY_MODE must be emulator or none.");
if (identityMode === "emulator" && !emulatorHost)
  throw new Error(
    "FIREBASE_AUTH_EMULATOR_HOST is required when DEMO_SEED_IDENTITY_MODE=emulator.",
  );
if (identityMode === "none" && !allowManagedSeed)
  throw new Error(
    "DEMO_SEED_ALLOW_MANAGED=true is required when seeding without the Firebase Auth Emulator.",
  );
if (!databaseUrl)
  throw new Error(
    "DATABASE_SEED_URL or DATABASE_MIGRATION_URL is required for the demo seed.",
  );
if (identityMode === "emulator" && ownerPassword.length < 6)
  throw new Error("LOCAL_AUTH_PASSWORD must contain at least six characters.");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(demoOrganizationSlug))
  throw new Error(
    "SEED_ORGANIZATION_SLUG must be a lowercase kebab-case slug.",
  );

type OrganizationFixture = {
  slug: string;
  name: string;
  units: readonly {
    slug: string;
    name: string;
    type: "department" | "project" | "team";
    parent: string;
  }[];
};

const organizationsFixture: readonly OrganizationFixture[] = [
  {
    slug: demoOrganizationSlug,
    name: demoOrganizationName,
    units: [
      {
        slug: "engineering",
        name: "Engineering",
        type: "department",
        parent: "root",
      },
      {
        slug: "development",
        name: "Development",
        type: "team",
        parent: "engineering",
      },
      {
        slug: "operations",
        name: "Operations",
        type: "department",
        parent: "root",
      },
      {
        slug: "checkout",
        name: "Checkout",
        type: "project",
        parent: "development",
      },
      {
        slug: "payments-api",
        name: "Payments API",
        type: "project",
        parent: "engineering",
      },
      {
        slug: "customer-success",
        name: "Customer Success",
        type: "team",
        parent: "operations",
      },
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
  {
    key: "owner",
    uid: ownerUid,
    email: ownerEmail,
    password: ownerPassword,
    displayName: "John Smith",
    organizationSlug: demoOrganizationSlug,
    roleKey: "organization_admin",
    unitSlug: "root",
    access: "admin",
  },
  {
    key: "engineering-manager",
    uid: "local-manager",
    email: "manager@local.test",
    password: "local-manager-1234",
    displayName: "Sarah Johnson",
    organizationSlug: demoOrganizationSlug,
    roleKey: "manager",
    unitSlug: "engineering",
    access: "manager",
  },
  {
    key: "dev-manager",
    uid: "local-dev",
    email: "dev@local.test",
    password: "local-dev-1234",
    displayName: "Devin Brooks",
    organizationSlug: demoOrganizationSlug,
    roleKey: "manager",
    unitSlug: "development",
    access: "manager",
  },
  {
    key: "viewer",
    uid: "local-viewer",
    email: "viewer@local.test",
    password: "local-viewer-1234",
    displayName: "Alex Carter",
    organizationSlug: demoOrganizationSlug,
    roleKey: "viewer",
    unitSlug: "checkout",
    access: "viewer",
  },
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
  {
    email: "onboarding1@local.test",
    password: "local-onboarding-1",
    displayName: "Taylor Reed",
    uid: "local-onboarding-1",
    organizationSlug: demoOrganizationSlug,
    unitSlug: "root",
    roleKey: "organization_admin",
  },
  {
    email: "onboarding2@local.test",
    password: "local-onboarding-2",
    displayName: "Morgan Lee",
    uid: "local-onboarding-2",
    organizationSlug: demoOrganizationSlug,
    unitSlug: "engineering",
    roleKey: "organization_admin",
  },
  {
    email: "onboarding3@local.test",
    password: "local-onboarding-3",
    displayName: "Jordan Kim",
    uid: "local-onboarding-3",
    organizationSlug: demoOrganizationSlug,
    unitSlug: "checkout",
    roleKey: "organization_admin",
  },
];

const auth =
  identityMode === "emulator"
    ? getAuth(initializeApp({ projectId }, `local-auth-seed-${projectId}`))
    : undefined;
const database = createDatabase({ url: databaseUrl });

type FixtureUnit = { id: string; slug: string };
type FixtureUser = { id: string; email: string };
type FixtureIntegration = { id: string; displayName: string; provider: string };
type FixtureSource = { id: string; name: string; revisionId: string };
type FixtureOrganization = {
  id: string;
  slug: string;
  name: string;
  units: Map<string, FixtureUnit>;
};
type WorkflowFixtureStatus =
  | "running"
  | "waiting"
  | "paused"
  | "partial"
  | "failed"
  | "completed";

type WorkflowFixture = {
  key: string;
  status: WorkflowFixtureStatus;
  scopeUnit: string;
  actorKey: string;
  activityName: string;
};

function generatedWorkflowFixtures(
  status: WorkflowFixtureStatus,
  prefix: string,
  count: number,
  activityName: string,
): readonly WorkflowFixture[] {
  const scopeUnits = [
    "engineering",
    "development",
    "checkout",
    "payments-api",
    "operations",
    "customer-success",
  ] as const;
  const actorKeys = [
    "owner",
    "engineering-manager",
    "dev-manager",
    "viewer",
  ] as const;
  return Array.from({ length: count }, (_, index) => ({
    key: `${prefix}-${String(index + 1).padStart(2, "0")}`,
    status,
    scopeUnit: scopeUnits[index % scopeUnits.length] ?? "root",
    actorKey: actorKeys[index % actorKeys.length] ?? "owner",
    activityName,
  }));
}

const workflowFixtures: readonly WorkflowFixture[] = [
  ...generatedWorkflowFixtures(
    "running",
    "release-readiness",
    6,
    "collect-code-changes",
  ),
  ...generatedWorkflowFixtures(
    "waiting",
    "delivery-health",
    6,
    "review-evidence",
  ),
  ...generatedWorkflowFixtures(
    "completed",
    "test-readiness",
    8,
    "assess-test-readiness",
  ),
  ...generatedWorkflowFixtures(
    "paused",
    "security-review",
    5,
    "await-operator-review",
  ),
  ...generatedWorkflowFixtures(
    "failed",
    "incident-investigation",
    5,
    "collect-incidents",
  ),
];

const temporalAddress =
  process.env.TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233";
const temporalNamespace = process.env.TEMPORAL_NAMESPACE?.trim() || "encois";
const temporalTaskQueue =
  process.env.TEMPORAL_TASK_QUEUE?.trim() || "encois-agent-runtime";
const temporalPolicyVersion =
  process.env.AGENT_GATEWAY_POLICY_VERSION?.trim() ||
  "policy-read-only-fixture-v1";

type TemporalSeedConnection = {
  client: Client;
  connection: Connection;
};

async function connectTemporal(): Promise<TemporalSeedConnection> {
  const apiKey = process.env.TEMPORAL_API_KEY?.trim() || undefined;
  const connection = await Connection.connect({
    address: temporalAddress,
    apiKey,
    tls: Boolean(apiKey),
  });
  return {
    connection,
    client: new Client({ connection, namespace: temporalNamespace }),
  };
}

function demoBlueprint(fixture: WorkflowFixture): WorkflowBlueprint {
  const steps =
    fixture.status === "waiting"
      ? [
          { id: "human-approval", kind: "approval" as const },
          {
            id: "after-approval",
            kind: "transform" as const,
            dependsOn: ["human-approval"],
            input: { approved: true, fixture: true },
          },
        ]
      : fixture.status === "completed"
        ? [
            {
              id: "collect-evidence",
              kind: "transform" as const,
              input: {
                fixture: true,
                activity: fixture.activityName,
                evidenceCount: 12,
              },
            },
            {
              id: "summarize",
              kind: "transform" as const,
              dependsOn: ["collect-evidence"],
              input: { mergePriorResults: true },
            },
          ]
        : [
            {
              id: fixture.status === "failed" ? "invalid-fixture-step" : "hold",
              kind: "wait" as const,
              input: {
                duration:
                  fixture.status === "failed" ? "not-a-duration" : "8760h",
              },
            },
          ];

  return {
    contractVersion: ContractVersion.WorkflowBlueprint,
    blueprintId: fixture.key,
    version: "1.0.0",
    name: fixture.key
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    workflowType: "encois.dynamic.v1",
    purpose: `Demo investigation for ${fixture.activityName}.`,
    enabled: true,
    steps,
    inputSchemaRef: "contract://workflow-blueprint.v1",
    outputSchemaRef: "contract://blueprint-workflow-result.v1",
  };
}

async function waitForAuthEmulator(): Promise<void> {
  if (!auth)
    throw new Error("Firebase Auth Emulator is not configured for this seed.");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await auth.listUsers(1);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(
    `Firebase Auth Emulator did not become ready at ${emulatorHost}.`,
  );
}

async function ensureAuthUser(
  uid: string,
  email: string,
  password: string,
  displayName: string,
): Promise<UserRecord> {
  if (!auth)
    throw new Error("Firebase Auth Emulator is not configured for this seed.");
  try {
    const existing = await auth.getUserByEmail(email);
    return auth.updateUser(existing.uid, {
      displayName,
      emailVerified: true,
      password,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found")
      throw error;
    return auth.createUser({
      uid,
      displayName,
      email,
      emailVerified: true,
      password,
    });
  }
}

async function ensureOrganization(
  tx: DatabaseTransaction,
  fixture: OrganizationFixture,
): Promise<FixtureOrganization> {
  const [existing] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, fixture.slug))
    .limit(1);
  const organization = existing
    ? (
        await tx
          .update(organizations)
          .set({ name: fixture.name, updatedAt: new Date() })
          .where(eq(organizations.id, existing.id))
          .returning({ id: organizations.id })
      )[0]
    : (
        await tx
          .insert(organizations)
          .values({ name: fixture.name, slug: fixture.slug })
          .returning({ id: organizations.id })
      )[0];
  if (!organization)
    throw new Error(`Local organization ${fixture.slug} was not created.`);

  // This is explicit fixture data, not an API fallback. The seeded
  // organizations represent an already bootstrapped local demo; real
  // organizations get this row during creation or migration and transition
  // through the Coordinator lifecycle.
  await tx
    .insert(organizationOnboarding)
    .values({
      organizationId: organization.id,
      coordinatorId: `organization:${organization.id}`,
      status: "ready",
    })
    .onConflictDoUpdate({
      target: organizationOnboarding.organizationId,
      set: { status: "ready", lastError: null, updatedAt: new Date() },
    });

  const root = await ensureUnit(
    tx,
    organization.id,
    null,
    "organization",
    "root",
    fixture.name,
  );
  await ensureControlPlaneServiceUser(
    tx,
    organization.id,
    root.id,
    fixture.name,
  );
  const units = new Map<string, FixtureUnit>([[root.slug, root]]);
  for (const unit of fixture.units) {
    const parent = units.get(unit.parent);
    if (!parent)
      throw new Error(
        `Parent unit ${unit.parent} is missing for ${unit.slug}.`,
      );
    units.set(
      unit.slug,
      await ensureUnit(
        tx,
        organization.id,
        parent.id,
        unit.type,
        unit.slug,
        unit.name,
      ),
    );
  }
  return { id: organization.id, slug: fixture.slug, name: fixture.name, units };
}

async function ensureControlPlaneServiceUser(
  tx: DatabaseTransaction,
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
      identitySubject:
        identityMode === "emulator"
          ? "local-control-plane"
          : "demo-control-plane-service",
      email:
        identityMode === "emulator"
          ? "control-plane@local.test"
          : "control-plane@system.invalid",
      displayName:
        identityMode === "emulator"
          ? "Local Control Plane"
          : "Demo Control Plane Service",
    });
  }
  const role = await systemRole(tx, "organization_admin");
  const [membership] = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, controlPlaneServiceUserId),
      ),
    )
    .limit(1);
  const membershipId =
    membership?.id ??
    (
      await tx
        .insert(organizationMemberships)
        .values({
          organizationId,
          userId: controlPlaneServiceUserId,
          roleId: role.id,
          status: "active",
        })
        .returning({ id: organizationMemberships.id })
    )[0]?.id;
  if (!membershipId)
    throw new Error(
      `Local control-plane membership for ${organizationName} was not persisted.`,
    );
  await tx
    .insert(membershipScopes)
    .values({
      organizationId,
      membershipId,
      organizationUnitId: rootUnitId,
      access: "admin",
    })
    .onConflictDoUpdate({
      target: [
        membershipScopes.membershipId,
        membershipScopes.organizationUnitId,
      ],
      set: { access: "admin" },
    });
}

async function ensureUnit(
  tx: DatabaseTransaction,
  organizationId: string,
  parentId: string | null,
  type: "organization" | "department" | "project" | "team",
  slug: string,
  name: string,
): Promise<FixtureUnit> {
  const [existing] = await tx
    .select({ id: organizationUnits.id })
    .from(organizationUnits)
    .where(
      and(
        eq(organizationUnits.organizationId, organizationId),
        parentId
          ? eq(organizationUnits.parentId, parentId)
          : isNull(organizationUnits.parentId),
        eq(organizationUnits.type, type),
        eq(organizationUnits.slug, slug),
      ),
    )
    .limit(1);
  const unit = existing
    ? (
        await tx
          .update(organizationUnits)
          .set({ name, updatedAt: new Date() })
          .where(eq(organizationUnits.id, existing.id))
          .returning({ id: organizationUnits.id })
      )[0]
    : (
        await tx
          .insert(organizationUnits)
          .values({ organizationId, parentId, type, slug, name })
          .returning({ id: organizationUnits.id })
      )[0];
  if (!unit)
    throw new Error(`Local organization unit ${slug} was not created.`);
  return { id: unit.id, slug };
}

async function systemRole(
  tx: DatabaseTransaction,
  key: string,
): Promise<{ id: string; key: string }> {
  const [role] = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.key, key), isNull(roles.organizationId)))
    .limit(1);
  if (!role)
    throw new Error(
      `System ${key} role is missing. Run database migrations first.`,
    );
  return role;
}

async function resolvePersistentUser(
  tx: DatabaseTransaction,
  identity: UserRecord,
): Promise<FixtureUser | undefined> {
  const email = identity.email?.trim().toLowerCase();
  const [bySubject] = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.identityProvider, "identity-platform"),
        eq(users.identitySubject, identity.uid),
      ),
    )
    .limit(1);
  const [existing] = bySubject
    ? [bySubject]
    : email
      ? await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(
            and(
              eq(users.identityProvider, "identity-platform"),
              eq(users.email, email),
            ),
          )
          .orderBy(desc(users.updatedAt), desc(users.createdAt))
          .limit(1)
      : [];
  if (!existing) return undefined;
  await tx
    .update(users)
    .set({
      email,
      identitySubject: identity.uid,
      displayName: identity.displayName,
      updatedAt: new Date(),
    })
    .where(eq(users.id, existing.id));
  return { id: existing.id, email: email ?? existing.email ?? identity.uid };
}

async function ensureActiveFixtureUser(
  tx: DatabaseTransaction,
  organization: FixtureOrganization,
  identity: UserRecord,
  spec: Pick<ActiveUserFixture, "roleKey" | "unitSlug" | "access">,
): Promise<FixtureUser> {
  const user =
    (await resolvePersistentUser(tx, identity)) ??
    (
      await tx
        .insert(users)
        .values({
          identityProvider: "identity-platform",
          identitySubject: identity.uid,
          email: identity.email,
          displayName: identity.displayName,
        })
        .returning({ id: users.id, email: users.email })
    )[0];
  if (!user) throw new Error(`Local user ${identity.email} was not persisted.`);
  const role = await systemRole(tx, spec.roleKey);
  const unit = organization.units.get(spec.unitSlug);
  if (!unit)
    throw new Error(
      `Scope unit ${spec.unitSlug} is missing in ${organization.slug}.`,
    );
  const [existingMembership] = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organization.id),
        eq(organizationMemberships.userId, user.id),
      ),
    )
    .limit(1);
  const membershipId =
    existingMembership?.id ??
    (
      await tx
        .insert(organizationMemberships)
        .values({
          organizationId: organization.id,
          userId: user.id,
          roleId: role.id,
          status: "active",
        })
        .returning({ id: organizationMemberships.id })
    )[0]?.id;
  if (!membershipId)
    throw new Error(
      `Local membership for ${identity.email} was not persisted.`,
    );
  await tx
    .update(organizationMemberships)
    .set({ roleId: role.id, status: "active", updatedAt: new Date() })
    .where(eq(organizationMemberships.id, membershipId));
  await tx
    .insert(membershipScopes)
    .values({
      organizationId: organization.id,
      membershipId,
      organizationUnitId: unit.id,
      access: spec.access,
    })
    .onConflictDoUpdate({
      target: [
        membershipScopes.membershipId,
        membershipScopes.organizationUnitId,
      ],
      set: { access: spec.access },
    });
  const email = (identity.email ?? "").trim().toLowerCase();
  if (!email) throw new Error(`Local fixture ${identity.uid} has no email.`);
  const [existingInvite] = await tx
    .select({ id: organizationInvites.id })
    .from(organizationInvites)
    .where(
      and(
        eq(organizationInvites.organizationId, organization.id),
        eq(organizationInvites.emailNormalized, email),
      ),
    )
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
  if (existingInvite)
    await tx
      .update(organizationInvites)
      .set(acceptedInvite)
      .where(eq(organizationInvites.id, existingInvite.id));
  else
    await tx.insert(organizationInvites).values({
      organizationId: organization.id,
      emailNormalized: email,
      ...acceptedInvite,
    });
  return {
    id: user.id,
    email: user.email ?? identity.email ?? "unknown@local.test",
  };
}

async function ensurePendingInvite(
  tx: DatabaseTransaction,
  organization: FixtureOrganization,
  spec: Pick<OnboardingFixture, "email" | "unitSlug" | "roleKey">,
): Promise<void> {
  const unit = organization.units.get(spec.unitSlug);
  if (!unit)
    throw new Error(
      `Onboarding scope unit ${spec.unitSlug} is missing in ${organization.slug}.`,
    );
  const role = await systemRole(tx, spec.roleKey);
  const email = spec.email.toLowerCase();
  const [existing] = await tx
    .select({ id: organizationInvites.id, status: organizationInvites.status })
    .from(organizationInvites)
    .where(
      and(
        eq(organizationInvites.organizationId, organization.id),
        eq(organizationInvites.emailNormalized, email),
      ),
    )
    .orderBy(desc(organizationInvites.updatedAt))
    .limit(1);
  if (existing?.status === "accepted") return;
  if (existing) {
    await tx
      .update(organizationInvites)
      .set({
        organizationUnitId: unit.id,
        roleId: role.id,
        status: "pending",
        acceptedUserId: null,
        acceptedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(organizationInvites.id, existing.id));
    return;
  }
  await tx.insert(organizationInvites).values({
    emailNormalized: email,
    organizationId: organization.id,
    organizationUnitId: unit.id,
    roleId: role.id,
    status: "pending",
  });
}

async function ensureIntegration(
  tx: DatabaseTransaction,
  organization: FixtureOrganization,
  displayName: string,
  provider: string,
  createdByUserId: string,
  status: "pending" | "active" | "disabled" | "error" = "active",
  type: "api" | "ai" | "mcp" | "custom" = "api",
): Promise<FixtureIntegration> {
  const rootUnit = organization.units.get("root");
  if (!rootUnit)
    throw new Error(`Organization root is missing in ${organization.slug}.`);
  const [existing] = await tx
    .select({
      id: integrations.id,
      displayName: integrations.displayName,
      provider: integrations.provider,
    })
    .from(integrations)
    .where(
      and(
        eq(integrations.organizationId, organization.id),
        eq(integrations.provider, provider),
        eq(integrations.type, type),
      ),
    )
    .orderBy(desc(integrations.updatedAt))
    .limit(1);
  const integration = existing
    ? (
        await tx
          .update(integrations)
          .set({
            provider,
            type,
            status,
            credentialRef:
              status === "active" ? `local://mock/${provider}` : null,
            createdByUserId,
            updatedAt: new Date(),
          })
          .where(eq(integrations.id, existing.id))
          .returning({
            id: integrations.id,
            displayName: integrations.displayName,
            provider: integrations.provider,
          })
      )[0]
    : (
        await tx
          .insert(integrations)
          .values({
            organizationId: organization.id,
            provider,
            type,
            displayName,
            status,
            credentialRef:
              status === "active" ? `local://mock/${provider}` : null,
            createdByUserId,
          })
          .returning({
            id: integrations.id,
            displayName: integrations.displayName,
            provider: integrations.provider,
          })
      )[0];
  if (!integration)
    throw new Error(`Local integration ${displayName} was not created.`);
  if (integration.displayName !== displayName) {
    await tx
      .update(integrations)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(integrations.id, integration.id));
  }
  const grantedScopes =
    provider === "github"
      ? ["code.read", "pull-requests.read", "activity.read"]
      : provider === "jira"
        ? ["issues.read", "activity.read"]
        : provider === "slack"
          ? ["messages.read", "activity.read"]
          : ["read"];
  await tx
    .insert(integrationBindings)
    .values({
      organizationId: organization.id,
      integrationId: integration.id,
      organizationUnitId: rootUnit.id,
      status: status === "active" ? "active" : "revoked",
      grantedScopes,
      grantedByUserId: createdByUserId,
    })
    .onConflictDoUpdate({
      target: [
        integrationBindings.integrationId,
        integrationBindings.organizationUnitId,
      ],
      set: {
        status: status === "active" ? "active" : "revoked",
        grantedScopes,
        grantedByUserId: createdByUserId,
        revokedAt: status === "active" ? null : new Date(),
      },
    });
  return { ...integration, displayName };
}

const integrationCatalogFixtures = [
  {
    key: "github-api",
    provider: "github",
    displayName: "GitHub",
    description:
      "Repositories, pull requests, and delivery activity through the provider API.",
    type: "api",
    status: "active",
    capabilities: ["code.read", "pull-requests.read", "activity.read"],
    sortOrder: 10,
  },
  {
    key: "jira-api",
    provider: "jira",
    displayName: "Jira",
    description:
      "Issues, projects, and operational activity through the provider API.",
    type: "api",
    status: "active",
    capabilities: ["issues.read", "activity.read"],
    sortOrder: 11,
  },
  {
    key: "gitlab-api",
    provider: "gitlab",
    displayName: "GitLab",
    description: "Repositories, merge requests, and delivery activity.",
    type: "api",
    status: "disabled",
    capabilities: ["code.read", "merge-requests.read", "activity.read"],
    sortOrder: 100,
  },
  {
    key: "linear-api",
    provider: "linear",
    displayName: "Linear",
    description: "Issues and project execution context.",
    type: "api",
    status: "disabled",
    capabilities: ["issues.read", "activity.read"],
    sortOrder: 101,
  },
  {
    key: "slack-api",
    provider: "slack",
    displayName: "Slack",
    description: "Read-only message and activity context.",
    type: "api",
    status: "pending",
    capabilities: ["messages.read", "activity.read"],
    sortOrder: 102,
  },
  {
    key: "google-drive-api",
    provider: "google-drive",
    displayName: "Google Drive",
    description: "Scoped documents for organization context.",
    type: "api",
    status: "disabled",
    capabilities: ["documents.read"],
    sortOrder: 103,
  },
  {
    key: "notion-api",
    provider: "notion",
    displayName: "Notion",
    description: "Pages and databases available to a connected workspace.",
    type: "api",
    status: "disabled",
    capabilities: ["documents.read"],
    sortOrder: 104,
  },
  {
    key: "confluence-api",
    provider: "confluence",
    displayName: "Confluence",
    description: "Knowledge pages and spaces from a connected workspace.",
    type: "api",
    status: "disabled",
    capabilities: ["documents.read"],
    sortOrder: 105,
  },
  {
    key: "microsoft-teams-api",
    provider: "microsoft-teams",
    displayName: "Microsoft Teams",
    description: "Scoped team messages and collaboration activity.",
    type: "api",
    status: "disabled",
    capabilities: ["messages.read", "activity.read"],
    sortOrder: 106,
  },
  {
    key: "pagerduty-api",
    provider: "pagerduty",
    displayName: "PagerDuty",
    description: "Incidents, services, and on-call context.",
    type: "api",
    status: "disabled",
    capabilities: ["incidents.read", "services.read"],
    sortOrder: 107,
  },
  {
    key: "gemini-ai",
    provider: "gemini",
    displayName: "Gemini",
    description: "Gemini model access for approved AI workflow steps.",
    type: "ai",
    status: "pending",
    capabilities: ["model.invoke"],
    sortOrder: 200,
  },
  {
    key: "openai-ai",
    provider: "openai",
    displayName: "OpenAI",
    description: "OpenAI model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke"],
    sortOrder: 201,
  },
  {
    key: "anthropic-ai",
    provider: "anthropic",
    displayName: "Anthropic",
    description: "Anthropic model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke"],
    sortOrder: 202,
  },
  {
    key: "agent-platform",
    provider: "agent-platform",
    displayName: "Agent Platform",
    description: "Google Cloud model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke"],
    sortOrder: 203,
  },
  {
    key: "mistral-ai",
    provider: "mistral",
    displayName: "Mistral",
    description: "Mistral model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke"],
    sortOrder: 204,
  },
  {
    key: "cohere-ai",
    provider: "cohere",
    displayName: "Cohere",
    description: "Cohere model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke"],
    sortOrder: 205,
  },
  {
    key: "groq-ai",
    provider: "groq",
    displayName: "Groq",
    description: "Low-latency model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke"],
    sortOrder: 206,
  },
  {
    key: "perplexity-ai",
    provider: "perplexity",
    displayName: "Perplexity",
    description: "Search-grounded model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke", "web.search"],
    sortOrder: 207,
  },
  {
    key: "xai-ai",
    provider: "xai",
    displayName: "xAI",
    description: "xAI model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke"],
    sortOrder: 208,
  },
  {
    key: "hugging-face-ai",
    provider: "hugging-face",
    displayName: "Hugging Face",
    description: "Hosted model access for approved AI workflow steps.",
    type: "ai",
    status: "disabled",
    capabilities: ["model.invoke"],
    sortOrder: 209,
  },
  {
    key: "github-mcp",
    provider: "github",
    displayName: "GitHub MCP",
    description: "GitHub tools exposed through an MCP connector.",
    type: "mcp",
    status: "pending",
    capabilities: ["tools.read"],
    sortOrder: 300,
  },
  {
    key: "jira-mcp",
    provider: "jira",
    displayName: "Jira MCP",
    description: "Jira tools exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["tools.read"],
    sortOrder: 301,
  },
  {
    key: "slack-mcp",
    provider: "slack",
    displayName: "Slack MCP",
    description: "Slack tools exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["tools.read"],
    sortOrder: 302,
  },
  {
    key: "google-drive-mcp",
    provider: "google-drive",
    displayName: "Google Drive MCP",
    description: "Google Drive tools exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["tools.read"],
    sortOrder: 303,
  },
  {
    key: "notion-mcp",
    provider: "notion",
    displayName: "Notion MCP",
    description: "Notion tools exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["tools.read"],
    sortOrder: 304,
  },
  {
    key: "linear-mcp",
    provider: "linear",
    displayName: "Linear MCP",
    description: "Linear tools exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["tools.read"],
    sortOrder: 305,
  },
  {
    key: "sentry-mcp",
    provider: "sentry",
    displayName: "Sentry MCP",
    description: "Errors and releases exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["errors.read", "releases.read"],
    sortOrder: 306,
  },
  {
    key: "postgres-mcp",
    provider: "postgres",
    displayName: "Postgres MCP",
    description: "Approved database inspection tools exposed through MCP.",
    type: "mcp",
    status: "disabled",
    capabilities: ["database.read"],
    sortOrder: 307,
  },
  {
    key: "cloud-storage-mcp",
    provider: "cloud-storage",
    displayName: "Cloud Storage MCP",
    description: "Approved object inspection tools exposed through MCP.",
    type: "mcp",
    status: "disabled",
    capabilities: ["objects.read"],
    sortOrder: 308,
  },
  {
    key: "google-calendar-mcp",
    provider: "google-calendar",
    displayName: "Google Calendar MCP",
    description: "Calendar context exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["calendar.read"],
    sortOrder: 309,
  },
  {
    key: "confluence-mcp",
    provider: "confluence",
    displayName: "Confluence MCP",
    description: "Confluence knowledge tools exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["documents.read"],
    sortOrder: 310,
  },
  {
    key: "figma-mcp",
    provider: "figma",
    displayName: "Figma MCP",
    description: "Design context exposed through an MCP connector.",
    type: "mcp",
    status: "disabled",
    capabilities: ["design.read"],
    sortOrder: 311,
  },
  {
    key: "custom-connector",
    provider: "custom",
    displayName: "Custom Connector",
    description:
      "Bring a tenant-owned connector through a future adapter boundary.",
    type: "custom",
    status: "disabled",
    capabilities: ["custom.read"],
    sortOrder: 400,
  },
] as const;

async function ensureIntegrationCatalog(tx: DatabaseTransaction) {
  for (const entry of integrationCatalogFixtures) {
    await tx
      .insert(integrationCatalog)
      .values(entry)
      .onConflictDoUpdate({
        target: integrationCatalog.key,
        set: {
          provider: entry.provider,
          displayName: entry.displayName,
          description: entry.description,
          type: entry.type,
          status: entry.status,
          capabilities: entry.capabilities,
          sortOrder: entry.sortOrder,
          updatedAt: new Date(),
        },
      });
  }
}

async function ensureKnowledgeSource(
  tx: DatabaseTransaction,
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
  if (!unit)
    throw new Error(
      `Knowledge source scope unit ${unitSlug} is missing in ${organization.slug}.`,
    );
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
  const [existing] = await tx
    .select({ id: knowledgeSources.id })
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.organizationId, organization.id),
        eq(knowledgeSources.name, name),
      ),
    )
    .limit(1);
  const source = existing
    ? (
        await tx
          .update(knowledgeSources)
          .set({ ...sourceValues, updatedAt: new Date() })
          .where(eq(knowledgeSources.id, existing.id))
          .returning({ id: knowledgeSources.id })
      )[0]
    : (
        await tx
          .insert(knowledgeSources)
          .values(sourceValues)
          .returning({ id: knowledgeSources.id })
      )[0];
  if (!source) throw new Error(`Local Source ${name} was not created.`);

  const revisionStatus =
    sourceStatus === "failed"
      ? "failed"
      : sourceStatus === "ingesting"
        ? "ingesting"
        : "active";
  const [revision] = await tx
    .select({ id: sourceRevisions.id })
    .from(sourceRevisions)
    .where(
      and(
        eq(sourceRevisions.organizationId, organization.id),
        eq(sourceRevisions.sourceId, source.id),
        eq(sourceRevisions.revision, "r1"),
      ),
    )
    .limit(1);
  const revisionRow = revision
    ? (
        await tx
          .update(sourceRevisions)
          .set({
            status: revisionStatus,
            artifactRef: `artifact://local/${organization.id}/${sourceKey}/r1`,
            sourceObjectId: `${organization.slug}/${sourceKey}/r1`,
            contentType: "application/json",
            checksum: `fixture-${organization.slug}-${sourceKey}-r1`,
            observedAt: new Date(Date.now() - 60 * 60 * 1000),
            ingestedAt:
              revisionStatus === "active"
                ? new Date(Date.now() - 30 * 60 * 1000)
                : null,
            metadata: { fixture: true, sourceKey },
          })
          .where(eq(sourceRevisions.id, revision.id))
          .returning({ id: sourceRevisions.id })
      )[0]
    : (
        await tx
          .insert(sourceRevisions)
          .values({
            organizationId: organization.id,
            sourceId: source.id,
            revision: "r1",
            status: revisionStatus,
            artifactRef: `artifact://local/${organization.id}/${sourceKey}/r1`,
            sourceObjectId: `${organization.slug}/${sourceKey}/r1`,
            contentType: "application/json",
            checksum: `fixture-${organization.slug}-${sourceKey}-r1`,
            observedAt: new Date(Date.now() - 60 * 60 * 1000),
            ingestedAt:
              revisionStatus === "active"
                ? new Date(Date.now() - 30 * 60 * 1000)
                : undefined,
            metadata: { fixture: true, sourceKey },
          })
          .returning({ id: sourceRevisions.id })
      )[0];
  if (!revisionRow) throw new Error(`Revision for ${name} was not created.`);
  await tx
    .update(knowledgeSources)
    .set({ currentRevisionId: revisionRow.id })
    .where(eq(knowledgeSources.id, source.id));
  return { id: source.id, name, revisionId: revisionRow.id };
}

async function ensureSourceIngestion(
  tx: DatabaseTransaction,
  organization: FixtureOrganization,
  source: FixtureSource,
  status: "queued" | "running" | "completed" | "failed",
  stage: string,
  factsCount: number,
): Promise<void> {
  const temporalWorkflowId = `workflow:${organization.id}:encois.source-ingestion.v1:${source.id}:r1`;
  const [existing] = await tx
    .select({ id: sourceIngestionRuns.id })
    .from(sourceIngestionRuns)
    .where(
      and(
        eq(sourceIngestionRuns.organizationId, organization.id),
        eq(sourceIngestionRuns.temporalWorkflowId, temporalWorkflowId),
      ),
    )
    .limit(1);
  const now = new Date();
  const values = {
    organizationId: organization.id,
    sourceId: source.id,
    sourceRevisionId: source.revisionId,
    temporalWorkflowId,
    temporalRunId: `mock-run:${organization.slug}:source:${source.id}`,
    trigger: "bootstrap" as const,
    status,
    currentStage: stage,
    factsCount,
    ...(status === "failed"
      ? { error: "Fixture provider returned a retryable error." }
      : {}),
    startedAt:
      status === "queued"
        ? undefined
        : new Date(now.getTime() - 10 * 60 * 1000),
    completedAt:
      status === "completed" || status === "failed"
        ? new Date(now.getTime() - 2 * 60 * 1000)
        : undefined,
    updatedAt: now,
  };
  if (existing)
    await tx
      .update(sourceIngestionRuns)
      .set(values)
      .where(eq(sourceIngestionRuns.id, existing.id));
  else await tx.insert(sourceIngestionRuns).values(values);
}

async function ensureWorkflowFixtures(
  tx: DatabaseTransaction,
  organization: FixtureOrganization,
  usersByKey: ReadonlyMap<string, FixtureUser>,
): Promise<void> {
  const now = new Date();
  const [definition] = await tx
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.organizationId, organization.id),
        eq(workflowDefinitions.key, "encois.dynamic.v1"),
        eq(workflowDefinitions.version, "v1"),
      ),
    )
    .limit(1);
  const definitionRow =
    definition ??
    (
      await tx
        .insert(workflowDefinitions)
        .values({
          organizationId: organization.id,
          key: "encois.dynamic.v1",
          version: "v1",
          status: "approved",
          inputSchemaRef: "contract://workflow-blueprint.v1",
          outputSchemaRef: "contract://workflow-result.v1",
        })
        .returning({ id: workflowDefinitions.id })
    )[0];
  if (!definitionRow)
    throw new Error("Local workflow definition was not created.");

  for (const fixture of workflowFixtures) {
    const unit = organization.units.get(fixture.scopeUnit);
    const actor = usersByKey.get(fixture.actorKey);
    if (!unit)
      throw new Error(
        `Workflow scope unit ${fixture.scopeUnit} is missing in ${organization.slug}.`,
      );
    if (!actor)
      throw new Error(
        `Workflow actor ${fixture.actorKey} is missing in ${organization.slug}.`,
      );
    const blueprint = demoBlueprint(fixture);
    const blueprintValues = {
      organizationId: organization.id,
      blueprintId: blueprint.blueprintId,
      version: blueprint.version,
      workflowType: blueprint.workflowType,
      name: blueprint.name,
      blueprint: blueprint as unknown as Record<string, unknown>,
      status: "approved" as const,
      isCurrent: true,
      approvedAt: now,
      updatedAt: now,
    } as const;
    const [existingBlueprint] = await tx
      .select({ id: workflowBlueprints.id })
      .from(workflowBlueprints)
      .where(
        and(
          eq(workflowBlueprints.organizationId, organization.id),
          eq(workflowBlueprints.blueprintId, blueprint.blueprintId),
          eq(workflowBlueprints.version, blueprint.version),
        ),
      )
      .limit(1);
    if (existingBlueprint)
      await tx
        .update(workflowBlueprints)
        .set(blueprintValues)
        .where(eq(workflowBlueprints.id, existingBlueprint.id));
    else await tx.insert(workflowBlueprints).values(blueprintValues);
  }
}

async function seedTemporalWorkflowFixtures(
  temporal: Client,
  organization: FixtureOrganization,
  usersByKey: ReadonlyMap<string, FixtureUser>,
): Promise<void> {
  const [definition] = await database.db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.organizationId, organization.id),
        eq(workflowDefinitions.key, "encois.dynamic.v1"),
        eq(workflowDefinitions.version, "v1"),
      ),
    )
    .limit(1);
  if (!definition)
    throw new Error("Local workflow definition was not created.");

  for (const fixture of workflowFixtures) {
    const unit = organization.units.get(fixture.scopeUnit);
    const actor = usersByKey.get(fixture.actorKey);
    if (!unit || !actor)
      throw new Error(`Workflow fixture ${fixture.key} is incomplete.`);
    const blueprint = demoBlueprint(fixture);
    const workflowId = `workflow:${organization.id}:encois.dynamic.v1:${fixture.key}`;
    const handle = temporal.workflow.getHandle(workflowId);
    try {
      await handle.describe();
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
      await temporal.workflow.start("encois.dynamic.v1", {
        args: [
          {
            contractVersion: ContractVersion.WorkflowBlueprint,
            actorId: actor.id,
            organizationId: organization.id,
            requestId: `seed-local:${fixture.key}`,
            traceId: `seed-local:${organization.id}:${fixture.key}`,
            workflowId,
            policyVersion: temporalPolicyVersion,
            scope: { ids: [unit.id] },
            capability: "local-seed-capability",
            blueprint,
            businessInput: {
              fixture: true,
              workspace: demoOrganizationSlug,
              activity: fixture.activityName,
            },
            idempotencyKey: `seed-local:${fixture.key}`,
          },
        ],
        taskQueue: temporalTaskQueue,
        workflowId,
        memo: {
          encoisRequestHash: `seed-local:${fixture.key}`,
          encoisWorkflowType: "encois.dynamic.v1",
          encoisBlueprintId: blueprint.blueprintId,
          encoisBlueprintVersion: blueprint.version,
          encoisTrigger: "local-demo-seed",
        },
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      });
    }

    const currentDescription = await handle.describe();
    const shouldPause =
      fixture.status === "paused" &&
      currentDescription.status.name === "RUNNING";
    if (shouldPause)
      await handle.signal("workflow-control", {
        signalId: `seed-local:pause:${fixture.key}`,
        action: "workflow-pause",
        reason: "Local demo workspace fixture.",
      });

    const description = shouldPause
      ? await handle.describe()
      : currentDescription;
    const now = new Date();
    const [existingRun] = await database.db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organizationId, organization.id),
          eq(workflowRuns.temporalWorkflowId, workflowId),
        ),
      )
      .limit(1);
    const runValues = {
      organizationId: organization.id,
      definitionId: definition.id,
      actorUserId: actor.id,
      temporalNamespace,
      temporalTaskQueue,
      temporalWorkflowId: workflowId,
      temporalRunId: description.runId,
      blueprintId: blueprint.blueprintId,
      blueprintVersion: blueprint.version,
      trigger: "local-demo-seed",
      status: "queued" as const,
      scope: { ids: [unit.id] },
      businessInput: {
        fixture: true,
        workspace: demoOrganizationSlug,
        activity: fixture.activityName,
      },
      inputRef: `artifact://local/${organization.id}/workflows/${fixture.key}/input.json`,
      resultRef: null,
      startedAt: description.startTime ?? now,
      completedAt: description.closeTime ?? null,
      retentionUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    } as const;
    await database.db.transaction(async (tx) => {
      const run = existingRun
        ? (
            await tx
              .update(workflowRuns)
              .set(runValues)
              .where(eq(workflowRuns.id, existingRun.id))
              .returning({ id: workflowRuns.id })
          )[0]
        : (
            await tx
              .insert(workflowRuns)
              .values(runValues)
              .returning({ id: workflowRuns.id })
          )[0];
      if (!run)
        throw new Error(`Local workflow run ${fixture.key} was not created.`);

      const eventValues = [
        {
          eventType: "workflow_started",
          status: "running",
          activityName: "workflow-start",
          evidenceRef: `artifact://local/${organization.id}/workflows/${fixture.key}/input.json`,
          metadata: {
            fixture: true,
            temporalNamespace,
            temporalRunId: description.runId,
          },
        },
        {
          eventType: "workflow_fixture_seeded",
          status: fixture.status,
          activityName: fixture.activityName,
          evidenceRef: `artifact://local/${organization.id}/workflows/${fixture.key}/evidence.json`,
          metadata: {
            fixture: true,
            temporalWorkflowId: workflowId,
            temporalRunId: description.runId,
          },
        },
      ] as const;
      for (const event of eventValues) {
        const [existingEvent] = await tx
          .select({ id: workflowEvents.id })
          .from(workflowEvents)
          .where(
            and(
              eq(workflowEvents.organizationId, organization.id),
              eq(workflowEvents.workflowRunId, run.id),
              eq(workflowEvents.eventType, event.eventType),
              eq(workflowEvents.activityName, event.activityName),
            ),
          )
          .limit(1);
        if (existingEvent)
          await tx
            .update(workflowEvents)
            .set({ ...event, occurredAt: now })
            .where(eq(workflowEvents.id, existingEvent.id));
        else
          await tx.insert(workflowEvents).values({
            organizationId: organization.id,
            workflowRunId: run.id,
            ...event,
          });
      }
    });
  }
}

async function seedTemporalCoordinator(
  temporal: Client,
  organization: FixtureOrganization,
  usersByKey: ReadonlyMap<string, FixtureUser>,
): Promise<void> {
  const actor = usersByKey.get("owner");
  if (!actor) throw new Error("Local Coordinator actor is missing.");
  const coordinatorId = `organization:${organization.id}`;
  const workflowId = buildCoordinatorWorkflowId(organization.id, coordinatorId);
  const handle = temporal.workflow.getHandle(workflowId);
  try {
    const existing = await handle.describe();
    if (existing.status.name === "RUNNING") return;
  } catch (error) {
    if (!(error instanceof WorkflowNotFoundError)) throw error;
  }
  await temporal.workflow.start(TemporalWorkflowType.Coordinator, {
    args: [
      {
        contractVersion: ContractVersion.Coordinator,
        coordinatorId,
        organizationId: organization.id,
        scopeType: "organization",
        scope: { ids: [...organization.units.values()].map((unit) => unit.id) },
        actorId: actor.id,
        policyVersion: temporalPolicyVersion,
        coordinationMode: "start-coordinator",
        selectedWorkflowRefs: [],
        state: {
          status: "READY",
          version: 1,
          onboardingComplete: true,
          reconciliationCount: 1,
        },
      },
    ],
    taskQueue: temporalTaskQueue,
    workflowId,
    memo: {
      encoisWorkflowType: TemporalWorkflowType.Coordinator,
      encoisTrigger: "local-demo-seed",
    },
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
  });
}

async function ensureWebhookFixture(
  tx: DatabaseTransaction,
  organization: FixtureOrganization,
  provider: string,
  endpointKey: string,
  integrationId?: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organization.id),
        eq(webhookEndpoints.endpointKey, endpointKey),
      ),
    )
    .limit(1);
  const endpoint = existing
    ? (
        await tx
          .update(webhookEndpoints)
          .set({
            provider,
            integrationId,
            secretRef: `local://mock/${endpointKey}`,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(webhookEndpoints.id, existing.id))
          .returning({ id: webhookEndpoints.id })
      )[0]
    : (
        await tx
          .insert(webhookEndpoints)
          .values({
            organizationId: organization.id,
            provider,
            endpointKey,
            integrationId,
            secretRef: `local://mock/${endpointKey}`,
            status: "active",
          })
          .returning({ id: webhookEndpoints.id })
      )[0];
  if (!endpoint)
    throw new Error(`Webhook endpoint ${endpointKey} was not created.`);
  const [delivery] = await tx
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.organizationId, organization.id),
        eq(webhookDeliveries.endpointId, endpoint.id),
        eq(webhookDeliveries.providerEventId, `${endpointKey}-event-1`),
      ),
    )
    .limit(1);
  if (!delivery)
    await tx.insert(webhookDeliveries).values({
      organizationId: organization.id,
      endpointId: endpoint.id,
      providerEventId: `${endpointKey}-event-1`,
      status: "processed",
      payloadRef: `artifact://local/${organization.id}/webhooks/${endpointKey}/event-1`,
      receivedAt: new Date(Date.now() - 15 * 60 * 1000),
      processedAt: new Date(Date.now() - 14 * 60 * 1000),
    });
}

async function seedFixtures(): Promise<unknown> {
  const identities = new Map<string, UserRecord>();
  if (identityMode === "emulator") {
    await waitForAuthEmulator();
    for (const spec of [...activeUsers, ...onboardingUsers])
      identities.set(
        spec.email,
        await ensureAuthUser(
          spec.uid,
          spec.email,
          spec.password,
          spec.displayName,
        ),
      );
  }

  const temporal = await connectTemporal();
  try {
    const seeded = await database.db.transaction(async (tx) => {
      await ensureIntegrationCatalog(tx);
      const organizationsBySlug = new Map<string, FixtureOrganization>();
      for (const fixture of organizationsFixture)
        organizationsBySlug.set(
          fixture.slug,
          await ensureOrganization(tx, fixture),
        );

      const usersByKey = new Map<string, FixtureUser>();
      if (identityMode === "emulator") {
        for (const spec of activeUsers) {
          const organization = organizationsBySlug.get(spec.organizationSlug);
          const identity = identities.get(spec.email);
          if (!organization || !identity)
            throw new Error(`Active fixture ${spec.key} is incomplete.`);
          usersByKey.set(
            spec.key,
            await ensureActiveFixtureUser(tx, organization, identity, spec),
          );
        }
        for (const spec of onboardingUsers) {
          const organization = organizationsBySlug.get(spec.organizationSlug);
          if (!organization)
            throw new Error(
              `Onboarding fixture ${spec.email} has no organization.`,
            );
          await ensurePendingInvite(tx, organization, spec);
        }
      } else {
        const serviceActor = {
          id: controlPlaneServiceUserId,
          email: "control-plane@system.invalid",
        };
        for (const spec of activeUsers) usersByKey.set(spec.key, serviceActor);
        const organization = organizationsBySlug.get(demoOrganizationSlug);
        if (!organization)
          throw new Error(
            `Demo organization ${demoOrganizationSlug} was not created.`,
          );
        if (managedOwnerEmail)
          await ensurePendingInvite(tx, organization, {
            email: managedOwnerEmail,
            unitSlug: "root",
            roleKey: "organization_admin",
          });
      }

      const outputOrganizations: unknown[] = [];
      for (const organizationSpec of organizationsFixture) {
        const organization = organizationsBySlug.get(organizationSpec.slug);
        if (!organization)
          throw new Error(
            `Organization fixture ${organizationSpec.slug} was not created.`,
          );
        const owner = usersByKey.get("owner");
        const engineeringUnit = organization.units.get("engineering");
        const customerSuccessUnit = organization.units.get("customer-success");
        if (!owner || !engineeringUnit || !customerSuccessUnit)
          throw new Error(
            `Organization fixture ${organizationSpec.slug} is incomplete.`,
          );
        const firstIntegration = await ensureIntegration(
          tx,
          organization,
          "GitHub",
          "github",
          owner.id,
        );
        const secondIntegration = await ensureIntegration(
          tx,
          organization,
          "Jira",
          "jira",
          owner.id,
        );
        const thirdIntegration = await ensureIntegration(
          tx,
          organization,
          "Slack",
          "slack",
          owner.id,
          "disabled",
        );
        const fourthIntegration = await ensureIntegration(
          tx,
          organization,
          "PagerDuty",
          "pagerduty",
          owner.id,
          "error",
        );
        const fifthIntegration = await ensureIntegration(
          tx,
          organization,
          "Google Drive",
          "google-drive",
          owner.id,
          "pending",
        );
        const sixthIntegration = await ensureIntegration(
          tx,
          organization,
          "Linear",
          "linear",
          owner.id,
          "disabled",
        );
        const sources = [
          await ensureKnowledgeSource(
            tx,
            organization,
            "github-engineering",
            "GitHub Engineering Source",
            "integration",
            engineeringUnit.slug,
            "active",
            "github",
            firstIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "jira-customer-success",
            "Jira Customer Success Source",
            "integration",
            customerSuccessUnit.slug,
            "active",
            "jira",
            secondIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "handbook",
            "Company handbook",
            "manual",
            "root",
            "active",
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "incident-log",
            "Incident log Source",
            "integration",
            customerSuccessUnit.slug,
            "failed",
            "slack",
            thirdIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "github-checkout",
            "GitHub Checkout Source",
            "integration",
            "checkout",
            "active",
            "github",
            firstIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "jira-engineering",
            "Jira Engineering Source",
            "integration",
            "engineering",
            "active",
            "jira",
            secondIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "jira-payments",
            "Jira Payments API Source",
            "integration",
            "payments-api",
            "active",
            "jira",
            secondIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "github-operations",
            "GitHub Operations Source",
            "integration",
            "operations",
            "degraded",
            "github",
            firstIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "jira-support-escalations",
            "Jira Support Escalations",
            "integration",
            "customer-success",
            "degraded",
            "jira",
            secondIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "architecture-decisions",
            "Architecture Decisions",
            "manual",
            "engineering",
            "active",
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "release-notes",
            "Release Notes",
            "manual",
            "development",
            "active",
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "security-advisories",
            "Security Advisories",
            "manual",
            "root",
            "active",
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "pagerduty-incidents",
            "PagerDuty Incidents",
            "integration",
            "operations",
            "failed",
            "pagerduty",
            fourthIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "drive-program-roadmap",
            "Google Drive Program Roadmap",
            "integration",
            "root",
            "ingesting",
            "google-drive",
            fifthIntegration.id,
          ),
          await ensureKnowledgeSource(
            tx,
            organization,
            "linear-legacy-projects",
            "Linear Legacy Projects",
            "integration",
            "development",
            "failed",
            "linear",
            sixthIntegration.id,
          ),
        ];
        if (sources.length !== 15)
          throw new Error(
            `Organization fixture ${organizationSpec.slug} has incomplete sources.`,
          );
        const ingestionStatuses = [
          ["completed", "memory_distilled", 48],
          ["completed", "memory_distilled", 17],
          ["completed", "graph_projected", 12],
          ["failed", "acquired", 0],
          ["completed", "memory_distilled", 31],
          ["completed", "memory_distilled", 24],
          ["completed", "memory_distilled", 19],
          ["failed", "acquired", 0],
          ["failed", "acquired", 0],
          ["completed", "graph_projected", 14],
          ["completed", "graph_projected", 9],
          ["completed", "graph_projected", 22],
          ["failed", "acquired", 0],
          ["running", "graph_projected", 7],
          ["failed", "acquired", 0],
        ] as const;
        for (const [index, source] of sources.entries()) {
          const ingestion = ingestionStatuses[index];
          if (!ingestion)
            throw new Error(`Ingestion fixture ${index} is missing.`);
          await ensureSourceIngestion(
            tx,
            organization,
            source,
            ingestion[0],
            ingestion[1],
            ingestion[2],
          );
        }
        await ensureWebhookFixture(
          tx,
          organization,
          "github",
          "github-events",
          firstIntegration.id,
        );
        await ensureWebhookFixture(
          tx,
          organization,
          "jira",
          "jira-events",
          secondIntegration.id,
        );
        await ensureWorkflowFixtures(tx, organization, usersByKey);
        outputOrganizations.push({
          id: organization.id,
          slug: organization.slug,
          name: organization.name,
          units: [...organization.units.values()],
          integrations: [
            firstIntegration,
            secondIntegration,
            thirdIntegration,
            fourthIntegration,
            fifthIntegration,
            sixthIntegration,
          ],
          sources: sources.map(({ id, name, revisionId }) => ({
            id,
            name,
            revisionId,
          })),
        });
      }
      return {
        organizations: outputOrganizations,
        activeUsers:
          identityMode === "emulator"
            ? activeUsers.map((user) => ({
                email: user.email,
                password: user.password,
                organization: user.organizationSlug,
                role: user.roleKey,
                scope: user.unitSlug,
              }))
            : [],
        onboardingUsers:
          identityMode === "emulator"
            ? onboardingUsers.map((user) => ({
                email: user.email,
                password: user.password,
                organization: user.organizationSlug,
                scope: user.unitSlug,
              }))
            : [],
        seedOrganization: organizationsBySlug.get(demoOrganizationSlug),
        seedUsersByKey: usersByKey,
      };
    });
    if (!seeded.seedOrganization)
      throw new Error("Demo organization fixture was not created.");
    await seedTemporalCoordinator(
      temporal.client,
      seeded.seedOrganization,
      seeded.seedUsersByKey,
    );
    await seedTemporalWorkflowFixtures(
      temporal.client,
      seeded.seedOrganization,
      seeded.seedUsersByKey,
    );
    return {
      organizations: seeded.organizations,
      identityMode,
      ownerInviteEmail: managedOwnerEmail,
      activeUsers: seeded.activeUsers,
      onboardingUsers: seeded.onboardingUsers,
      workflowMode: `temporal (1 Coordinator + ${workflowFixtures.length} real demo executions)`,
      memoryMode:
        "not seeded (run the separate manual AI demo seed for Spanner and Memory Bank)",
    };
  } finally {
    await temporal.connection.close();
  }
}

try {
  console.log(JSON.stringify(await seedFixtures(), null, 2));
} finally {
  await database.client.end({ timeout: 5 });
}

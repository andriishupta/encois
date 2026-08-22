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
  organizationUnits,
  organizations,
  roles,
  users,
  type PersistenceTransaction,
} from "@encois/persistence";

const projectId = process.env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || "demo-encois";
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const ownerEmail = process.env.LOCAL_AUTH_EMAIL?.trim().toLowerCase() || "dev@local.test";
const ownerPassword = process.env.LOCAL_AUTH_PASSWORD?.trim() || "local-password-1234";
const ownerUid = process.env.LOCAL_AUTH_UID?.trim() || "local-owner";
const organizationName = process.env.LOCAL_AUTH_ORGANIZATION?.trim() || "Encois Local Demo";
const organizationSlug = process.env.LOCAL_AUTH_ORGANIZATION_SLUG?.trim() || "encois-local";
const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim();

if (!emulatorHost) throw new Error("FIREBASE_AUTH_EMULATOR_HOST is required for the local auth seed.");
if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL is required for the local auth seed.");
if (ownerPassword.length < 6) throw new Error("LOCAL_AUTH_PASSWORD must contain at least six characters.");

const fixtureUsers = [
  { uid: "local-manager", email: "manager@local.test", password: "local-manager-1234", displayName: "Jamie Manager", roleKey: "manager", unitSlug: "engineering", access: "manager" as const },
  { uid: "local-member", email: "member@local.test", password: "local-member-1234", displayName: "Priya Member", roleKey: "member", unitSlug: "checkout", access: "contributor" as const },
  { uid: "local-viewer", email: "dev@localtest", password: "local-viewer-1234", displayName: "Morgan Viewer", roleKey: "viewer", unitSlug: "customer-success", access: "viewer" as const },
] as const;

const firebaseApp = initializeApp({ projectId }, `local-auth-seed-${projectId}`);
const auth = getAuth(firebaseApp);
const database = createDatabase({ url: databaseUrl });

type FixtureUnit = { id: string; slug: string };
type FixtureIntegration = { id: string; displayName: string };

async function waitForAuthEmulator(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await auth.getUserByEmail(ownerEmail);
      return;
    } catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found") return;
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

async function ensureOrganization(tx: PersistenceTransaction): Promise<{ id: string; root: FixtureUnit }> {
  const [existing] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, organizationSlug)).limit(1);
  const organization = existing ?? (
    await tx.insert(organizations).values({ name: organizationName, slug: organizationSlug }).returning({ id: organizations.id })
  )[0];
  if (!organization) throw new Error("Local organization was not created.");

  const [existingRoot] = await tx
    .select({ id: organizationUnits.id })
    .from(organizationUnits)
    .where(and(eq(organizationUnits.organizationId, organization.id), eq(organizationUnits.slug, "root"), eq(organizationUnits.type, "organization")))
    .limit(1);
  const root = existingRoot ?? (
    await tx.insert(organizationUnits).values({ organizationId: organization.id, type: "organization", slug: "root", name: organizationName }).returning({ id: organizationUnits.id })
  )[0];
  if (!root) throw new Error("Local organization root was not created.");

  return { id: organization.id, root: { id: root.id, slug: "root" } };
}

async function ensureUnit(
  tx: PersistenceTransaction,
  organizationId: string,
  parentId: string | null,
  type: "department" | "project",
  slug: string,
  name: string,
): Promise<FixtureUnit> {
  const [existing] = await tx
    .select({ id: organizationUnits.id })
    .from(organizationUnits)
    .where(
      and(
        eq(organizationUnits.organizationId, organizationId),
        parentId ? eq(organizationUnits.parentId, parentId) : isNull(organizationUnits.parentId),
        eq(organizationUnits.type, type),
        eq(organizationUnits.slug, slug),
      ),
    )
    .limit(1);
  const unit = existing ?? (
    await tx.insert(organizationUnits).values({ organizationId, parentId, type, slug, name }).returning({ id: organizationUnits.id })
  )[0];
  if (!unit) throw new Error(`Local organization unit ${slug} was not created.`);
  return { id: unit.id, slug };
}

async function systemRole(tx: PersistenceTransaction, key: string): Promise<{ id: string; key: string }> {
  const [role] = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.key, key), isNull(roles.organizationId)))
    .limit(1);
  if (!role) throw new Error(`System ${key} role is missing. Run database migrations first.`);
  return role;
}

async function resolvePersistentUser(tx: PersistenceTransaction, identity: UserRecord): Promise<{ id: string } | undefined> {
  const email = identity.email?.trim().toLowerCase();
  const [bySubject] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.identityProvider, "identity-platform"), eq(users.identitySubject, identity.uid)))
    .limit(1);
  const [existingUser] = bySubject
    ? [bySubject]
    : email
      ? await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.identityProvider, "identity-platform"), eq(users.email, email)))
          .orderBy(desc(users.updatedAt), desc(users.createdAt))
          .limit(1)
      : [];

  if (!existingUser) return undefined;
  await tx
    .update(users)
    .set({ email, identitySubject: identity.uid, displayName: identity.displayName, updatedAt: new Date() })
    .where(eq(users.id, existingUser.id));
  return existingUser;
}

async function ensurePendingOwnerInvite(tx: PersistenceTransaction, organizationId: string, rootId: string, owner: UserRecord): Promise<"pending" | "already-active"> {
  const existingUser = await resolvePersistentUser(tx, owner);
  if (existingUser) {
    const [activeMembership] = await tx
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, existingUser.id), eq(organizationMemberships.status, "active")))
      .limit(1);
    if (activeMembership) return "already-active";
  }

  const role = await systemRole(tx, "organization_admin");
  const [pendingInvite] = await tx
    .select({ id: organizationInvites.id })
    .from(organizationInvites)
    .where(and(eq(organizationInvites.organizationId, organizationId), eq(organizationInvites.emailNormalized, ownerEmail), eq(organizationInvites.status, "pending")))
    .orderBy(desc(organizationInvites.updatedAt))
    .limit(1);
  if (!pendingInvite) {
    await tx.insert(organizationInvites).values({ emailNormalized: ownerEmail, organizationId, organizationUnitId: rootId, roleId: role.id });
  }
  return "pending";
}

async function ensureActiveFixtureUser(
  tx: PersistenceTransaction,
  organizationId: string,
  identity: UserRecord,
  roleKey: string,
  unit: FixtureUnit,
  access: "manager" | "contributor" | "viewer",
): Promise<void> {
  const user = await resolvePersistentUser(tx, identity) ?? (
    await tx
      .insert(users)
      .values({ identityProvider: "identity-platform", identitySubject: identity.uid, email: identity.email, displayName: identity.displayName })
      .returning({ id: users.id })
  )[0];
  if (!user) throw new Error(`Local user ${identity.email} was not persisted.`);

  const role = await systemRole(tx, roleKey);
  const [membership] = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, user.id)))
    .limit(1);
  const membershipId = membership?.id ?? (
    await tx.insert(organizationMemberships).values({ organizationId, userId: user.id, roleId: role.id, status: "active" }).returning({ id: organizationMemberships.id })
  )[0]?.id;
  if (!membershipId) throw new Error(`Local membership for ${identity.email} was not persisted.`);
  await tx.update(organizationMemberships).set({ roleId: role.id, status: "active", updatedAt: new Date() }).where(eq(organizationMemberships.id, membershipId));

  await tx
    .insert(membershipScopes)
    .values({ organizationId, membershipId, organizationUnitId: unit.id, access })
    .onConflictDoUpdate({ target: [membershipScopes.membershipId, membershipScopes.organizationUnitId], set: { access } });

  const [acceptedInvite] = await tx
    .select({ id: organizationInvites.id })
    .from(organizationInvites)
    .where(and(eq(organizationInvites.organizationId, organizationId), eq(organizationInvites.emailNormalized, identity.email!.toLowerCase())))
    .orderBy(desc(organizationInvites.updatedAt))
    .limit(1);
  if (acceptedInvite) {
    await tx.update(organizationInvites).set({ status: "accepted", acceptedUserId: user.id, acceptedAt: new Date(), updatedAt: new Date() }).where(eq(organizationInvites.id, acceptedInvite.id));
  } else {
    await tx.insert(organizationInvites).values({ emailNormalized: identity.email!, organizationId, organizationUnitId: unit.id, roleId: role.id, status: "accepted", acceptedUserId: user.id, acceptedAt: new Date() });
  }
}

async function ensureIntegration(
  tx: PersistenceTransaction,
  organizationId: string,
  displayName: string,
  provider: string,
  unit: FixtureUnit,
): Promise<FixtureIntegration> {
  const [existing] = await tx
    .select({ id: integrations.id, displayName: integrations.displayName })
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.displayName, displayName)))
    .limit(1);
  const integration = existing ?? (
    await tx.insert(integrations).values({ organizationId, provider, displayName, status: "active" }).returning({ id: integrations.id, displayName: integrations.displayName })
  )[0];
  if (!integration) throw new Error(`Local integration ${displayName} was not created.`);
  await tx
    .insert(integrationBindings)
    .values({ organizationId, integrationId: integration.id, organizationUnitId: unit.id, status: "active", grantedScopes: ["read"] })
    .onConflictDoUpdate({ target: [integrationBindings.integrationId, integrationBindings.organizationUnitId], set: { status: "active", grantedScopes: ["read"] } });
  return integration;
}

async function ensureKnowledgeSource(
  tx: PersistenceTransaction,
  organizationId: string,
  name: string,
  unit: FixtureUnit,
  kind: "integration" | "manual",
  integrationId?: string,
): Promise<void> {
  const [existing] = await tx.select({ id: knowledgeSources.id }).from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, organizationId), eq(knowledgeSources.name, name))).limit(1);
  const values = {
    organizationId,
    name,
    kind,
    ...(integrationId ? { integrationId } : {}),
    ...(kind === "integration" ? { provider: "fixture" } : {}),
    status: "active" as const,
    readScope: { ids: [unit.id] },
    visibilityScope: { ids: [unit.id] },
    configuration: { fixture: true },
  };
  if (existing) {
    await tx.update(knowledgeSources).set(values).where(eq(knowledgeSources.id, existing.id));
  } else {
    await tx.insert(knowledgeSources).values(values);
  }
}

try {
  await waitForAuthEmulator();
  const owner = await ensureAuthUser(ownerUid, ownerEmail, ownerPassword, "Dev Owner");
  const seeded = await Promise.all(fixtureUsers.map((user) => ensureAuthUser(user.uid, user.email, user.password, user.displayName)));

  const result = await database.db.transaction(async (tx) => {
    const organization = await ensureOrganization(tx);
    const engineering = await ensureUnit(tx, organization.id, organization.root.id, "department", "engineering", "Engineering");
    const operations = await ensureUnit(tx, organization.id, organization.root.id, "department", "operations", "Operations");
    const payments = await ensureUnit(tx, organization.id, engineering.id, "project", "payments-api", "Payments API");
    const checkout = await ensureUnit(tx, organization.id, engineering.id, "project", "checkout", "Checkout");
    const customerSuccess = await ensureUnit(tx, organization.id, operations.id, "project", "customer-success", "Customer Success");

    const ownerInvite = await ensurePendingOwnerInvite(tx, organization.id, organization.root.id, owner);
    const unitBySlug = new Map([
      [engineering.slug, engineering],
      [operations.slug, operations],
      [payments.slug, payments],
      [checkout.slug, checkout],
      [customerSuccess.slug, customerSuccess],
    ]);
    for (let index = 0; index < fixtureUsers.length; index += 1) {
      const spec = fixtureUsers[index]!;
      const identity = seeded[index]!;
      const unit = unitBySlug.get(spec.unitSlug);
      if (!unit) throw new Error(`Fixture unit ${spec.unitSlug} is missing.`);
      await ensureActiveFixtureUser(tx, organization.id, identity, spec.roleKey, unit, spec.access);
    }

    const github = await ensureIntegration(tx, organization.id, "GitHub Engineering", "github", engineering);
    const jira = await ensureIntegration(tx, organization.id, "Jira Operations", "jira", operations);
    await ensureKnowledgeSource(tx, organization.id, "GitHub Engineering context", engineering, "integration", github.id);
    await ensureKnowledgeSource(tx, organization.id, "Jira Operations context", operations, "integration", jira.id);
    await ensureKnowledgeSource(tx, organization.id, "Customer Success playbook", customerSuccess, "manual");

    return {
      organizationId: organization.id,
      organizationSlug,
      organizationName,
      owner: { email: ownerEmail, password: ownerPassword, onboarding: ownerInvite },
      users: fixtureUsers.map((user) => ({ email: user.email, password: user.password, role: user.roleKey, scope: user.unitSlug })),
      units: [organization.root, engineering, operations, payments, checkout, customerSuccess],
      integrations: [github, jira],
      knowledgeSources: ["GitHub Engineering context", "Jira Operations context", "Customer Success playbook"],
    };
  });

  console.log(JSON.stringify(result, null, 2));
} finally {
  await database.client.end({ timeout: 5 });
}

import {
  createDatabase,
  organizationInvites,
  organizationOnboarding,
  organizations,
  organizationUnits,
  roles,
} from "@encois/database";
import { and, eq, isNull } from "drizzle-orm";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { normalizeEmail } from "../src/auth/identity-platform.js";
import { databaseUrl, parseOptions, required, slugify } from "./cli.js";
import { ensureLocalControlPlaneMembership } from "./local-control-plane.js";

const options = parseOptions(process.argv.slice(2));
const email = normalizeEmail(required(options, "email"));
const password = required(options, "password");
const organizationName =
  options.organization?.trim() || `Onboarding ${email.split("@")[0]}`;
const organizationSlug =
  options.slug?.trim() || slugify(`${organizationName}-${email.split("@")[0]}`);
const projectId =
  process.env.IDENTITY_PLATFORM_PROJECT_ID?.trim() || "demo-encois";
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const migrationUrl = databaseUrl();

if (process.env.NODE_ENV === "production")
  throw new Error("The onboarding command cannot run in production.");
if (!emulatorHost)
  throw new Error(
    "FIREBASE_AUTH_EMULATOR_HOST is required; this command only supports the Firebase Auth Emulator.",
  );
if (password.length < 6)
  throw new Error(
    "The onboarding password must contain at least six characters.",
  );

const firebaseApp = initializeApp(
  { projectId },
  `local-onboarding-${projectId}`,
);
const auth = getAuth(firebaseApp);
const database = createDatabase({ url: migrationUrl });

async function waitForAuthEmulator(): Promise<void> {
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

try {
  await waitForAuthEmulator();

  const result = await database.db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(organizations)
      .values({ slug: organizationSlug, name: organizationName })
      .returning({ id: organizations.id, slug: organizations.slug });
    if (!organization) throw new Error("Organization was not created.");

    const [rootUnit] = await tx
      .insert(organizationUnits)
      .values({
        organizationId: organization.id,
        type: "organization",
        slug: "root",
        name: organizationName,
      })
      .returning({ id: organizationUnits.id });
    if (!rootUnit) throw new Error("Organization root unit was not created.");

    await ensureLocalControlPlaneMembership(tx, organization.id, rootUnit.id);

    await tx.insert(organizationOnboarding).values({
      organizationId: organization.id,
      coordinatorId: `organization:${organization.id}`,
    });

    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(eq(roles.key, "organization_admin"), isNull(roles.organizationId)),
      )
      .limit(1);
    if (!role)
      throw new Error(
        "System organization_admin role is missing. Run database migrations first.",
      );

    const [invite] = await tx
      .insert(organizationInvites)
      .values({
        emailNormalized: email,
        organizationId: organization.id,
        organizationUnitId: rootUnit.id,
        roleId: role.id,
      })
      .returning({ id: organizationInvites.id });
    if (!invite) throw new Error("Organization invite was not created.");

    return {
      inviteId: invite.id,
      organizationId: organization.id,
      organizationSlug: organization.slug,
    };
  });

  try {
    const user = await auth.createUser({
      email,
      emailVerified: true,
      password,
    });

    console.log(
      JSON.stringify(
        {
          ...result,
          email,
          firebaseUid: user.uid,
          next: "Sign in locally with this email and password, then complete onboarding.",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, result.organizationId));
    } catch (cleanupError) {
      throw new Error(
        `Firebase user creation failed and database cleanup also failed: ${String(cleanupError)}`,
        { cause: error },
      );
    }
    throw error;
  }
} finally {
  await database.client.end({ timeout: 5 });
}

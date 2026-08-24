import {
  createDatabase,
  organizationInvites,
  organizationOnboarding,
  organizations,
  organizationUnits,
  roles,
} from "@encois/persistence";
import { and, eq, isNull } from "drizzle-orm";
import { normalizeEmail } from "../src/auth/identity-platform.js";
import { databaseUrl, parseOptions, required, slugify } from "./cli.js";

const options = parseOptions(process.argv.slice(2));
const email = normalizeEmail(required(options, "email"));
const organizationName = required(options, "organization");
const organizationSlug = options.slug?.trim() || slugify(organizationName);
const database = createDatabase({ url: databaseUrl() });

try {
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

  console.log(
    JSON.stringify(
      {
        ...result,
        email,
        next: "User completes Google login to accept the invite.",
      },
      null,
      2,
    ),
  );
} finally {
  await database.client.end({ timeout: 5 });
}

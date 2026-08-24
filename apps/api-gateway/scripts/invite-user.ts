import {
  createDatabase,
  organizationInvites,
  organizationUnits,
  roles,
} from "@encois/persistence";
import { and, eq, isNull } from "drizzle-orm";
import { normalizeEmail } from "../src/auth/identity-platform.js";
import { databaseUrl, parseOptions, required } from "./cli.js";

const options = parseOptions(process.argv.slice(2));
const email = normalizeEmail(required(options, "email"));
const organizationId = required(options, "organization-id");
const roleKey = options.role?.trim() || "member";
const database = createDatabase({ url: databaseUrl() });

try {
  const result = await database.db.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(eq(roles.key, roleKey), eq(roles.organizationId, organizationId)),
      )
      .limit(1);
    const [systemRole] = role
      ? [role]
      : await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.key, roleKey), isNull(roles.organizationId)))
          .limit(1);
    if (!systemRole) throw new Error(`Role ${roleKey} is missing.`);

    const unitId =
      options["unit-id"]?.trim() ||
      (
        await tx
          .select({ id: organizationUnits.id })
          .from(organizationUnits)
          .where(
            and(
              eq(organizationUnits.organizationId, organizationId),
              eq(organizationUnits.type, "organization"),
            ),
          )
          .limit(1)
      )[0]?.id;
    if (!unitId)
      throw new Error(
        "Organization root unit is missing; pass --unit-id explicitly.",
      );

    const [invite] = await tx
      .insert(organizationInvites)
      .values({
        emailNormalized: email,
        organizationId,
        organizationUnitId: unitId,
        roleId: systemRole.id,
      })
      .returning({ id: organizationInvites.id });
    if (!invite) throw new Error("Invite was not created.");
    return { inviteId: invite.id, organizationId, email, role: roleKey };
  });

  console.log(
    JSON.stringify(
      { ...result, next: "User completes Google login to accept the invite." },
      null,
      2,
    ),
  );
} finally {
  await database.client.end({ timeout: 5 });
}

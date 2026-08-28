import { createDatabase, organizationInvites } from "@encois/database";
import { and, eq } from "drizzle-orm";
import { databaseUrl, parseOptions, required } from "./cli.js";

const options = parseOptions(process.argv.slice(2));
const inviteId = required(options, "invite-id");
const database = createDatabase({ url: databaseUrl() });
try {
  const [invite] = await database.db
    .update(organizationInvites)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(organizationInvites.id, inviteId),
        eq(organizationInvites.status, "pending"),
      ),
    )
    .returning({
      id: organizationInvites.id,
      status: organizationInvites.status,
    });
  if (!invite) throw new Error("Pending invite was not found.");
  console.log(JSON.stringify(invite, null, 2));
} finally {
  await database.client.end({ timeout: 5 });
}

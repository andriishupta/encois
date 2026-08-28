import { createDatabase, waitlistRequests } from "@encois/database";
import { desc } from "drizzle-orm";
import { databaseUrl } from "./cli.js";

const database = createDatabase({ url: databaseUrl() });
try {
  const rows = await database.db
    .select()
    .from(waitlistRequests)
    .orderBy(desc(waitlistRequests.createdAt));
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await database.client.end({ timeout: 5 });
}

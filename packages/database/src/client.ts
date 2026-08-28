import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = PostgresJsDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type DatabaseClientOptions = {
  maxConnections?: number;
  url?: string;
};

export function createDatabase(options: DatabaseClientOptions = {}): {
  client: postgres.Sql;
  db: Database;
} {
  const url =
    options.url ?? process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "DATABASE_RUNTIME_URL is required to create the runtime database client.",
    );
  }

  const client = postgres(url, {
    max: options.maxConnections ?? 5,
    prepare: false,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export async function withOrganizationContext<T>(
  db: Database,
  organizationId: string,
  callback: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${organizationId}, true)`,
    );
    return callback(transaction);
  });
}

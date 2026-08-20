import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema/index.js";

export type PersistenceDatabase = PostgresJsDatabase<typeof schema>;
export type PersistenceTransaction = Parameters<Parameters<PersistenceDatabase["transaction"]>[0]>[0];

export type DatabaseClientOptions = {
  maxConnections?: number;
  url?: string;
};

export function createDatabase(options: DatabaseClientOptions = {}): {
  client: postgres.Sql;
  db: PersistenceDatabase;
} {
  const url = options.url ?? process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_RUNTIME_URL is required to create the runtime database client.");
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
  db: PersistenceDatabase,
  organizationId: string,
  callback: (transaction: PersistenceTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.organization_id', ${organizationId}, true)`);
    return callback(transaction);
  });
}

import { createDatabase } from "@encois/database";

const runtimeUrl = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL;
const runtime = runtimeUrl ? createDatabase({ url: runtimeUrl }) : undefined;

/** Shared runtime database handle. Migrations use a separate connection. */
export const database = runtime?.db;
export const databaseClient = runtime?.client;

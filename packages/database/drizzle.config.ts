import { defineConfig } from "drizzle-kit";

const migrationUrl =
  process.env.DATABASE_MIGRATION_URL ?? "postgresql://localhost/encois";
const migrationSocketPath = process.env.DATABASE_MIGRATION_SOCKET_PATH?.trim();
const parsedMigrationUrl = new URL(migrationUrl);

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: migrationSocketPath
    ? {
        host: migrationSocketPath,
        user: decodeURIComponent(parsedMigrationUrl.username),
        password: decodeURIComponent(parsedMigrationUrl.password),
        database: decodeURIComponent(parsedMigrationUrl.pathname.slice(1)),
        ssl: false,
      }
    : { url: migrationUrl },
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
  out: "./drizzle",
  schema: "./src/schema/index.ts",
});

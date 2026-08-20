import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? "postgresql://localhost/encois",
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
  out: "./drizzle",
  schema: "./src/schema/index.ts",
});

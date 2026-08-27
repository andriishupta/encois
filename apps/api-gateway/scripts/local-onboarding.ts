const args = process.argv.slice(2).filter((argument) => argument !== "--");
const email = args[0]?.trim();

if (!email || args.length !== 1 || email.startsWith("--"))
  throw new Error("Usage: pnpm run local:onboarding -- user@local.test");

const defaultPassword = "local-onboarding-1";

process.env.DATABASE_MIGRATION_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/encois";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.argv = [
  process.argv[0] ?? "node",
  process.argv[1] ?? "local-onboarding.ts",
  "--email",
  email,
  "--password",
  defaultPassword,
];

await import("./onboarding.js");

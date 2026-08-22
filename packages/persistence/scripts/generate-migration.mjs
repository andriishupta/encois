import { spawnSync } from "node:child_process";

const [name, ...unexpectedArguments] = process.argv.slice(2);
const logicalNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

if (!name || unexpectedArguments.length > 0 || !logicalNamePattern.test(name)) {
  console.error("Usage: pnpm db:generate -- <logical-kebab-case-name>");
  process.exit(1);
}

const result = spawnSync(
  "drizzle-kit",
  ["generate", "--config", "drizzle.config.ts", "--name", name, "--prefix", "index"],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

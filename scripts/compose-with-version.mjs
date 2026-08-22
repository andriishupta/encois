import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const [, , composeFile, ...composeArguments] = process.argv;

if (!composeFile || composeArguments.length === 0) {
  throw new Error("Usage: node scripts/compose-with-version.mjs <compose-file> <compose-arguments...>");
}

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const version = process.env.ENCOIS_VERSION ?? packageJson.version;

if (typeof version !== "string" || version.length === 0) {
  throw new Error("Root package.json must define a non-empty version.");
}

const child = spawn("docker", ["compose", "-f", composeFile, ...composeArguments], {
  env: { ...process.env, ENCOIS_VERSION: version },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

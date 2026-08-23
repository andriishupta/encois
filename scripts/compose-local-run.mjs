import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const composeFile = "compose.local.yaml";
const args = process.argv.slice(2);
const composeArgs = [];
const runEnvironmentArguments = [];

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--env") {
    const value = args[index + 1];
    if (!value) throw new Error("--env requires KEY=VALUE");
    runEnvironmentArguments.push(value);
    index += 1;
    continue;
  }
  if (argument.startsWith("--env=")) {
    runEnvironmentArguments.push(argument.slice("--env=".length));
    continue;
  }
  composeArgs.push(argument);
}

if (!composeArgs[0]) {
  throw new Error("Usage: node scripts/compose-local-run.mjs [--env KEY=VALUE] SERVICE [COMMAND ...]");
}

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const version = process.env.ENCOIS_VERSION ?? packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  throw new Error("Root package.json must define a non-empty version.");
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      env: { ...process.env, ENCOIS_VERSION: version },
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : options.quiet ? "ignore" : "inherit",
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else resolve({ code: code ?? 1, stdout });
    });
  });
}

function validateEnvArguments(values) {
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid --env value: ${value}`);
  }
}

validateEnvArguments(runEnvironmentArguments);

const migrationContainers = await run("docker", ["compose", "-f", composeFile, "ps", "-a", "-q", "migrations"], { capture: true });
if (migrationContainers.code !== 0) process.exit(migrationContainers.code);

for (const containerId of migrationContainers.stdout.split(/\s+/u).filter(Boolean)) {
  const state = await run("docker", ["inspect", "--format", "{{.State.Status}} {{.State.ExitCode}}", containerId], { capture: true });
  if (state.code !== 0) process.exit(state.code);
  const [status, exitCode] = state.stdout.trim().split(/\s+/u);
  if (status === "created" || (status === "exited" && exitCode !== "0")) {
    const removed = await run("docker", ["rm", "-f", containerId], { quiet: true });
    if (removed.code !== 0) process.exit(removed.code);
  }
}

const result = await run("docker", [
  "compose",
  "-f",
  composeFile,
  "run",
  "--rm",
  ...runEnvironmentArguments.flatMap((value) => ["-e", value]),
  ...composeArgs,
]);
process.exit(result.code);

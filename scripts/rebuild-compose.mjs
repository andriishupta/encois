import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const [, , composeFile, envFile] = process.argv;

if (!composeFile || !envFile) {
  throw new Error(
    "Usage: node scripts/rebuild-compose.mjs <compose-file> <env-file>",
  );
}

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const version = process.env.ENCOIS_VERSION ?? packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  throw new Error("Root package.json must define a non-empty version.");
}

const environment = { ...process.env, ENCOIS_VERSION: version };
const compose = ["compose", "-f", composeFile, "--env-file", envFile];

function runDocker(argumentsList) {
  return new Promise((resolve) => {
    const child = spawn("docker", argumentsList, {
      env: environment,
      stdio: "inherit",
    });
    child.on("error", () => resolve({ code: 1, signal: null }));
    child.on("exit", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

function captureDocker(argumentsList) {
  return new Promise((resolve) => {
    const child = spawn("docker", argumentsList, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseComposeStatus(output) {
  const value = output.trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return value.split("\n").flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
}

async function verifyStartup() {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const status = await captureDocker([
    ...compose,
    "ps",
    "-a",
    "--format",
    "json",
  ]);
  const failed = parseComposeStatus(status.stdout).filter((service) => {
    const state = String(service.State ?? service.state ?? "").toLowerCase();
    const health = String(service.Health ?? service.health ?? "").toLowerCase();
    const exitCode = Number(service.ExitCode ?? service.exitCode ?? 0);
    return (
      health === "unhealthy" ||
      state === "dead" ||
      state === "restarting" ||
      (state === "exited" && exitCode !== 0)
    );
  });
  if (failed.length === 0) return;

  console.error(
    "\n[compose rebuild] ABORTED: one or more services failed after startup.",
  );
  await runDocker([...compose, "ps", "-a"]);
  await runDocker([...compose, "logs", "--tail", "100"]);
  process.exit(1);
}

async function runStep(label, argumentsList) {
  console.info(`\n[compose rebuild] ${label}`);
  const result = await runDocker(argumentsList);
  if (result.signal) process.kill(process.pid, result.signal);
  if (result.code !== 0) {
    console.error(
      `\n[compose rebuild] ABORTED during ${label}. The new stack was not started.`,
    );
    process.exit(result.code);
  }
}

await runStep("remove old containers and volumes", [
  ...compose,
  "down",
  "--volumes",
  "--remove-orphans",
]);

await runStep("build all images without cache", [
  ...compose,
  "build",
  "--no-cache",
]);

await runStep("start the freshly built stack", [
  ...compose,
  "up",
  "-d",
  "--force-recreate",
  "--remove-orphans",
]);

await verifyStartup();

console.info(
  "\n[compose rebuild] COMPLETE: the new containers were created after a successful build.",
);

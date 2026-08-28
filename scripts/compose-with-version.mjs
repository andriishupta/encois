import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const [, , composeFile, ...composeArguments] = process.argv;

if (!composeFile || composeArguments.length === 0) {
  throw new Error(
    "Usage: node scripts/compose-with-version.mjs <compose-file> <compose-arguments...>",
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
const upIndex = composeArguments.indexOf("up");
const isDetachedUp =
  upIndex >= 0 &&
  (composeArguments.slice(upIndex + 1).includes("-d") ||
    composeArguments.slice(upIndex + 1).includes("--detach"));
const composeOptions = upIndex >= 0 ? composeArguments.slice(0, upIndex) : [];

function runDocker(argumentsList, stdio = "inherit") {
  return new Promise((resolve) => {
    const child = spawn("docker", argumentsList, {
      env: environment,
      stdio,
    });
    child.on("error", () => resolve({ code: 1, signal: null }));
    child.on("exit", (code, signal) => resolve({ code, signal }));
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

async function reportStartupFailure(composeExitCode) {
  const statusArguments = [
    "compose",
    "-f",
    composeFile,
    ...composeOptions,
    "ps",
    "-a",
    "--format",
    "json",
  ];
  const status = await captureDocker(statusArguments);
  const services = parseComposeStatus(status.stdout);
  const failed = services.filter((service) => {
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
  if (composeExitCode === 0 && failed.length === 0) return false;

  console.error("Compose build or startup failed. Service status:");
  await runDocker([
    "compose",
    "-f",
    composeFile,
    ...composeOptions,
    "ps",
    "-a",
  ]);
  console.error("Recent service logs:");
  await runDocker([
    "compose",
    "-f",
    composeFile,
    ...composeOptions,
    "logs",
    "--tail",
    "100",
  ]);
  return true;
}

const result = await runDocker([
  "compose",
  "-f",
  composeFile,
  ...composeArguments,
]);
if (isDetachedUp) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await reportStartupFailure(result.code ?? 1);
}
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.code ?? 1);

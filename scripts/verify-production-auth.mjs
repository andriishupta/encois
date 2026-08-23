import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const dashboardDist = join(rootDirectory, "apps/dashboard/dist");
const apiDist = join(rootDirectory, "apps/api-gateway/dist");
const checkArtifacts = process.argv.includes("--artifacts");

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await textFiles(path)));
    else if (entry.isFile() && /\.(?:css|html|js|json|map|mjs)$/u.test(entry.name)) files.push(path);
  }

  return files;
}

async function readRequired(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing: ${path}`);
    throw error;
  }
}

async function directoryExists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function findForbiddenContent(files, markers) {
  const matches = [];
  for (const path of files) {
    const content = await readFile(path, "utf8");
    for (const marker of markers) {
      if (content.includes(marker)) matches.push(`${relative(rootDirectory, path)} contains ${marker}`);
    }
  }
  return matches;
}

const dashboardAuth = await readRequired(
  join(rootDirectory, "apps/dashboard/src/lib/auth.ts"),
  "Dashboard shared auth module",
);
const loginRoute = await readRequired(
  join(rootDirectory, "apps/dashboard/src/routes/login.tsx"),
  "Dashboard login route",
);
const localAuthPanel = await readRequired(
  join(rootDirectory, "apps/dashboard/src/components/local-auth-panel.tsx"),
  "Dashboard local auth panel",
);
const localAuthModule = await readRequired(
  join(rootDirectory, "apps/dashboard/src/lib/local-auth.ts"),
  "Dashboard local auth module",
);
const apiDockerfile = await readRequired(
  join(rootDirectory, "apps/api-gateway/Dockerfile"),
  "API Gateway Dockerfile",
);

const sourceMatches = [];
for (const marker of ["signInWithEmailAndPassword", "signInWithEmail", "local-password-1234", "local-dev-1234"]) {
  if (dashboardAuth.includes(marker)) sourceMatches.push(`apps/dashboard/src/lib/auth.ts contains ${marker}`);
  if (loginRoute.includes(marker)) sourceMatches.push(`apps/dashboard/src/routes/login.tsx contains ${marker}`);
}
if (!loginRoute.includes("import.meta.env.DEV ? lazy(() => import('@/components/local-auth-panel'))")) {
  sourceMatches.push("login route is not guarded by a compile-time DEV-only lazy import");
}
if (!localAuthModule.includes("signInWithEmailAndPassword") || !localAuthPanel.includes("signInWithLocalEmail")) {
  sourceMatches.push("local password auth is not isolated in the local-only modules");
}
const scriptsBuildIndex = apiDockerfile.indexOf("RUN pnpm --filter @encois/api-gateway build:scripts");
const deployIndex = apiDockerfile.indexOf("RUN pnpm deploy --legacy --filter @encois/api-gateway --prod /out");
const localSeedStageIndex = apiDockerfile.indexOf("FROM runtime AS local-seed");
const productionStageIndex = apiDockerfile.indexOf("FROM runtime AS production");
const localSeedScriptsCopyIndex = apiDockerfile.indexOf(
  "COPY --from=build /local-seed-scripts /app/dist/scripts",
);
if (
  scriptsBuildIndex < 0 ||
  deployIndex < scriptsBuildIndex ||
  localSeedStageIndex < 0 ||
  localSeedScriptsCopyIndex < localSeedStageIndex ||
  localSeedScriptsCopyIndex > productionStageIndex
) {
  sourceMatches.push("API local scripts are not isolated from the production Docker target");
}
if (!apiDockerfile.includes("FROM runtime AS production") || !apiDockerfile.includes("COPY --from=build /out ./")) {
  sourceMatches.push("API production Docker target is not separated from the local-seed target");
}

if (sourceMatches.length > 0) {
  throw new Error(["Production auth source-boundary check failed:", ...sourceMatches].join("\n"));
}

const artifactMatches = [];
if (checkArtifacts) {
  if (!await directoryExists(dashboardDist) || !await directoryExists(apiDist)) {
    throw new Error("Production artifact check requires existing dashboard and API dist directories; this script never builds artifacts.");
  }
  artifactMatches.push(...await findForbiddenContent(await textFiles(dashboardDist), [
    "local-auth-panel",
    "signInWithLocalEmail",
    "Local Auth Emulator",
    "local-password-1234",
    "local-dev-1234",
    "accounts:signInWithPassword",
  ]));
  artifactMatches.push(...await findForbiddenContent(await textFiles(apiDist), [
    "seed-local.js",
    "verify-local-api.js",
    "LOCAL_AUTH_PASSWORD",
    "local-password-1234",
    "accounts:signInWithPassword",
  ]));
  if (await directoryExists(join(apiDist, "scripts"))) artifactMatches.push("apps/api-gateway/dist/scripts exists");
}

const matches = [...artifactMatches];
if (matches.length > 0) {
  throw new Error(["Production auth artifact check failed:", ...matches].join("\n"));
}

console.log(checkArtifacts
  ? "Production auth boundary check passed: local password auth and local scripts are absent from artifacts."
  : "Production auth source-boundary check passed; artifact scan skipped (use --artifacts after building).");

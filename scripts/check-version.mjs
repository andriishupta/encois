import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const workspaceDirectories = ["apps", "packages", "tooling"];

async function packageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) continue;

    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await packageFiles(path)));
    else if (entry.isFile() && entry.name === "package.json") files.push(path);
  }

  return files;
}

const rootPackagePath = join(rootDirectory, "package.json");
const rootPackage = JSON.parse(await readFile(rootPackagePath, "utf8"));
const expectedVersion = rootPackage.version;

if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
  throw new Error("Root package.json must define a non-empty version.");
}

const workspacePackagePaths = [];
for (const directory of workspaceDirectories) {
  try {
    workspacePackagePaths.push(...(await packageFiles(join(rootDirectory, directory))));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const packagePaths = [rootPackagePath, ...workspacePackagePaths];
const mismatches = [];

for (const packagePath of packagePaths) {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageJson.version !== expectedVersion) {
    mismatches.push(`${packagePath}: ${packageJson.version ?? "missing"} (expected ${expectedVersion})`);
  }
}

if (mismatches.length > 0) {
  throw new Error(["Workspace package versions are not aligned:", ...mismatches].join("\n"));
}

console.log(`Encois release version: ${expectedVersion}`);

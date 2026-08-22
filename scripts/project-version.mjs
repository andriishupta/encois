import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
  throw new Error("Root package.json must define a non-empty version.");
}

process.stdout.write(packageJson.version);

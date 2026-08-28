import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const [typescriptValues, goValues, schemaFiles] = await Promise.all([
  readFile(join(packageRoot, "src/values.ts"), "utf8"),
  readFile(join(packageRoot, "values.go"), "utf8"),
  readdir(join(packageRoot, "schemas")),
]);

function objectValues(source, name) {
  const match = source.match(
    new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`),
  );
  if (!match) throw new Error(`TypeScript value set ${name} was not found`);
  return [...match[1].matchAll(/:\s*"([^"]+)"/g)].map((entry) => entry[1]);
}

function goStringValues(source, name) {
  const match = source.match(
    new RegExp(`type ${name} string[\\s\\S]*?const \\(([\\s\\S]*?)\\)`),
  );
  if (!match) throw new Error(`Go value set ${name} was not found`);
  return [...match[1].matchAll(/=\s*"([^"]+)"/g)].map((entry) => entry[1]);
}

function assertSameValues(name, left, right) {
  const leftValues = [...new Set(left)].sort();
  const rightValues = [...new Set(right)].sort();
  if (JSON.stringify(leftValues) !== JSON.stringify(rightValues)) {
    throw new Error(
      `${name} drifted between TypeScript and Go:\nTypeScript: ${leftValues.join(", ")}\nGo: ${rightValues.join(", ")}`,
    );
  }
}

const contractVersions = objectValues(typescriptValues, "ContractVersion");
const goContractVersions = [...goValues.matchAll(/ContractVersion\s*=\s*"([^"]+)"/g)].map(
  (entry) => entry[1],
);
const schemaVersions = schemaFiles
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -".json".length));

assertSameValues("ContractVersion", contractVersions, goContractVersions);
assertSameValues("contract schemas", contractVersions, schemaVersions);

for (const name of [
  "WorkflowStepKind",
  "WorkflowExecutionStatus",
  "WorkflowResultStatus",
  "AgentResultStatus",
  "ToolResultStatus",
  "GraphQueryStatus",
  "AgentMemoryOperation",
  "AgentMemoryStatus",
  "ToolSideEffects",
  "CoordinatorEventType",
  "WorkflowChangeKind",
  "OrganizationUnitType",
  "ScopeRuleMode",
  "FreshnessStatus",
  "WorkflowStatusReason",
  "ArtifactRetentionClass",
  "MemoryRedactionStatus",
  "IntegrationStatus",
  "KnowledgeSourceKind",
  "KnowledgeSourceStatus",
  "SourceRevisionStatus",
  "SourceIngestionTrigger",
  "SourceIngestionStatus",
]) {
  assertSameValues(
    name,
    objectValues(typescriptValues, name),
    goStringValues(goValues, name),
  );
}

console.log("Contract versions and shared enums match TypeScript, Go, and JSON Schema.");

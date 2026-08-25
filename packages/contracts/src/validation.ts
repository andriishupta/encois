import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import agentMemorySchema from "../schemas/agent-memory.v1.json" with {
  type: "json",
};
import agentMemoryResultSchema from "../schemas/agent-memory-result.v1.json" with {
  type: "json",
};
import artifactReadSchema from "../schemas/artifact-read.v1.json" with {
  type: "json",
};
import artifactWriteSchema from "../schemas/artifact-write.v1.json" with {
  type: "json",
};
import artifactWriteResultSchema from "../schemas/artifact-write-result.v1.json" with {
  type: "json",
};
import blueprintWorkflowResultSchema from "../schemas/blueprint-workflow-result.v1.json" with {
  type: "json",
};
import bootstrapProjectSchema from "../schemas/bootstrap-project.v1.json" with {
  type: "json",
};
import coordinatorSchema from "../schemas/coordinator.v1.json" with {
  type: "json",
};
import coordinatorEventSchema from "../schemas/coordinator-event.v1.json" with {
  type: "json",
};
import executionContextSchema from "../schemas/execution-context.v1.json" with {
  type: "json",
};
import graphQuerySchema from "../schemas/graph-query.v1.json" with {
  type: "json",
};
import graphQueryResultSchema from "../schemas/graph-query-result.v1.json" with {
  type: "json",
};
import graphUpsertSchema from "../schemas/graph-upsert.v1.json" with {
  type: "json",
};
import knowledgeSourceSchema from "../schemas/knowledge-source.v1.json" with {
  type: "json",
};
import sourceIngestionSchema from "../schemas/source-ingestion.v1.json" with {
  type: "json",
};
import sourceIngestionResultSchema from "../schemas/source-ingestion-result.v1.json" with {
  type: "json",
};
import sourceRevisionSchema from "../schemas/source-revision.v1.json" with {
  type: "json",
};
import toolManifestSchema from "../schemas/tool-manifest.v1.json" with {
  type: "json",
};
import toolRequestSchema from "../schemas/tool-request.v1.json" with {
  type: "json",
};
import toolResultSchema from "../schemas/tool-result.v1.json" with {
  type: "json",
};
import workflowBlueprintSchema from "../schemas/workflow-blueprint.v1.json" with {
  type: "json",
};
import workflowBlueprintLifecycleSchema from "../schemas/workflow-blueprint-lifecycle.v1.json" with {
  type: "json",
};
import workflowChangePlanSchema from "../schemas/workflow-change-plan.v1.json" with {
  type: "json",
};
import workflowSignalSchema from "../schemas/workflow-signal.v1.json" with {
  type: "json",
};
import workflowUpdateSchema from "../schemas/workflow-update.v1.json" with {
  type: "json",
};

export const CONTRACT_SCHEMA_FILES = {
  workflowBlueprint: "workflow-blueprint.v1.json",
  workflowResult: "blueprint-workflow-result.v1.json",
  workflowSignal: "workflow-signal.v1.json",
  executionContext: "execution-context.v1.json",
  toolRequest: "tool-request.v1.json",
  toolResult: "tool-result.v1.json",
  artifactWrite: "artifact-write.v1.json",
  artifactRead: "artifact-read.v1.json",
  artifactWriteResult: "artifact-write-result.v1.json",
  graphQuery: "graph-query.v1.json",
  graphUpsert: "graph-upsert.v1.json",
  graphQueryResult: "graph-query-result.v1.json",
  agentMemory: "agent-memory.v1.json",
  agentMemoryResult: "agent-memory-result.v1.json",
  toolManifest: "tool-manifest.v1.json",
  workflowUpdate: "workflow-update.v1.json",
  workflowChangePlan: "workflow-change-plan.v1.json",
  workflowBlueprintLifecycle: "workflow-blueprint-lifecycle.v1.json",
  coordinatorEvent: "coordinator-event.v1.json",
  coordinator: "coordinator.v1.json",
  bootstrapProject: "bootstrap-project.v1.json",
  knowledgeSource: "knowledge-source.v1.json",
  sourceRevision: "source-revision.v1.json",
  sourceIngestion: "source-ingestion.v1.json",
  sourceIngestionResult: "source-ingestion-result.v1.json",
} as const;

export type ContractSchemaName = keyof typeof CONTRACT_SCHEMA_FILES;

export type ContractValidationResult = {
  valid: boolean;
  errors: readonly string[];
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemas: Record<ContractSchemaName, object> = {
  workflowBlueprint: workflowBlueprintSchema,
  workflowResult: blueprintWorkflowResultSchema,
  workflowSignal: workflowSignalSchema,
  executionContext: executionContextSchema,
  toolRequest: toolRequestSchema,
  toolResult: toolResultSchema,
  artifactWrite: artifactWriteSchema,
  artifactRead: artifactReadSchema,
  artifactWriteResult: artifactWriteResultSchema,
  graphQuery: graphQuerySchema,
  graphUpsert: graphUpsertSchema,
  graphQueryResult: graphQueryResultSchema,
  agentMemory: agentMemorySchema,
  agentMemoryResult: agentMemoryResultSchema,
  toolManifest: toolManifestSchema,
  workflowUpdate: workflowUpdateSchema,
  workflowChangePlan: workflowChangePlanSchema,
  workflowBlueprintLifecycle: workflowBlueprintLifecycleSchema,
  coordinatorEvent: coordinatorEventSchema,
  coordinator: coordinatorSchema,
  bootstrapProject: bootstrapProjectSchema,
  knowledgeSource: knowledgeSourceSchema,
  sourceRevision: sourceRevisionSchema,
  sourceIngestion: sourceIngestionSchema,
  sourceIngestionResult: sourceIngestionResultSchema,
};
const validators = new Map<ContractSchemaName, ValidateFunction>();

function validatorFor(name: ContractSchemaName): ValidateFunction {
  const existing = validators.get(name);
  if (existing) return existing;

  const validator = ajv.compile(schemas[name]);
  validators.set(name, validator);
  return validator;
}

function formatError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? "is invalid"}`;
}

/** Validate an untrusted JSON value against the canonical versioned schema. */
export function validateContract(
  name: ContractSchemaName,
  value: unknown,
): ContractValidationResult {
  const validator = validatorFor(name);
  const valid = validator(value);
  return {
    valid: valid === true,
    errors: valid === true ? [] : (validator.errors ?? []).map(formatError),
  };
}

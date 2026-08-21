import { readFileSync } from "node:fs";
import { Client, Connection, WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from "@temporalio/client";
import { CoordinatorSignalName, WorkflowExecutionStatus, type CoordinatorEvent } from "@encois/contracts";
import type { AppConfig } from "../config.js";
import { buildCoordinatorWorkflowId, type WorkflowExecutionProjection, type WorkflowRunStatus, type WorkflowSignalRequest, type WorkflowStartCommand, type WorkflowUpdateRequest } from "./types.js";

export type WorkflowClient = {
  start(command: WorkflowStartCommand, namespace: string): Promise<WorkflowExecutionProjection>;
  get(workflowId: string, organizationId: string, namespace: string): Promise<WorkflowExecutionProjection | null>;
  list(organizationId: string, namespace: string): Promise<readonly WorkflowExecutionProjection[]>;
  signal(workflowId: string, organizationId: string, namespace: string, request: WorkflowSignalRequest): Promise<void>;
  signalCoordinator(coordinatorId: string, organizationId: string, namespace: string, event: CoordinatorEvent): Promise<void>;
  update(workflowId: string, organizationId: string, namespace: string, request: WorkflowUpdateRequest): Promise<void>;
  cancel(workflowId: string, organizationId: string, namespace: string): Promise<void>;
};

function now(): string {
  return new Date().toISOString();
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function temporalStatus(value: string): WorkflowRunStatus {
  const normalized = value.toLowerCase();
  if (normalized.includes("completed")) return WorkflowExecutionStatus.Completed;
  if (normalized.includes("failed") || normalized.includes("timed_out")) return WorkflowExecutionStatus.Failed;
  if (normalized.includes("cancel")) return WorkflowExecutionStatus.Cancelled;
  if (normalized.includes("waiting")) return WorkflowExecutionStatus.Waiting;
  return WorkflowExecutionStatus.Running;
}

function createInMemoryWorkflowClient(): WorkflowClient {
  const executions = new Map<string, WorkflowExecutionProjection>();
  const requestHashes = new Map<string, string>();
  const updateHashes = new Map<string, string>();

  return {
    async start(command, namespace) {
      const existing = executions.get(command.workflowId);
      if (existing && existing.organizationId === command.input.organizationId) {
        const previousHash = requestHashes.get(command.workflowId);
        if (previousHash && previousHash !== command.requestHash) throw new Error("idempotency conflict");
        return { ...existing, reused: true, updatedAt: now() };
      }
      const timestamp = now();
      const execution: WorkflowExecutionProjection = {
        workflowId: command.workflowId,
        workflowType: command.workflowType,
        namespace,
        taskQueue: command.taskQueue,
        status: WorkflowExecutionStatus.Queued,
        organizationId: command.input.organizationId,
        blueprintId: command.input.blueprint?.blueprintId,
        reused: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      executions.set(command.workflowId, execution);
      requestHashes.set(command.workflowId, command.requestHash);
      return execution;
    },

    async get(workflowId, organizationId) {
      const execution = executions.get(workflowId);
      return execution?.organizationId === organizationId ? execution : null;
    },

    async list(organizationId) {
      return [...executions.values()].filter((execution) => execution.organizationId === organizationId);
    },

    async signal(workflowId, organizationId, _namespace, request) {
      const execution = executions.get(workflowId);
      if (!execution || execution.organizationId !== organizationId) throw new Error("workflow not found");
      if (!["queued", "running", "waiting"].includes(execution.status)) {
        throw new Error(`workflow is ${execution.status} and cannot accept a Signal`);
      }
      let status: WorkflowRunStatus = WorkflowExecutionStatus.Running;
      if (request.payload.approved === false) status = WorkflowExecutionStatus.Failed;
      executions.set(workflowId, { ...execution, status, updatedAt: now() });
    },

    async signalCoordinator(coordinatorId, organizationId, _namespace, _event) {
      const workflowId = buildCoordinatorWorkflowId(organizationId, coordinatorId);
      const execution = executions.get(workflowId);
      if (!execution || execution.organizationId !== organizationId) throw new Error("Coordinator workflow not found");
      if (!["queued", "running", "waiting"].includes(execution.status)) {
        throw new Error(`Coordinator workflow is ${execution.status} and cannot accept an event`);
      }
      executions.set(workflowId, { ...execution, status: WorkflowExecutionStatus.Running, updatedAt: now() });
    },

    async update(workflowId, organizationId, _namespace, request) {
      const execution = executions.get(workflowId);
      if (!execution || execution.organizationId !== organizationId) throw new Error("workflow not found");
      if (!["queued", "running", "waiting"].includes(execution.status)) {
        throw new Error(`workflow is ${execution.status} and cannot accept an Update`);
      }
      const updateKey = `${workflowId}:${request.updateId}`;
      const updateHash = stableSerialize(request.payload);
      const previousHash = updateHashes.get(updateKey);
      if (previousHash && previousHash !== updateHash) throw new Error("idempotency conflict");
      updateHashes.set(updateKey, updateHash);
      return;
    },

    async cancel(workflowId, organizationId) {
      const execution = executions.get(workflowId);
      if (!execution || execution.organizationId !== organizationId) throw new Error("workflow not found");
      if (execution.status === WorkflowExecutionStatus.Cancelled) return;
      if (!["queued", "running", "waiting"].includes(execution.status)) {
        throw new Error(`workflow is ${execution.status} and cannot be cancelled`);
      }
      executions.set(workflowId, { ...execution, status: WorkflowExecutionStatus.Cancelled, updatedAt: now() });
    },
  };
}

type TemporalWorkflowClientOptions = {
  address: string;
  apiKey?: string;
  tlsClientCertPath?: string;
  tlsClientKeyPath?: string;
  defaultNamespace: string;
};

function createTemporalWorkflowClient(options: TemporalWorkflowClientOptions): WorkflowClient {
  let connectionPromise: Promise<Connection> | undefined;
  let clientPromise: Promise<Client> | undefined;

  const getClient = async (): Promise<Client> => {
    const certPath = options.tlsClientCertPath;
    const keyPath = options.tlsClientKeyPath;
    let tls: boolean | { clientCertPair: { crt: Buffer; key: Buffer } } = Boolean(options.apiKey);
    if (certPath || keyPath) {
      if (!certPath || !keyPath) {
        throw new Error("Both Temporal TLS client certificate and key paths are required.");
      }
      tls = {
        clientCertPair: {
          crt: readFileSync(certPath),
          key: readFileSync(keyPath),
        },
      };
    }

    connectionPromise ??= Connection.connect({
      address: options.address,
      apiKey: options.apiKey,
      tls,
    });
    clientPromise ??= connectionPromise.then((connection) => new Client({
      connection,
      namespace: options.defaultNamespace,
    }));

    return clientPromise;
  };

  return {
    async start(command, namespace) {
      const client = await getClient();
      const existingHandle = client.workflow.getHandle(command.workflowId);
      let description: Awaited<ReturnType<typeof existingHandle.describe>> | undefined;
      try {
        description = await existingHandle.describe();
      } catch {
        // The workflow does not exist yet. The conflict policy below still
        // protects against a concurrent start race.
      }
      if (description) {
        const existingRequestHash = description.memo?.encoisRequestHash;
        if (typeof existingRequestHash === "string" && existingRequestHash !== command.requestHash) {
          throw new Error("idempotency conflict");
        }
        return {
          workflowId: command.workflowId,
          runId: description.runId,
          workflowType: description.type,
          namespace,
          taskQueue: description.taskQueue,
          status: temporalStatus(description.status.name),
          organizationId: command.input.organizationId,
          blueprintId: command.input.blueprint?.blueprintId,
          reused: true,
          createdAt: description.startTime?.toISOString() ?? now(),
          updatedAt: now(),
        };
      }
      const handle = await client.workflow.start(command.workflowType, {
        args: [command.input],
        taskQueue: command.taskQueue,
        workflowId: command.workflowId,
        memo: { encoisRequestHash: command.requestHash },
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      });
      const timestamp = now();

      return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
        workflowType: command.workflowType,
        namespace,
        taskQueue: command.taskQueue,
        status: WorkflowExecutionStatus.Queued,
        organizationId: command.input.organizationId,
        blueprintId: command.input.blueprint?.blueprintId,
        reused: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },

    async get(workflowId, organizationId, namespace) {
      if (!workflowId.startsWith(`workflow:${organizationId}:`)) return null;

      const client = await getClient();
      const handle = client.workflow.getHandle(workflowId);
      const description = await handle.describe();
      const timestamp = now();

      return {
        workflowId,
        runId: description.runId,
        workflowType: description.type,
        namespace,
        taskQueue: description.taskQueue,
        status: temporalStatus(description.status.name),
        organizationId,
        createdAt: description.startTime?.toISOString() ?? timestamp,
        updatedAt: timestamp,
      };
    },

    async list(organizationId, namespace) {
      const temporalClient = await getClient();
      const executions: WorkflowExecutionProjection[] = [];
      for await (const info of temporalClient.workflow.list({
        query: `WorkflowId STARTS_WITH \"workflow:${organizationId}:\"`,
      })) {
        executions.push({
          workflowId: info.workflowId,
          runId: info.runId,
          workflowType: info.type,
          namespace,
          taskQueue: info.taskQueue,
          status: temporalStatus(info.status.name),
          organizationId,
          createdAt: info.startTime.toISOString(),
          updatedAt: (info.closeTime ?? info.startTime).toISOString(),
        });
      }
      return executions;
    },

    async signal(workflowId, organizationId, _namespace, request) {
      if (!workflowId.startsWith(`workflow:${organizationId}:`)) throw new Error("workflow not found");
      const temporalClient = await getClient();
      await temporalClient.workflow.getHandle(workflowId).signal(request.signalName, request.payload);
    },

    async signalCoordinator(coordinatorId, organizationId, _namespace, event) {
      if (!organizationId || !coordinatorId || event.organizationId !== organizationId || event.coordinatorId !== coordinatorId) {
        throw new Error("Coordinator event scope does not match the target");
      }
      const temporalClient = await getClient();
      const workflowId = buildCoordinatorWorkflowId(organizationId, coordinatorId);
      await temporalClient.workflow.getHandle(workflowId).signal(CoordinatorSignalName.Event, event);
    },

    async update(workflowId, organizationId, _namespace, request) {
      if (!workflowId.startsWith(`workflow:${organizationId}:`)) throw new Error("workflow not found");
      const temporalClient = await getClient();
      await temporalClient.workflow.getHandle(workflowId).executeUpdate(request.updateName, {
        args: [{ updateId: request.updateId, ...request.payload }],
        updateId: request.updateId,
      });
    },

    async cancel(workflowId, organizationId) {
      if (!workflowId.startsWith(`workflow:${organizationId}:`)) throw new Error("workflow not found");
      const handle = (await getClient()).workflow.getHandle(workflowId);
      const description = await handle.describe();
      const status = temporalStatus(description.status.name);
      if (status === WorkflowExecutionStatus.Cancelled) return;
      if (!["queued", "running", "waiting"].includes(status)) {
        throw new Error(`workflow is ${status} and cannot be cancelled`);
      }
      await handle.cancel();
    },
  };
}

export function createWorkflowClient(config: AppConfig): WorkflowClient {
  if (!config.temporalAddress) return createInMemoryWorkflowClient();

  return createTemporalWorkflowClient({
    address: config.temporalAddress,
    apiKey: config.temporalApiKey,
    tlsClientCertPath: config.temporalTlsClientCertPath,
    tlsClientKeyPath: config.temporalTlsClientKeyPath,
    defaultNamespace: config.temporalNamespace,
  });
}

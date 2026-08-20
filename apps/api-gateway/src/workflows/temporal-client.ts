import { readFileSync } from "node:fs";
import { Client, Connection } from "@temporalio/client";
import type { AppConfig } from "../config.js";
import type { WorkflowExecutionProjection, WorkflowRunStatus, WorkflowStartCommand } from "./types.js";

export type WorkflowClient = {
  start(command: WorkflowStartCommand, namespace: string): Promise<WorkflowExecutionProjection>;
  get(workflowId: string, organizationId: string, namespace: string): Promise<WorkflowExecutionProjection | null>;
};

function now(): string {
  return new Date().toISOString();
}

function temporalStatus(value: string): WorkflowRunStatus {
  const normalized = value.toLowerCase();
  if (normalized.includes("completed")) return "completed";
  if (normalized.includes("failed") || normalized.includes("timed_out")) return "failed";
  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("waiting")) return "waiting";
  return "running";
}

function createInMemoryWorkflowClient(): WorkflowClient {
  const executions = new Map<string, WorkflowExecutionProjection>();

  return {
    async start(command, namespace) {
      const timestamp = now();
      const execution: WorkflowExecutionProjection = {
        workflowId: command.workflowId,
        workflowType: command.workflowType,
        namespace,
        taskQueue: command.taskQueue,
        status: "queued",
        organizationId: command.input.organizationId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      executions.set(command.workflowId, execution);
      return execution;
    },

    async get(workflowId, organizationId) {
      const execution = executions.get(workflowId);
      return execution?.organizationId === organizationId ? execution : null;
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
      const handle = await client.workflow.start(command.workflowType, {
        args: [command.input],
        taskQueue: command.taskQueue,
        workflowId: command.workflowId,
      });
      const timestamp = now();

      return {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
        workflowType: command.workflowType,
        namespace,
        taskQueue: command.taskQueue,
        status: "queued",
        organizationId: command.input.organizationId,
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

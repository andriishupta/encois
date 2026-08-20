import { readFileSync } from "node:fs";
import { Client, Connection } from "@temporalio/client";
import type { AppConfig } from "../config.js";
import type {
  WorkflowExecutionProjection,
  WorkflowStartCommand,
  WorkflowRunStatus,
} from "./types.js";

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

export class InMemoryWorkflowClient implements WorkflowClient {
  private readonly executions = new Map<string, WorkflowExecutionProjection>();

  async start(command: WorkflowStartCommand, namespace: string): Promise<WorkflowExecutionProjection> {
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

    this.executions.set(command.workflowId, execution);
    return execution;
  }

  async get(workflowId: string, organizationId: string, _namespace: string): Promise<WorkflowExecutionProjection | null> {
    const execution = this.executions.get(workflowId);
    return execution?.organizationId === organizationId ? execution : null;
  }
}

export type TemporalWorkflowClientOptions = {
  address: string;
  apiKey?: string;
  tlsClientCertPath?: string;
  tlsClientKeyPath?: string;
  defaultNamespace: string;
};

export class TemporalWorkflowClient implements WorkflowClient {
  private connectionPromise?: Promise<Connection>;

  public constructor(private readonly options: TemporalWorkflowClientOptions) {}

  private async client(): Promise<Client> {
    const hasCert = Boolean(this.options.tlsClientCertPath || this.options.tlsClientKeyPath);
    if (hasCert && (!this.options.tlsClientCertPath || !this.options.tlsClientKeyPath)) {
      throw new Error("Both Temporal TLS client certificate and key paths are required.");
    }

    this.connectionPromise ??= Connection.connect({
      address: this.options.address,
      apiKey: this.options.apiKey,
      tls: hasCert
        ? {
            clientCertPair: {
              crt: readFileSync(this.options.tlsClientCertPath as string),
              key: readFileSync(this.options.tlsClientKeyPath as string),
            },
          }
        : Boolean(this.options.apiKey),
    });

    return new Client({
      connection: await this.connectionPromise,
      namespace: this.options.defaultNamespace,
    });
  }

  async start(command: WorkflowStartCommand, namespace: string): Promise<WorkflowExecutionProjection> {
    const client = await this.client();
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
  }

  async get(workflowId: string, organizationId: string, namespace: string): Promise<WorkflowExecutionProjection | null> {
    if (!workflowId.startsWith(`workflow:${organizationId}:`)) return null;

    const client = await this.client();
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
  }
}

export function createWorkflowClient(config: AppConfig): WorkflowClient {
  if (!config.temporalAddress) return new InMemoryWorkflowClient();

  return new TemporalWorkflowClient({
    address: config.temporalAddress,
    apiKey: config.temporalApiKey,
    tlsClientCertPath: config.temporalTlsClientCertPath,
    tlsClientKeyPath: config.temporalTlsClientKeyPath,
    defaultNamespace: config.temporalNamespace,
  });
}

import { readFileSync } from "node:fs";
import {
  type CoordinatorEvent,
  CoordinatorSignalName,
  type CoordinatorState,
  WorkflowExecutionStatus,
  WorkflowSignalName,
  WorkflowStatusReason,
} from "@encois/contracts";
import {
  Client,
  Connection,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";
import type { AppConfig } from "../config.js";
import {
  buildCoordinatorWorkflowId,
  type WorkflowExecutionProjection,
  type WorkflowRunStatus,
  type WorkflowSignalRequest,
  type WorkflowStartCommand,
  type WorkflowUpdateRequest,
} from "./types.js";

export type WorkflowClient = {
  start(
    command: WorkflowStartCommand,
    namespace: string,
  ): Promise<WorkflowExecutionProjection>;
  get(
    workflowId: string,
    organizationId: string,
    namespace: string,
  ): Promise<WorkflowExecutionProjection | null>;
  list(
    organizationId: string,
    namespace: string,
  ): Promise<readonly WorkflowExecutionProjection[]>;
  signal(
    workflowId: string,
    organizationId: string,
    namespace: string,
    request: WorkflowSignalRequest,
  ): Promise<void>;
  signalCoordinator(
    coordinatorId: string,
    organizationId: string,
    namespace: string,
    event: CoordinatorEvent,
  ): Promise<void>;
  getCoordinatorState?(
    coordinatorId: string,
    organizationId: string,
    namespace: string,
  ): Promise<CoordinatorState | null>;
  update(
    workflowId: string,
    organizationId: string,
    namespace: string,
    request: WorkflowUpdateRequest,
  ): Promise<void>;
  cancel(
    workflowId: string,
    organizationId: string,
    namespace: string,
  ): Promise<void>;
  terminate(
    workflowId: string,
    organizationId: string,
    namespace: string,
  ): Promise<void>;
};

export type WorkflowResultReader = {
  GetResult(
    workflowId: string,
    organizationId: string,
    namespace: string,
  ): Promise<unknown | null>;
};

function now(): string {
  return new Date().toISOString();
}

function temporalStatus(value: string): WorkflowRunStatus {
  switch (value) {
    case "RUNNING":
    case "CONTINUED_AS_NEW":
      return WorkflowExecutionStatus.Running;
    case "PAUSED":
      return WorkflowExecutionStatus.Paused;
    case "COMPLETED":
      return WorkflowExecutionStatus.Completed;
    case "CANCELLED":
      return WorkflowExecutionStatus.Cancelled;
    case "FAILED":
    case "TERMINATED":
    case "TIMED_OUT":
    case "UNSPECIFIED":
    case "UNKNOWN":
    default:
      return WorkflowExecutionStatus.Failed;
  }
}

function temporalStatusMessage(value: string): string | undefined {
  switch (value) {
    case "TERMINATED":
      return "Temporal terminated this workflow.";
    case "TIMED_OUT":
      return "Temporal timed out this workflow.";
    case "FAILED":
    case "CANCELLED":
    case "COMPLETED":
    case "RUNNING":
    case "PAUSED":
    case "CONTINUED_AS_NEW":
      return undefined;
    case "UNSPECIFIED":
    case "UNKNOWN":
    default:
      return `Temporal reported an unsupported workflow status: ${value}.`;
  }
}

function canRetryClosedExecution(statusName: string): boolean {
  return ["FAILED", "TERMINATED", "TIMED_OUT", "CANCELLED"].includes(
    statusName,
  );
}

const coordinatorStateTimeoutMs = 2_000;
const coordinatorControlTimeoutMs = 5_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type TemporalStatusHandle = {
  result(): Promise<unknown>;
  query<Ret>(definition: string): Promise<Ret>;
};

type TemporalRuntimeStatus = {
  status: WorkflowRunStatus;
  statusReason?: WorkflowStatusReason;
};

function parseTemporalRuntimeStatus(
  value: unknown,
): TemporalRuntimeStatus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { status?: unknown; statusReason?: unknown };
  if (
    record.status !== WorkflowExecutionStatus.Running &&
    record.status !== WorkflowExecutionStatus.Waiting &&
    record.status !== WorkflowExecutionStatus.Paused
  )
    return undefined;
  const statusReason = Object.values(WorkflowStatusReason).includes(
    record.statusReason as WorkflowStatusReason,
  )
    ? (record.statusReason as WorkflowStatusReason)
    : undefined;
  return { status: record.status, ...(statusReason ? { statusReason } : {}) };
}

export function parseTemporalResultStatus(
  value: unknown,
): TemporalRuntimeStatus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { status?: unknown; statusReason?: unknown };
  if (
    record.status !== WorkflowExecutionStatus.Completed &&
    record.status !== WorkflowExecutionStatus.Waiting &&
    record.status !== WorkflowExecutionStatus.Partial &&
    record.status !== WorkflowExecutionStatus.Failed
  )
    return undefined;
  const statusReason = Object.values(WorkflowStatusReason).includes(
    record.statusReason as WorkflowStatusReason,
  )
    ? (record.statusReason as WorkflowStatusReason)
    : undefined;
  return { status: record.status, ...(statusReason ? { statusReason } : {}) };
}

async function temporalRuntimeStatus(
  handle: TemporalStatusHandle,
  status: WorkflowRunStatus,
  workflowType: string,
): Promise<TemporalRuntimeStatus | undefined> {
  if (
    workflowType !== "encois.dynamic.v1" ||
    (status !== WorkflowExecutionStatus.Running &&
      status !== WorkflowExecutionStatus.Paused)
  )
    return undefined;
  try {
    return parseTemporalRuntimeStatus(
      await handle.query<unknown>("workflow-status"),
    );
  } catch {
    // Older workers and non-Dynamic workflows may not expose this query.
    return undefined;
  }
}

async function temporalResultStatus(
  handle: TemporalStatusHandle,
  status: WorkflowRunStatus,
  workflowType: string,
): Promise<TemporalRuntimeStatus | undefined> {
  if (
    workflowType !== "encois.dynamic.v1" ||
    status !== WorkflowExecutionStatus.Completed
  )
    return undefined;
  try {
    const result = await handle.result();
    return parseTemporalResultStatus(result);
  } catch {
    return undefined;
  }
}

async function resolveTemporalStatus(
  handle: TemporalStatusHandle,
  statusName: string,
  workflowType: string,
): Promise<{
  status: WorkflowRunStatus;
  statusReason?: WorkflowStatusReason;
  statusMessage?: string;
}> {
  const describedStatus = temporalStatus(statusName);
  const runtimeStatus =
    (await temporalRuntimeStatus(handle, describedStatus, workflowType)) ??
    (await temporalResultStatus(handle, describedStatus, workflowType));
  const status = runtimeStatus?.status ?? describedStatus;
  const statusMessage =
    status === WorkflowExecutionStatus.Failed
      ? ((await temporalFailureMessage(handle)) ??
        temporalStatusMessage(statusName))
      : temporalStatusMessage(statusName);
  return {
    status,
    ...(runtimeStatus?.statusReason
      ? { statusReason: runtimeStatus.statusReason }
      : {}),
    ...(statusMessage ? { statusMessage } : {}),
  };
}

async function temporalFailureMessage(
  handle: TemporalStatusHandle,
): Promise<string | undefined> {
  try {
    await handle.result();
    return undefined;
  } catch (error) {
    const messages: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (current instanceof Error && current.message) {
        messages.push(current.message);
        current = (current as Error & { cause?: unknown }).cause;
        continue;
      }
      break;
    }
    const message = messages[messages.length - 1] ?? String(error);
    return message.length > 2000 ? `${message.slice(0, 1997)}…` : message;
  }
}

function workflowIdBelongsToOrganization(
  workflowId: string,
  organizationId: string,
): boolean {
  return (
    Boolean(organizationId) &&
    [`org:${organizationId}:`, `workflow:${organizationId}:`].some((prefix) =>
      workflowId.startsWith(prefix),
    )
  );
}

function semanticWorkflowType(
  input: WorkflowStartCommand["input"],
  workflowType: string,
): string {
  if (workflowType === "encois.source-ingestion.v1")
    return "Encois · Source ingestion";
  const provider = input.blueprint?.steps
    .map((step) => step.tool?.split(".")[0])
    .find((value): value is string => Boolean(value));
  if (provider)
    return `Encois · ${provider.charAt(0).toUpperCase()}${provider.slice(1)} workflow`;
  return "Encois · Workflow";
}

function assertWorkflowCommandTenant(command: WorkflowStartCommand): void {
  if (
    !command.input.organizationId ||
    !workflowIdBelongsToOrganization(
      command.workflowId,
      command.input.organizationId,
    ) ||
    command.input.workflowId !== command.workflowId
  ) {
    throw new Error("workflow id is outside the organization scope");
  }
}

type TemporalWorkflowClientOptions = {
  address: string;
  apiKey?: string;
  tlsClientCertPath?: string;
  tlsClientKeyPath?: string;
  defaultNamespace: string;
};

function createTemporalWorkflowClient(
  options: TemporalWorkflowClientOptions,
): WorkflowClient & WorkflowResultReader {
  let connectionPromise: Promise<Connection> | undefined;
  let clientPromise: Promise<Client> | undefined;

  const getClient = async (): Promise<Client> => {
    const certPath = options.tlsClientCertPath;
    const keyPath = options.tlsClientKeyPath;
    let tls: boolean | { clientCertPair: { crt: Buffer; key: Buffer } } =
      Boolean(options.apiKey);
    if (certPath || keyPath) {
      if (!certPath || !keyPath) {
        throw new Error(
          "Both Temporal TLS client certificate and key paths are required.",
        );
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
    clientPromise ??= connectionPromise.then(
      (connection) =>
        new Client({
          connection,
          namespace: options.defaultNamespace,
        }),
    );

    return clientPromise;
  };

  return {
    async start(command, namespace) {
      assertWorkflowCommandTenant(command);
      const client = await getClient();
      const existingHandle = client.workflow.getHandle(command.workflowId);
      let description:
        | Awaited<ReturnType<typeof existingHandle.describe>>
        | undefined;
      try {
        description = await existingHandle.describe();
      } catch {
        // The workflow does not exist yet. The conflict policy below still
        // protects against a concurrent start race.
      }
      if (description) {
        const retryClosedExecution =
          command.retryClosedExecution === true &&
          canRetryClosedExecution(description.status.name);
        if (!retryClosedExecution) {
          const existingRequestHash = description.memo?.encoisRequestHash;
          if (
            typeof existingRequestHash === "string" &&
            existingRequestHash !== command.requestHash
          ) {
            throw new Error("idempotency conflict");
          }
          const resolvedStatus = await resolveTemporalStatus(
            existingHandle,
            description.status.name,
            description.type,
          );
          return {
            workflowId: command.workflowId,
            runId: description.runId,
            workflowType: description.type,
            namespace,
            taskQueue: description.taskQueue,
            ...resolvedStatus,
            organizationId: command.input.organizationId,
            blueprintId:
              typeof description.memo?.encoisBlueprintId === "string"
                ? description.memo.encoisBlueprintId
                : command.input.blueprint?.blueprintId,
            blueprintVersion:
              typeof description.memo?.encoisBlueprintVersion === "string"
                ? description.memo.encoisBlueprintVersion
                : (command.input.blueprint?.version ??
                  command.input.blueprintVersion),
            ...(typeof description.memo?.encoisParentWorkflowId === "string"
              ? { parentWorkflowId: description.memo.encoisParentWorkflowId }
              : {}),
            ...(typeof description.memo?.encoisTrigger === "string"
              ? { trigger: description.memo.encoisTrigger }
              : {}),
            reused: true,
            createdAt: description.startTime?.toISOString() ?? now(),
            ...(description.closeTime
              ? { completedAt: description.closeTime.toISOString() }
              : {}),
            updatedAt: now(),
          };
        }
      }
      const handle = await client.workflow.start(command.workflowType, {
        args: [command.input],
        taskQueue: command.taskQueue,
        workflowId: command.workflowId,
        memo: {
          encoisRequestHash: command.requestHash,
          encoisWorkflowType: semanticWorkflowType(
            command.input,
            command.workflowType,
          ),
          ...(command.input.blueprint?.blueprintId
            ? { encoisBlueprintId: command.input.blueprint.blueprintId }
            : {}),
          ...(command.input.blueprint?.version || command.input.blueprintVersion
            ? {
                encoisBlueprintVersion:
                  command.input.blueprint?.version ??
                  command.input.blueprintVersion,
              }
            : {}),
          ...(command.input.parentWorkflowId
            ? { encoisParentWorkflowId: command.input.parentWorkflowId }
            : {}),
          ...(command.input.trigger
            ? { encoisTrigger: command.input.trigger }
            : {}),
        },
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy:
          command.retryClosedExecution === true
            ? WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY
            : WorkflowIdReusePolicy.REJECT_DUPLICATE,
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
        blueprintVersion:
          command.input.blueprint?.version ?? command.input.blueprintVersion,
        ...(command.input.parentWorkflowId
          ? { parentWorkflowId: command.input.parentWorkflowId }
          : {}),
        ...(command.input.trigger ? { trigger: command.input.trigger } : {}),
        reused: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },

    async get(workflowId, organizationId, namespace) {
      if (!workflowIdBelongsToOrganization(workflowId, organizationId))
        return null;

      const client = await getClient();
      const handle = client.workflow.getHandle(workflowId);
      const description = await handle.describe();
      const timestamp = now();
      const resolvedStatus = await resolveTemporalStatus(
        handle,
        description.status.name,
        description.type,
      );

      return {
        workflowId,
        runId: description.runId,
        workflowType: description.type,
        namespace,
        taskQueue: description.taskQueue,
        ...resolvedStatus,
        organizationId,
        blueprintId:
          typeof description.memo?.encoisBlueprintId === "string"
            ? description.memo.encoisBlueprintId
            : undefined,
        blueprintVersion:
          typeof description.memo?.encoisBlueprintVersion === "string"
            ? description.memo.encoisBlueprintVersion
            : undefined,
        ...(typeof description.memo?.encoisParentWorkflowId === "string"
          ? { parentWorkflowId: description.memo.encoisParentWorkflowId }
          : {}),
        ...(typeof description.memo?.encoisTrigger === "string"
          ? { trigger: description.memo.encoisTrigger }
          : {}),
        ...(description.closeTime
          ? { completedAt: description.closeTime.toISOString() }
          : {}),
        createdAt: description.startTime?.toISOString() ?? timestamp,
        updatedAt: timestamp,
      };
    },

    async GetResult(workflowId, organizationId) {
      if (!workflowIdBelongsToOrganization(workflowId, organizationId))
        return null;
      const handle = (await getClient()).workflow.getHandle(workflowId);
      return handle.result();
    },

    async list(organizationId, namespace) {
      const temporalClient = await getClient();
      const executions: WorkflowExecutionProjection[] = [];
      for await (const info of temporalClient.workflow.list({
        query: `WorkflowId STARTS_WITH "org:${organizationId}:" OR WorkflowId STARTS_WITH "workflow:${organizationId}:"`,
      })) {
        const resolvedStatus = await resolveTemporalStatus(
          temporalClient.workflow.getHandle(info.workflowId),
          info.status.name,
          info.type,
        );
        executions.push({
          workflowId: info.workflowId,
          runId: info.runId,
          workflowType: info.type,
          namespace,
          taskQueue: info.taskQueue,
          ...resolvedStatus,
          organizationId,
          blueprintId:
            typeof info.memo?.encoisBlueprintId === "string"
              ? info.memo.encoisBlueprintId
              : undefined,
          blueprintVersion:
            typeof info.memo?.encoisBlueprintVersion === "string"
              ? info.memo.encoisBlueprintVersion
              : undefined,
          ...(typeof info.memo?.encoisParentWorkflowId === "string"
            ? { parentWorkflowId: info.memo.encoisParentWorkflowId }
            : {}),
          ...(typeof info.memo?.encoisTrigger === "string"
            ? { trigger: info.memo.encoisTrigger }
            : {}),
          ...(info.closeTime
            ? { completedAt: info.closeTime.toISOString() }
            : {}),
          createdAt: info.startTime.toISOString(),
          updatedAt: (info.closeTime ?? info.startTime).toISOString(),
        });
      }
      return executions;
    },

    async signal(workflowId, organizationId, _namespace, request) {
      if (!workflowIdBelongsToOrganization(workflowId, organizationId))
        throw new Error("workflow not found");
      const temporalClient = await getClient();
      const isControlSignal =
        request.signalName === WorkflowSignalName.WorkflowPause ||
        request.signalName === WorkflowSignalName.WorkflowResume;
      await temporalClient.workflow
        .getHandle(workflowId)
        .signal(
          isControlSignal ? "workflow-control" : request.signalName,
          isControlSignal
            ? { ...request.payload, action: request.signalName }
            : request.payload,
        );
    },

    async signalCoordinator(coordinatorId, organizationId, _namespace, event) {
      if (
        !organizationId ||
        !coordinatorId ||
        event.organizationId !== organizationId ||
        event.coordinatorId !== coordinatorId
      ) {
        throw new Error("Coordinator event scope does not match the target");
      }
      const temporalClient = await getClient();
      const workflowId = buildCoordinatorWorkflowId(
        organizationId,
        coordinatorId,
      );
      await temporalClient.workflow
        .getHandle(workflowId)
        .signal(CoordinatorSignalName.Event, event);
    },

    async getCoordinatorState(coordinatorId, organizationId) {
      if (!organizationId || !coordinatorId) return null;
      try {
        return await withTimeout(
          (async () => {
            const temporalClient = await getClient();
            const workflowId = buildCoordinatorWorkflowId(
              organizationId,
              coordinatorId,
            );
            const handle = temporalClient.workflow.getHandle(workflowId);
            await handle.describe();
            return await handle.query<CoordinatorState>("coordinator-state");
          })(),
          coordinatorStateTimeoutMs,
          null,
        );
      } catch {
        // Readiness remains driven by the persisted onboarding record when the
        // Coordinator is not available or an older worker has no query.
        return null;
      }
    },

    async update(workflowId, organizationId, _namespace, request) {
      if (!workflowIdBelongsToOrganization(workflowId, organizationId))
        throw new Error("workflow not found");
      const temporalClient = await getClient();
      await temporalClient.workflow
        .getHandle(workflowId)
        .executeUpdate(request.updateName, {
          args: [{ updateId: request.updateId, ...request.payload }],
          updateId: request.updateId,
        });
    },

    async cancel(workflowId, organizationId) {
      if (!workflowIdBelongsToOrganization(workflowId, organizationId))
        throw new Error("workflow not found");
      const handle = (await getClient()).workflow.getHandle(workflowId);
      const description = await handle.describe();
      const status = temporalStatus(description.status.name);
      if (status === WorkflowExecutionStatus.Cancelled) return;
      if (!["queued", "running", "waiting", "paused"].includes(status)) {
        throw new Error(`workflow is ${status} and cannot be cancelled`);
      }
      await handle.cancel();
    },

    async terminate(workflowId, organizationId) {
      if (!workflowIdBelongsToOrganization(workflowId, organizationId))
        throw new Error("workflow not found");
      try {
        const terminated = await withTimeout(
          (async () => {
            const handle = (await getClient()).workflow.getHandle(workflowId);
            const description = await handle.describe();
            if (description.status.name !== "RUNNING") return true;
            await handle.terminate(
              "Replaced by an organization onboarding retry.",
            );
            return true;
          })(),
          coordinatorControlTimeoutMs,
          false,
        );
        if (!terminated)
          throw new Error("Temporal Coordinator termination timed out.");
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) return;
        throw error;
      }
    },
  };
}

export function createWorkflowClient(config: AppConfig): WorkflowClient {
  if (!config.temporalAddress) {
    throw new Error(
      "TEMPORAL_ADDRESS is required; the API cannot start without a real Temporal workflow backend.",
    );
  }

  return createTemporalWorkflowClient({
    address: config.temporalAddress,
    apiKey: config.temporalApiKey,
    tlsClientCertPath: config.temporalTlsClientCertPath,
    tlsClientKeyPath: config.temporalTlsClientKeyPath,
    defaultNamespace: config.temporalNamespace,
  });
}

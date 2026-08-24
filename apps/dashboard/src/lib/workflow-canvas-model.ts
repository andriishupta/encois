import type {
  WorkflowEventProjection,
  WorkflowExecutionStatus,
} from "@encois/contracts";

export type WorkflowNodeStatus =
  | "completed"
  | "running"
  | "pending"
  | "waiting"
  | "paused"
  | "partial"
  | "failed"
  | "cancelled";

export type WorkflowCanvasStage = {
  id: string;
  label: string;
  description: string;
  status: WorkflowNodeStatus;
  icon: "evidence" | "synthesis";
};

export function normalizeWorkflowNodeStatus(
  value: string | undefined,
  fallback: WorkflowNodeStatus,
): WorkflowNodeStatus {
  const status = value?.toLowerCase().trim();
  if (!status) return fallback;
  if (status.includes("fail") || status.includes("error")) return "failed";
  if (status.includes("partial")) return "partial";
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("pause")) return "paused";
  if (status.includes("wait")) return "waiting";
  if (status.includes("run") || status.includes("start")) return "running";
  if (status.includes("queue") || status.includes("pending")) return "pending";
  if (
    status.includes("complete") ||
    status.includes("success") ||
    status.includes("succeed")
  )
    return "completed";
  return fallback;
}

function fallbackWorkflowNodeStatus(
  runStatus: WorkflowExecutionStatus | undefined,
): WorkflowNodeStatus {
  switch (runStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "partial":
      return "partial";
    case "waiting":
      return "waiting";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "queued":
      return "pending";
    default:
      return "running";
  }
}

export function getWorkflowCanvasStages(
  events: readonly WorkflowEventProjection[],
  runStatus?: WorkflowExecutionStatus,
): readonly WorkflowCanvasStage[] {
  const activityEvents = events.filter((event) => event.activityName);
  const uniqueActivities = [
    ...new Map(
      activityEvents.map((event) => [event.activityName as string, event]),
    ).values(),
  ];
  if (!uniqueActivities.length) {
    return [
      {
        id: "activity-0",
        label: "Awaiting activity data",
        description: "The run has not emitted step events yet",
        status: runStatus ? fallbackWorkflowNodeStatus(runStatus) : "pending",
        icon: "evidence",
      },
    ];
  }

  return uniqueActivities.map((event, index) => ({
    id: `activity-${index}`,
    label: event.activityName as string,
    description:
      typeof event.metadata.provider === "string"
        ? event.metadata.provider
        : "Activity event",
    status: normalizeWorkflowNodeStatus(
      event.status,
      index === uniqueActivities.length - 1
        ? fallbackWorkflowNodeStatus(runStatus)
        : "completed",
    ),
    icon: index === uniqueActivities.length - 1 ? "synthesis" : "evidence",
  }));
}

import type {
  WorkflowExecutionStatus,
  WorkflowStatusReason,
} from "@encois/contracts";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  LoaderCircle,
  type LucideIcon,
  PauseCircle,
  XCircle,
} from "lucide-react";
import { workflowStatusLabel } from "@/lib/formatters";

export type WorkflowVisualStatus = WorkflowExecutionStatus | "pending";

type StatusVisual = {
  icon: LucideIcon;
  tone: string;
  animate?: boolean;
};

const statusVisuals: Record<WorkflowVisualStatus, StatusVisual> = {
  queued: { icon: CircleDashed, tone: "text-muted-foreground" },
  pending: { icon: CircleDashed, tone: "text-muted-foreground" },
  running: { icon: LoaderCircle, tone: "text-primary", animate: true },
  waiting: { icon: Clock3, tone: "text-amber-700 dark:text-amber-400" },
  paused: { icon: PauseCircle, tone: "text-amber-700 dark:text-amber-400" },
  partial: { icon: CircleAlert, tone: "text-orange-700 dark:text-orange-400" },
  failed: { icon: AlertTriangle, tone: "text-destructive" },
  completed: {
    icon: CheckCircle2,
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  cancelled: { icon: XCircle, tone: "text-muted-foreground" },
};

const pendingLabel = "Pending";

export function WorkflowStatusIndicator({
  status,
  reason,
  compact = false,
  testId,
}: {
  status: WorkflowVisualStatus;
  reason?: WorkflowStatusReason;
  compact?: boolean;
  testId?: string;
}) {
  const visual = statusVisuals[status];
  const Icon = visual.icon;
  const label =
    status === "pending" ? pendingLabel : workflowStatusLabel(status, reason);

  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 font-medium ${compact ? "text-xs" : "text-sm"} ${visual.tone}`}
      role="status"
      aria-label={label}
      title={label}
    >
      <Icon
        className={`size-3.5 shrink-0 ${visual.animate ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}

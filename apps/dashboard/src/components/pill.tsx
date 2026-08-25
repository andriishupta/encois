import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  type LucideIcon,
} from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PillTone = "description" | "status" | "muted" | "scope";

type PillProps = Omit<
  ComponentPropsWithoutRef<"span">,
  "children" | "className"
> & {
  children: ReactNode;
  tone?: PillTone;
  icon?: LucideIcon;
  className?: string;
};

const toneClassNames: Record<PillTone, string> = {
  description: "border-border bg-background text-foreground",
  status: "border-border bg-background text-foreground",
  muted: "border-muted bg-muted text-muted-foreground",
  scope: "border-primary bg-primary text-primary-foreground",
};

export function Pill({
  children,
  tone = "description",
  icon: Icon,
  className,
  ...props
}: PillProps) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs leading-none",
        toneClassNames[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function DescriptionPill({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Pill tone="description" className={className}>
      {children}
    </Pill>
  );
}

const mutedStatuses = new Set([
  "coming soon",
  "delete",
  "deletion",
  "deleted",
  "degraded",
  "disabled",
  "draft",
  "error",
  "failed",
  "invited",
  "needs reauth",
  "needs_reauth",
  "not ready",
  "pending",
  "proposed",
  "rejected",
  "expired",
  "retired",
  "suspended",
  "missing",
]);

function statusIcon(status: string): LucideIcon {
  const normalized = status.trim().toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "invited" ||
    normalized === "proposed" ||
    normalized === "awaiting approval"
  ) {
    return Clock3;
  }
  if (normalized === "missing" || normalized === "not ready") {
    return AlertCircle;
  }
  if (
    normalized === "active" ||
    normalized === "approved" ||
    normalized === "available" ||
    normalized === "authorized" ||
    normalized === "completed" ||
    normalized === "ready" ||
    normalized === "ready to apply" ||
    normalized === "applied" ||
    normalized === "resolved"
  ) {
    return CheckCircle2;
  }
  if (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "degraded" ||
    normalized === "needs reauth" ||
    normalized === "needs_reauth"
  ) {
    return AlertCircle;
  }
  return CircleDashed;
}

export function StatusPill({
  status,
  label,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"span">, "children" | "className"> & {
  status: string;
  label?: ReactNode;
  className?: string;
}) {
  const normalized = status.trim().toLowerCase();
  return (
    <Pill
      tone={mutedStatuses.has(normalized) ? "muted" : "status"}
      icon={statusIcon(status)}
      className={className}
      {...props}
    >
      {label ?? status}
    </Pill>
  );
}

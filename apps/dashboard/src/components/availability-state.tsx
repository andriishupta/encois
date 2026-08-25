import type { ReactNode } from "react";
import { StatusPill } from "@/components/pill";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const unavailableCardClassName =
  "cursor-help border-muted bg-card opacity-[0.75] shadow-xs";

export function AvailabilityBadge({
  label = "Coming Soon",
}: {
  label?: string;
}) {
  return (
    <StatusPill
      status={label}
      label={label}
      className="text-[10px] font-semibold uppercase tracking-wide"
    />
  );
}

export function AvailabilityCard({
  label = "Coming Soon",
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      aria-disabled="true"
      title={label}
      className={cn(unavailableCardClassName, className)}
    >
      {children}
    </Card>
  );
}

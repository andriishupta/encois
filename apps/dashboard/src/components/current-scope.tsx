import { Pill } from "@/components/pill";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatUnitPath, type OrganizationUnit } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { cn } from "@/lib/utils";

export type CurrentScopeValue = {
  unit?: OrganizationUnit;
  name: string;
  path: string;
};

export type ScopeIndicatorProps = {
  /** The short label shown before the scoped value, for example Read or Visible. */
  label?: string;
  /** The scope value. Pills display its final path segment. */
  name: string;
  /** The complete scope path shown in the tooltip. Defaults to name. */
  path?: string;
  className?: string;
};

function getScopeLeafName(value: string): string {
  return value
    .split(/\s*,\s*/u)
    .map((scope) => {
      const segments = scope
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
      return segments.at(-1) ?? scope.trim();
    })
    .filter(Boolean)
    .join(", ");
}

export function useCurrentScope(): CurrentScopeValue {
  const { organizationName, units, currentUnitId } = useOrganization();
  const unit =
    units.find(
      (candidate) => candidate.id === currentUnitId && candidate.canView,
    ) ?? units.find((candidate) => candidate.canView);
  const fallback = organizationName ?? "Organization scope";
  const name =
    unit?.type === "organization"
      ? (organizationName ?? unit.name)
      : (unit?.name ?? fallback);
  const path = unit ? formatUnitPath(units, unit.id) || name : fallback;

  return { unit, name, path };
}

export function ScopeText({
  name,
  path = name,
  className,
}: ScopeIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex cursor-help items-baseline gap-1 rounded-md border border-dashed border-primary/60 px-1.5 py-0.5 text-primary",
              className,
            )}
          >
            <span>{name}</span>
          </span>
        }
      />
      <TooltipContent align="start">Scope: {path}</TooltipContent>
    </Tooltip>
  );
}

export function ScopePill({
  label,
  name,
  path,
  className,
}: ScopeIndicatorProps) {
  const displayName = getScopeLeafName(name);
  const fullPath = path ?? name;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Pill
            tone="scope"
            className={cn("cursor-help", className)}
            aria-label={`${label} scope: ${fullPath}`}
          >
            <span className="truncate">
              {label}: {displayName}
            </span>
          </Pill>
        }
      />
      <TooltipContent align="start">
        {label} scope: {fullPath}
      </TooltipContent>
    </Tooltip>
  );
}

export function CurrentScopeText({ className }: { className?: string }) {
  const scope = useCurrentScope();
  return (
    <ScopeText name={scope.path} path={scope.path} className={className} />
  );
}

export function CurrentScopePill({ className }: { className?: string }) {
  const scope = useCurrentScope();
  return (
    <ScopePill
      label="S"
      name={scope.name}
      path={scope.path}
      className={className}
    />
  );
}

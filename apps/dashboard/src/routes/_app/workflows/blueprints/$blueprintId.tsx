import type {
  WorkflowBlueprintLifecycleRequest,
  WorkflowBlueprintProjection,
} from "@encois/contracts";
import { Permission } from "@encois/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import {
  ArchiveRestore,
  ArrowLeft,
  Check,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createBlueprintLifecyclePlan,
  deleteWorkflowBlueprint,
  listWorkflowBlueprints,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate } from "@/lib/formatters";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/workflows/blueprints/$blueprintId")(
  {
    beforeLoad: () => {
      if (!hasPermission(getAuthSession(), Permission.WorkflowsRead))
        throw redirect({ to: "/forbidden" });
    },
    component: BlueprintRevisionPage,
  },
);

function BlueprintRevisionPage() {
  const { blueprintId } = Route.useParams();
  const navigate = useNavigate();
  const blueprints = useQuery({
    queryKey: queryKeys.workflowBlueprints(),
    queryFn: listWorkflowBlueprints,
  });
  const queryClient = useQueryClient();
  const canManage = useCan(Permission.WorkflowsManage);
  const [revisionVersion, setRevisionVersion] = useState("");
  const [duplicateName, setDuplicateName] = useState("");
  const [reason, setReason] = useState("");
  const [lifecycleSuccess, setLifecycleSuccess] = useState("");
  const lifecycle = useMutation({
    mutationFn: (
      input: Omit<WorkflowBlueprintLifecycleRequest, "contractVersion">,
    ) => createBlueprintLifecyclePlan(blueprintId, input),
    onSuccess: (plan) => {
      setLifecycleSuccess(
        `Proposal ${plan.planId} is awaiting approval in Activity.`,
      );
      setReason("");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowBlueprintsRoot(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowPlansRoot(),
      });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteWorkflowBlueprint(blueprintId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflowBlueprintsRoot(),
      });
      await navigate({ to: "/workflows/blueprints" });
    },
  });
  const versions = (
    blueprints.data?.filter(
      (blueprint) => blueprint.blueprintId === blueprintId,
    ) ?? []
  ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const [compareVersion, setCompareVersion] = useState<string>();
  const selected =
    versions.find(
      (version) =>
        version.version === (selectedVersion ?? versions[0]?.version),
    ) ?? versions[0];
  const comparison = versions.find(
    (version) => version.version === (compareVersion ?? versions[1]?.version),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={selected?.name ?? "Blueprint revisions"}
        description="Review immutable Blueprint versions and inspect what changed before using a revision for a new Run."
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink to="/workflows/blueprints">
              <ArrowLeft data-icon="inline-start" />
              Back to Blueprints
            </ButtonLink>
            {canManage && selected ? (
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this Blueprint? Its historical Workflow Runs will remain available, but all Blueprint revisions will be hidden.",
                    )
                  )
                    remove.mutate();
                }}
              >
                <Trash2 data-icon="inline-start" />
                {remove.isPending ? "Deleting…" : "Delete Blueprint"}
              </Button>
            ) : null}
          </div>
        }
      />
      {remove.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not delete this Blueprint: {remove.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {blueprints.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading revision history…
        </p>
      ) : null}
      {blueprints.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not load revisions: {blueprints.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {!blueprints.isLoading && !blueprints.isError && versions.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={GitBranch}
              title="Blueprint not found"
              description="This Blueprint is not available in the current organization or scope."
            />
          </CardContent>
        </Card>
      ) : null}
      {selected ? (
        <>
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Revision timeline</CardTitle>
                <CardDescription>
                  Each revision is an immutable execution snapshot.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {versions.map((version) => (
                  <button
                    key={version.version}
                    type="button"
                    onClick={() => setSelectedVersion(version.version)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent ${version.version === selected.version ? "border-foreground/40 bg-accent/50" : ""}`}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <GitBranch
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        v{version.version}
                        {version.isCurrent ? " · current" : ""}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {version.status} · {formatDate(version.updatedAt)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {version.steps?.length ?? 0} steps
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Compare revisions</CardTitle>
                <CardDescription>
                  Differences are computed from the stored Blueprint snapshots.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label
                    className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
                    htmlFor="blueprint-current-revision"
                  >
                    Current revision
                    <Select
                      id="blueprint-current-revision"
                      value={selected.version}
                      onChange={(event) =>
                        setSelectedVersion(event.target.value)
                      }
                      options={versions.map((version) => ({
                        value: version.version,
                        label: `v${version.version}`,
                      }))}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
                    htmlFor="blueprint-compare-revision"
                  >
                    Compare with
                    <Select
                      id="blueprint-compare-revision"
                      value={comparison?.version ?? ""}
                      onChange={(event) =>
                        setCompareVersion(event.target.value)
                      }
                      options={[
                        { value: "", label: "No comparison" },
                        ...versions
                          .filter(
                            (version) => version.version !== selected.version,
                          )
                          .map((version) => ({
                            value: version.version,
                            label: `v${version.version}`,
                          })),
                      ]}
                    />
                  </label>
                </div>
                {comparison ? (
                  <BlueprintDiff current={selected} previous={comparison} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select another revision to see changed metadata, steps,
                    tools, and agents.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Revision details</CardTitle>
              <CardDescription>{selected.purpose}</CardDescription>
            </CardHeader>
            <CardContent className="grid min-w-0 gap-3 text-sm sm:grid-cols-3">
              <Detail label="Status" value={selected.status} />
              <Detail
                label="Current"
                value={
                  selected.isCurrent
                    ? "Yes — used by new workflow creation"
                    : "No"
                }
              />
              <Detail
                label="Steps"
                value={String(selected.steps?.length ?? 0)}
              />
              <Detail label="Updated" value={formatDate(selected.updatedAt)} />
              <Detail
                label="Approval"
                value={selected.requiresApproval ? "Required" : "Not required"}
              />
              <Detail
                label="Required scope"
                value={
                  selected.requiredScopes?.length
                    ? selected.requiredScopes.join(", ")
                    : "Organization scope"
                }
              />
              <Detail
                label="Source plan"
                value={selected.sourcePlanId ?? "Not recorded"}
              />
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Blueprint lifecycle</CardTitle>
              <CardDescription>
                Propose an immutable revision change. The registry changes only
                after a separate approval and apply step.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!canManage ? (
                <p className="text-sm text-muted-foreground">
                  Read-only access. A user with workflow management permission
                  must submit lifecycle proposals.
                </p>
              ) : selected.status === "retired" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    This revision is archived and cannot be used to create new
                    Workflows until it is restored through the approval
                    boundary.
                  </p>
                  <label
                    className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
                    htmlFor="blueprint-restore-reason"
                  >
                    Reason for restore
                    <Textarea
                      id="blueprint-restore-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={3}
                      placeholder="Explain why this archived revision should be available again…"
                      className="text-foreground"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={lifecycle.isPending || reason.trim().length < 3}
                      onClick={() => {
                        setLifecycleSuccess("");
                        lifecycle.mutate({
                          action: "restore",
                          sourceVersion: selected.version,
                          reason,
                        });
                      }}
                    >
                      <ArchiveRestore data-icon="inline-start" />
                      Propose restore
                    </Button>
                  </div>
                </>
              ) : selected.status !== "approved" ? (
                <p className="text-sm text-muted-foreground">
                  Draft revisions are not executable until approved.
                </p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label
                      className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
                      htmlFor="blueprint-revision-version"
                    >
                      New revision version
                      <input
                        id="blueprint-revision-version"
                        value={revisionVersion}
                        onChange={(event) =>
                          setRevisionVersion(event.target.value)
                        }
                        placeholder={nextRevisionVersion(selected.version)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground"
                      />
                    </label>
                    <label
                      className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
                      htmlFor="blueprint-duplicate-name"
                    >
                      Duplicate name{" "}
                      <span className="font-normal">(optional)</span>
                      <input
                        id="blueprint-duplicate-name"
                        value={duplicateName}
                        onChange={(event) =>
                          setDuplicateName(event.target.value)
                        }
                        placeholder={`${selected.name} copy`}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground"
                      />
                    </label>
                  </div>
                  <label
                    className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
                    htmlFor="blueprint-change-reason"
                  >
                    Reason for change
                    <Textarea
                      id="blueprint-change-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={3}
                      placeholder="Explain the product or operational reason for this proposal…"
                      className="text-foreground"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={lifecycle.isPending || reason.trim().length < 3}
                      onClick={() => {
                        setLifecycleSuccess("");
                        lifecycle.mutate({
                          action: "create_revision",
                          sourceVersion: selected.version,
                          version:
                            revisionVersion.trim() ||
                            nextRevisionVersion(selected.version),
                          reason,
                        });
                      }}
                    >
                      Propose new revision
                    </Button>
                    <Button
                      variant="outline"
                      disabled={lifecycle.isPending || reason.trim().length < 3}
                      onClick={() => {
                        setLifecycleSuccess("");
                        lifecycle.mutate({
                          action: "duplicate",
                          sourceVersion: selected.version,
                          version:
                            revisionVersion.trim() ||
                            nextRevisionVersion(selected.version),
                          ...(duplicateName.trim()
                            ? { name: duplicateName.trim() }
                            : {}),
                          reason,
                        });
                      }}
                    >
                      Duplicate Blueprint
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        lifecycle.isPending ||
                        selected.isCurrent ||
                        reason.trim().length < 3
                      }
                      title={
                        selected.isCurrent
                          ? "Mark another revision current first"
                          : undefined
                      }
                      onClick={() => {
                        setLifecycleSuccess("");
                        lifecycle.mutate({
                          action: "mark_current",
                          sourceVersion: selected.version,
                          reason,
                        });
                      }}
                    >
                      {selected.isCurrent ? (
                        <Check data-icon="inline-start" />
                      ) : null}
                      {selected.isCurrent
                        ? "Current revision"
                        : "Propose as current"}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={
                        lifecycle.isPending ||
                        selected.isCurrent ||
                        reason.trim().length < 3
                      }
                      title={
                        selected.isCurrent
                          ? "Mark another revision current first"
                          : undefined
                      }
                      onClick={() => {
                        setLifecycleSuccess("");
                        lifecycle.mutate({
                          action: "deprecate",
                          sourceVersion: selected.version,
                          reason,
                        });
                      }}
                    >
                      Propose deprecation
                    </Button>
                  </div>
                  {lifecycle.isPending ? (
                    <p className="text-sm text-muted-foreground">
                      Submitting proposal…
                    </p>
                  ) : null}
                  {lifecycle.isError ? (
                    <p className="text-sm text-destructive">
                      Could not submit proposal: {lifecycle.error.message}
                    </p>
                  ) : null}
                  {lifecycleSuccess ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">
                      {lifecycleSuccess}{" "}
                      <Link
                        className="font-medium underline underline-offset-4"
                        to="/workflows/plans"
                      >
                        Open Plans
                      </Link>
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function nextRevisionVersion(version: string): string {
  const parts = version.split(".").map(Number);
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isInteger(part) || part < 0)
  )
    return "";
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function BlueprintDiff({
  current,
  previous,
}: {
  current: WorkflowBlueprintProjection;
  previous: WorkflowBlueprintProjection;
}) {
  const metadataChanges = [
    current.name !== previous.name
      ? `Name: ${previous.name} → ${current.name}`
      : null,
    current.purpose !== previous.purpose ? "Purpose changed" : null,
    current.requiresApproval !== previous.requiresApproval
      ? "Approval policy changed"
      : null,
  ].filter((change): change is string => Boolean(change));
  const previousById = new Map(previous.steps.map((step) => [step.id, step]));
  const currentById = new Map(current.steps.map((step) => [step.id, step]));
  const stepIds = [
    ...new Set([
      ...previous.steps.map((step) => step.id),
      ...current.steps.map((step) => step.id),
    ]),
  ];
  const stepChanges = stepIds.flatMap(
    (
      stepId,
    ): Array<{
      kind: "added" | "removed" | "changed";
      step: WorkflowBlueprintProjection["steps"][number];
    }> => {
      const before = previousById.get(stepId);
      const after = currentById.get(stepId);
      if (!before && after) return [{ kind: "added" as const, step: after }];
      if (before && !after) return [{ kind: "removed" as const, step: before }];
      if (before && after && JSON.stringify(before) !== JSON.stringify(after))
        return [{ kind: "changed" as const, step: after }];
      return [];
    },
  );
  if (metadataChanges.length === 0 && stepChanges.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No changes between these revisions.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {metadataChanges.map((change) => (
          <span
            key={change}
            className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground"
          >
            {change}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {stepChanges.map((change) => (
          <div
            key={`${change.kind}:${change.step.id}`}
            className="flex items-center gap-2 rounded-md border p-2 text-sm"
          >
            <ChangeIcon kind={change.kind} />
            <span className="font-medium">{change.step.id}</span>
            <span className="text-xs text-muted-foreground">
              {change.kind} · {change.step.kind}
              {"tool" in change.step && change.step.tool
                ? ` · ${change.step.tool}`
                : ""}
              {"agentDefinition" in change.step && change.step.agentDefinition
                ? ` · ${change.step.agentDefinition}`
                : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangeIcon({ kind }: { kind: "added" | "removed" | "changed" }) {
  if (kind === "added")
    return <Plus className="size-4 text-emerald-600" aria-label="Added" />;
  if (kind === "removed")
    return <Minus className="size-4 text-destructive" aria-label="Removed" />;
  return <RefreshCw className="size-4 text-amber-600" aria-label="Changed" />;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

function ButtonLink({
  to,
  children,
}: {
  to: "/workflows/blueprints";
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </Link>
  );
}

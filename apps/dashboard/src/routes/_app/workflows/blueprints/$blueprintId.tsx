import type { WorkflowBlueprintProjection } from "@encois/contracts/browser";
import { Permission } from "@encois/contracts/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import {
  ArrowLeft,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { PageHeader } from "@/components/page-header";
import { DescriptionPill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { deleteWorkflowBlueprint, listWorkflowBlueprints } from "@/lib/api";
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
  const queryClient = useQueryClient();
  const canManage = useCan(Permission.WorkflowsManage);
  const blueprints = useQuery({
    queryKey: queryKeys.workflowBlueprints(),
    queryFn: () => listWorkflowBlueprints(),
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
  const remove = useMutation({
    mutationFn: () =>
      selected
        ? deleteWorkflowBlueprint(blueprintId, selected.version)
        : Promise.resolve(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflowBlueprintsRoot(),
      });
      await navigate({ to: "/workflows/blueprints" });
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={selected?.name ?? "Blueprint revisions"}
        description="Review stored Blueprint versions and compare their immutable snapshots."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/workflows/blueprints">
                <ArrowLeft data-icon="inline-start" />
                Back to Blueprints
              </Link>
            </Button>
            {selected?.status === "approved" && selected.isCurrent ? (
              <Button variant="outline" asChild>
                <Link
                  to="/workflows/new"
                  search={{ blueprint: selected.blueprintId }}
                >
                  Use Blueprint
                </Link>
              </Button>
            ) : null}
            {canManage && selected ? (
              <Button
                variant="destructive"
                disabled={remove.isPending || selected.isCurrent}
                title={
                  selected.isCurrent
                    ? "The current revision cannot be deleted"
                    : undefined
                }
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete Blueprint revision v${selected.version}? Its historical Workflow Runs will remain available.`,
                    )
                  )
                    remove.mutate();
                }}
              >
                <Trash2 data-icon="inline-start" />
                {remove.isPending ? "Deleting…" : "Delete revision"}
              </Button>
            ) : null}
          </div>
        }
      />
      {remove.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not delete this Blueprint revision: {remove.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {blueprints.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading Blueprint revisions…
        </p>
      ) : null}
      {blueprints.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not load Blueprint revisions: {blueprints.error.message}
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
          <Card>
            <CardHeader>
              <CardTitle>Revision history</CardTitle>
              <CardDescription>
                Blueprint revisions are stored snapshots. Future revisions can
                be added as new immutable versions.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {versions.map((version) => (
                <Link
                  key={version.version}
                  to="/workflows/blueprints/$blueprintId"
                  params={{ blueprintId }}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${version.version === selected.version ? "border-foreground bg-accent/40" : ""}`}
                >
                  <span className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-medium">
                    v{version.version.split(".").at(-1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      v{version.version} · {version.status}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Updated {formatDate(version.updatedAt)} ·{" "}
                      {version.steps?.length ?? 0} steps
                    </span>
                  </span>
                  {version.isCurrent ? (
                    <DescriptionPill>Current</DescriptionPill>
                  ) : null}
                </Link>
              ))}
            </CardContent>
          </Card>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Revision details</CardTitle>
                <CardDescription>{selected.purpose}</CardDescription>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                <Detail label="Status" value={selected.status} />
                <Detail
                  label="Current"
                  value={
                    selected.isCurrent
                      ? "Yes — used by new workflow creation"
                      : "No"
                  }
                />
                <Detail label="Version" value={selected.version} />
                <Detail
                  label="Updated"
                  value={formatDate(selected.updatedAt)}
                />
                <Detail
                  label="Steps"
                  value={String(selected.steps?.length ?? 0)}
                />
                <Detail
                  label="Required scope"
                  value={
                    selected.requiredScopes?.length
                      ? selected.requiredScopes.join(", ")
                      : "Organization scope"
                  }
                />
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Compare revisions</CardTitle>
                <CardDescription>
                  Differences are computed from stored Blueprint snapshots.
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
        </>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
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
  const changes = [
    ...new Set([...previousById.keys(), ...currentById.keys()]),
  ].flatMap((stepId) => {
    const before = previousById.get(stepId);
    const after = currentById.get(stepId);
    if (!before && after) return [{ kind: "added", step: after }];
    if (before && !after) return [{ kind: "removed", step: before }];
    if (before && after && JSON.stringify(before) !== JSON.stringify(after))
      return [{ kind: "changed", step: after }];
    return [];
  });
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap gap-1.5">
        <DescriptionPill>Compared with v{previous.version}</DescriptionPill>
        <DescriptionPill>{current.steps.length} steps</DescriptionPill>
      </div>
      {metadataChanges.length ? (
        <ul className="flex flex-col gap-1">
          {metadataChanges.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No metadata changes.</p>
      )}
      {changes.length ? (
        <div className="flex flex-col gap-1">
          {changes.map((item) => (
            <div
              key={`${item.kind}:${item.step.id}`}
              className="flex items-center gap-2"
            >
              <span
                className={
                  item.kind === "added"
                    ? "text-emerald-700"
                    : item.kind === "removed"
                      ? "text-destructive"
                      : "text-amber-700"
                }
              >
                {item.kind === "added" ? (
                  <Plus className="inline size-3" />
                ) : item.kind === "removed" ? (
                  <Minus className="inline size-3" />
                ) : (
                  <RefreshCw className="inline size-3" />
                )}
              </span>
              <span className="font-medium">{item.step.id}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No step-level changes.</p>
      )}
    </div>
  );
}

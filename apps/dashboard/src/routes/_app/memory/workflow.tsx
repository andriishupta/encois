import { Permission } from "@encois/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import {
  BrainCircuit,
  CircleAlert,
  FilePlus2,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { OrganizationUnitSelect } from "@/components/organization-unit-select";
import {
  ListFilter,
  ListResultsHeader,
  ListSearch,
  ListToolbar,
} from "@/components/list-controls";
import { PageHeader } from "@/components/page-header";
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  applyMemoryChange,
  approveMemoryChange,
  createMemoryChange,
  isApiError,
  listMemoryChanges,
  queryAgentMemory,
  rejectMemoryChange,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate, humanizeKey } from "@/lib/formatters";
import { formatUnitPath } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/memory/workflow")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.MemoryRead))
      throw redirect({ to: "/forbidden" });
  },
  component: MemoryRoute,
});

const agentDefinitions = [
  "context.synthesizer@1",
  "release-investigation.synthesizer@1",
  "source-ingestion",
] as const;

function MemoryRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return pathname !== "/memory/workflow" ? <Outlet /> : <MemoryPage />;
}

function MemoryPage() {
  const { units } = useOrganization();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canManageMemory = can(Permission.MemoryManage);
  const [agentDefinition, setAgentDefinition] = useState("all");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const selectedScope = scope === "all" ? undefined : { ids: [scope] };
  const memory = useQuery({
    queryKey: queryKeys.agentMemory(agentDefinition, query, scope),
    queryFn: () =>
      queryAgentMemory({
        ...(agentDefinition !== "all" ? { agentDefinition } : {}),
        query,
        maxResults: 20,
        ...(selectedScope ? { scope: selectedScope } : {}),
      }),
  });
  const changes = useQuery({
    queryKey: queryKeys.memoryChanges(),
    queryFn: () => listMemoryChanges(),
    enabled: canManageMemory,
    refetchInterval: 15_000,
  });
  const [changeError, setChangeError] = useState<string | null>(null);
  const requestChange = useMutation({
    mutationFn: createMemoryChange,
    onSuccess: () => {
      setChangeError(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryChanges(),
      });
    },
    onError: (error) => setChangeError(error.message),
  });
  const memoryAction = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "approve" | "reject" | "apply";
    }) =>
      action === "approve"
        ? approveMemoryChange(id)
        : action === "reject"
          ? rejectMemoryChange(id)
          : applyMemoryChange(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.memoryChanges(),
      });
    },
  });
  const scopeLabel =
    scope === "all"
      ? "All available units"
      : formatUnitPath(units, scope) || scope;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Workflow memory"
        description={
          <>
            Review scoped distilled context available to authorized workflows.
            Leave search empty to show all available memories; search narrows
            the results. Changes are proposed, approved, audited, and applied
            through the runtime to{" "}
            <ProductTerm term="memoryBank" />.
          </>
        }
        actions={
          <>
            <Button asChild>
              <Link to="/memory/workflow/add">
                <FilePlus2 data-icon="inline-start" />
                Add Workflow memory
              </Link>
            </Button>
            <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Restricted surface
            </span>
          </>
        }
      />
      <div className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm">
        <BrainCircuit
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">
            Scoped memory boundary.
          </span>{" "}
          The dashboard can inspect only the selected agent definitions and
          organization scope. It never mutates provider memory directly;
          authorized managers create an auditable change proposal.
        </p>
      </div>
      <ListToolbar>
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search workflow memory…"
          label="Search workflow memory"
        />
        <ListFilter
          value={agentDefinition}
          onChange={setAgentDefinition}
          label="Filter by agent definition"
          options={[
            { value: "all", label: "All agent definitions" },
            ...agentDefinitions.map((definition) => ({
              value: definition,
              label: definition,
            })),
          ]}
        />
        <OrganizationUnitSelect
          id="workflow-memory-scope-filter"
          label="Organization scope"
          value={scope === "all" ? "" : scope}
          units={units}
          filter={(unit) => unit.canView}
          onChange={(value) => setScope(value || "all")}
          description="All available units when no unit is selected."
        />
      </ListToolbar>
      <ListResultsHeader
        count={memory.data?.memories?.length ?? 0}
        label="visible memory records"
      />
      <Card>
        <CardHeader>
          <CardTitle>Memory results</CardTitle>
          <CardDescription>
            Results are restricted to the selected agent definitions and
            authorized organization scope.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {memory.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Retrieving scoped memory…
            </p>
          ) : null}
          {memory.isError ? (
            <EmptyPanel
              icon={CircleAlert}
              title={
                isApiError(memory.error) &&
                memory.error.code === "MEMORY_UNAVAILABLE"
                  ? "Memory unavailable"
                  : "Memory search failed"
              }
              description={memory.error.message}
            />
          ) : null}
          {memory.data ? (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <MemoryMeta
                label="Agent"
                value={humanizeKey(
                  memory.data.agentDefinition.replace(/\./gu, " "),
                )}
              />
              <MemoryMeta label="Scope" value={scopeLabel} />
              <MemoryMeta
                label="Matches"
                value={String(memory.data.memories?.length ?? 0)}
              />
              <MemoryMeta
                label="Generated"
                value={formatDate(memory.data.generatedAt)}
              />
            </div>
          ) : null}
          {memory.data && memory.data.memories?.length === 0 ? (
            <EmptyPanel
              icon={BrainCircuit}
              title="No memories found"
              description="No memory matches the current filters and organization scope."
            />
          ) : null}
          {changeError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Could not submit the memory change: {changeError}
            </p>
          ) : null}
          {memory.data && memory.data.memories?.length > 0 ? (
            <div className="grid gap-3">
              {memory.data.memories.map((record) => (
                <MemoryRecordCard
                  key={record.id}
                  record={record}
                  scopeLabel={scopeLabel}
                  status={memory.data?.status ?? "completed"}
                  canManage={canManageMemory}
                  busy={requestChange.isPending}
                  onRequest={(input) =>
                    requestChange.mutate({
                      ...input,
                      scope: memory.data?.scope ?? selectedScope ?? { ids: [] },
                    })
                  }
                />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
      {canManageMemory ? (
        <Card>
          <CardHeader>
            <CardTitle>Memory governance</CardTitle>
            <CardDescription>
              Pending and completed add, correction, or deletion proposals for
              the current organization.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {memoryAction.isError ? (
              <p role="alert" className="text-sm text-destructive">
                Could not update memory governance: {memoryAction.error.message}
              </p>
            ) : null}
            {changes.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading memory changes…
              </p>
            ) : changes.isError ? (
              <p role="alert" className="text-sm text-destructive">
                Could not load memory changes: {changes.error.message}
              </p>
            ) : changes.data?.length ? (
              changes.data.map((change) => (
                <div
                  key={change.id}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {change.action === "add"
                        ? "Addition"
                        : change.action === "correct"
                          ? "Correction"
                          : "Deletion"}{" "}
                      ·{" "}
                      {humanizeKey(change.agentDefinition.replace(/\./gu, " "))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {humanizeKey(change.status)} ·{" "}
                      {formatDate(change.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-xs text-muted-foreground">
                      {change.status === "applied"
                        ? "Provider updated"
                        : change.status === "rejected"
                          ? "Rejected"
                          : change.status === "approved"
                            ? "Approved · ready to apply"
                            : "Awaiting approval"}
                    </span>
                    {change.status === "proposed" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={memoryAction.isPending}
                          onClick={() =>
                            memoryAction.mutate({
                              id: change.id,
                              action: "reject",
                            })
                          }
                        >
                          Reject
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={memoryAction.isPending}
                          onClick={() =>
                            memoryAction.mutate({
                              id: change.id,
                              action: "approve",
                            })
                          }
                        >
                          Approve
                        </Button>
                      </>
                    ) : change.status === "approved" ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={memoryAction.isPending}
                        onClick={() =>
                          memoryAction.mutate({
                            id: change.id,
                            action: "apply",
                          })
                        }
                      >
                        Apply
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No memory change proposals yet.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MemoryMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

function MemoryRecordCard({
  record,
  scopeLabel,
  status,
  canManage,
  busy,
  onRequest,
}: {
  record: import("@encois/contracts").AgentMemoryRecord;
  scopeLabel: string;
  status: string;
  canManage: boolean;
  busy: boolean;
  onRequest: (input: {
    memoryId: string;
    agentDefinition: string;
    projectId?: string;
    userId?: string;
    action: "correct" | "delete";
    replacementSummary?: string;
  }) => void;
}) {
  const [replacementSummary, setReplacementSummary] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const freshness = record.freshness;
  const freshnessValue = freshness
    ? `${humanizeKey(freshness.status)} · ${freshness.source}${freshness.expiresAt ? ` · expires ${formatDate(freshness.expiresAt)}` : ""}`
    : "Not reported";
  const retentionValue = record.retentionUntil
    ? `${record.retentionClass ? humanizeKey(record.retentionClass) : "Retention"} · until ${formatDate(record.retentionUntil)}`
    : record.retentionClass
      ? humanizeKey(record.retentionClass)
      : "Not reported";

  return (
    <article className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {humanizeKey(record.agentDefinition.replace(/\./gu, " "))}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Observed {formatDate(record.observedAt)} · {scopeLabel}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">
          {humanizeKey(status)}
        </span>
      </div>
      <p className="mt-4 text-sm leading-6">{record.summary}</p>
      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Freshness</dt>
          <dd>{freshnessValue}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Retention</dt>
          <dd>{retentionValue}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Ingested</dt>
          <dd>
            {freshness?.ingestedAt
              ? formatDate(freshness.ingestedAt)
              : "Not reported"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Agent linkage</dt>
          <dd>{record.agentDefinition}</dd>
        </div>
        {record.projectId ? (
          <div>
            <dt className="text-muted-foreground">Project scope</dt>
            <dd>{record.projectId}</dd>
          </div>
        ) : null}
      </dl>
      {record.evidenceRefs?.length ? (
        <details className="mt-4 rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">
            Evidence references ({record.evidenceRefs?.length ?? 0})
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {record.evidenceRefs.map((ref) => (
              <code
                key={ref}
                className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {ref}
              </code>
            ))}
          </div>
        </details>
      ) : null}
      <details className="mt-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium">
          Technical identifiers
        </summary>
        <div className="mt-2 flex flex-col gap-1 font-mono text-muted-foreground">
          <span>Memory: {record.id}</span>
          {record.workflowId ? (
            <span>Workflow: {record.workflowId}</span>
          ) : null}
          {record.runId ? <span>Run: {record.runId}</span> : null}
        </div>
      </details>
      {canManage ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setCorrecting((value) => !value)}
          >
            Request correction
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Submit a deletion proposal for this memory?"))
                onRequest({
                  memoryId: record.id,
                  agentDefinition: record.agentDefinition,
                  projectId: record.projectId,
                  userId: record.userId,
                  action: "delete",
                });
            }}
          >
            Request deletion
          </Button>
        </div>
      ) : null}
      {correcting ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
          <div className="text-xs font-medium">
            Replacement fact
            <Textarea
              value={replacementSummary}
              onChange={(event) => setReplacementSummary(event.target.value)}
              className="mt-1"
              aria-label="Replacement fact"
              maxLength={10000}
              placeholder="Write the corrected memory fact…"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !replacementSummary.trim()}
              onClick={() => {
                onRequest({
                  memoryId: record.id,
                  agentDefinition: record.agentDefinition,
                  projectId: record.projectId,
                  userId: record.userId,
                  action: "correct",
                  replacementSummary: replacementSummary.trim(),
                });
                setCorrecting(false);
                setReplacementSummary("");
              }}
            >
              Submit proposal
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setCorrecting(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

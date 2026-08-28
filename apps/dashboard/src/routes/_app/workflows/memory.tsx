import {
  type AgentMemoryRecord,
  type MemoryChangeRecord,
  Permission,
} from "@encois/contracts/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  CircleAlert,
  Copy,
  FilePlus2,
  PencilLine,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import { LinkCardIndicator } from "@/components/link-card";
import {
  ListCollection,
  ListFilter,
  ListResultsHeader,
  ListSearch,
  ListToolbar,
  type ListViewMode,
} from "@/components/list-controls";
import { OrganizationUnitSelect } from "@/components/organization-unit-select";
import { PageHeader } from "@/components/page-header";
import { DescriptionPill, Pill, StatusPill } from "@/components/pill";
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

export const Route = createFileRoute("/_app/workflows/memory")({
  validateSearch: (search: Record<string, unknown>) => ({
    memoryId: typeof search.memoryId === "string" ? search.memoryId : undefined,
  }),
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
  return pathname !== "/workflows/memory" ? <Outlet /> : <MemoryPage />;
}

function MemoryPage() {
  const { units } = useOrganization();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { memoryId } = Route.useSearch();
  const canManageMemory = can(Permission.MemoryManage);
  const [agentDefinition, setAgentDefinition] = useState("all");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [view, setView] = useState<ListViewMode>("grid");
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
    enabled: canManageMemory && !memoryId,
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
    scope === "all" ? undefined : formatUnitPath(units, scope) || scope;
  const selectedMemory = memory.data?.memories.find(
    (record) => record.id === memoryId,
  );
  const [correcting, setCorrecting] = useState(false);
  const submitMemoryChange = (input: {
    memoryId: string;
    agentDefinition: string;
    projectId?: string;
    userId?: string;
    action: "correct" | "delete";
    replacementSummary?: string;
  }) =>
    requestChange.mutate({
      ...input,
      scope: memory.data?.scope ?? selectedScope ?? { ids: [] },
    });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={selectedMemory ? "Workflow memory record" : "Workflow memory"}
        description={
          selectedMemory ? (
            "Review this memory record and request a governed correction or deletion."
          ) : (
            <>
              Review scoped distilled context available to authorized workflows.
              Changes are proposed, approved, audited, and applied through the
              runtime to <ProductTerm term="memoryBank" />.
            </>
          )
        }
        actions={
          selectedMemory ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void navigate({
                    to: "/workflows/memory",
                    search: { memoryId: undefined },
                    resetScroll: false,
                  })
                }
              >
                <ArrowLeft data-icon="inline-start" />
                Back to memory
              </Button>
              {canManageMemory ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCorrecting((value) => !value)}
                    disabled={requestChange.isPending}
                  >
                    <PencilLine data-icon="inline-start" />
                    Request correction
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Submit a deletion proposal for this memory?",
                        )
                      )
                        submitMemoryChange({
                          memoryId: selectedMemory.id,
                          agentDefinition: selectedMemory.agentDefinition,
                          projectId: selectedMemory.projectId,
                          userId: selectedMemory.userId,
                          action: "delete",
                        });
                    }}
                    disabled={requestChange.isPending}
                  >
                    <Trash2 data-icon="inline-start" />
                    Request deletion
                  </Button>
                </>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild>
                <Link to="/workflows/memory/add">
                  <FilePlus2 data-icon="inline-start" />
                  Add Workflow memory
                </Link>
              </Button>
              <Pill tone="description" icon={ShieldCheck} className="py-1.5">
                Restricted surface
              </Pill>
            </div>
          )
        }
      />
      {selectedMemory ? (
        <MemoryRecordDetail
          record={selectedMemory}
          scopeLabel={scopeLabel}
          status={memory.data?.status ?? "completed"}
          correcting={correcting}
          busy={requestChange.isPending}
          onToggleCorrection={() => setCorrecting((value) => !value)}
          onRequest={submitMemoryChange}
        />
      ) : null}
      {!selectedMemory && canManageMemory ? (
        <MemoryGovernanceCard
          changes={changes.data}
          changesLoading={changes.isLoading}
          changesError={changes.error}
          actionError={memoryAction.error}
          actionPending={memoryAction.isPending}
          onAction={(input) => memoryAction.mutate(input)}
        />
      ) : null}
      {!selectedMemory ? (
        <>
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
              value={scope === "all" ? "" : scope}
              units={units}
              filter={(unit) => unit.canView}
              onChange={(value) => setScope(value || "all")}
            />
          </ListToolbar>
          <ListResultsHeader
            count={memory.data?.memories?.length ?? 0}
            label="visible memory records"
            view={view}
            onViewChange={setView}
          />
        </>
      ) : null}
      <section
        hidden={Boolean(selectedMemory)}
        className="flex flex-col gap-4"
        aria-label="Memory records"
      >
        {memory.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading results…</p>
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
        {memory.data && memory.data.memories?.length === 0 ? (
          <EmptyPanel
            icon={BrainCircuit}
            title="No memories found"
            description="No memory matches the current filters and organization scope."
          />
        ) : null}
        {changeError ? (
          <InlineError
            title="Could not submit the memory change"
            message={changeError}
          />
        ) : null}
        {memory.data && memory.data.memories?.length > 0 ? (
          <ListCollection
            items={memory.data.memories}
            view={view}
            getKey={(record) => record.id}
            renderItem={(record) => (
              <MemoryRecordCard
                record={record}
                scopeLabel={scopeLabel}
                onOpen={() =>
                  void navigate({
                    to: "/workflows/memory",
                    search: { memoryId: record.id },
                    resetScroll: false,
                  })
                }
              />
            )}
          />
        ) : null}
      </section>
    </div>
  );
}

function MemoryGovernanceCard({
  changes,
  changesLoading,
  changesError,
  actionError,
  actionPending,
  onAction,
}: {
  changes: readonly MemoryChangeRecord[] | undefined;
  changesLoading: boolean;
  changesError: Error | null;
  actionError: Error | null;
  actionPending: boolean;
  onAction: (input: {
    id: string;
    action: "approve" | "reject" | "apply";
  }) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory governance</CardTitle>
        <CardDescription>
          Pending and completed add, correction, or deletion proposals for the
          current organization.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {actionError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not update memory governance: {actionError.message}
          </p>
        ) : null}
        {changesLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading memory changes…
          </p>
        ) : changesError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load memory changes: {changesError.message}
          </p>
        ) : changes?.length ? (
          changes.map((change) => (
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
                  · {humanizeKey(change.agentDefinition.replace(/\./gu, " "))}
                </p>
                <p className="text-xs text-muted-foreground">
                  {humanizeKey(change.status)} · {formatDate(change.updatedAt)}
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
                      variant="destructive"
                      disabled={actionPending}
                      onClick={() =>
                        onAction({ id: change.id, action: "reject" })
                      }
                    >
                      <X data-icon="inline-start" />
                      Reject
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={actionPending}
                      onClick={() =>
                        onAction({ id: change.id, action: "approve" })
                      }
                    >
                      <Check data-icon="inline-start" />
                      Approve
                    </Button>
                  </>
                ) : change.status === "approved" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={actionPending}
                    onClick={() => onAction({ id: change.id, action: "apply" })}
                  >
                    <Check data-icon="inline-start" />
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
  );
}

function MemoryRecordCard({
  record,
  scopeLabel,
  onOpen,
}: {
  record: AgentMemoryRecord;
  scopeLabel?: string;
  onOpen: () => void;
}) {
  return (
    <Card
      role="link"
      tabIndex={0}
      className="group relative h-full cursor-pointer transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      aria-label={`Open memory record from ${humanizeKey(record.agentDefinition.replace(/\./gu, " "))}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate">
            {humanizeKey(record.agentDefinition.replace(/\./gu, " "))}
          </CardTitle>
          <CardDescription>
            Observed {formatDate(record.observedAt)}
            {scopeLabel ? ` · ${scopeLabel}` : ""}
          </CardDescription>
        </div>
        <DescriptionPill className="text-[11px]">Memory</DescriptionPill>
      </CardHeader>
      <CardContent className="pr-12">
        <p className="line-clamp-3 text-sm leading-6">{record.summary}</p>
      </CardContent>
      <LinkCardIndicator />
    </Card>
  );
}

function MemoryRecordDetail({
  record,
  scopeLabel,
  status,
  correcting,
  busy,
  onToggleCorrection,
  onRequest,
}: {
  record: AgentMemoryRecord;
  scopeLabel?: string;
  status: string;
  correcting: boolean;
  busy: boolean;
  onToggleCorrection: () => void;
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
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>
            {humanizeKey(record.agentDefinition.replace(/\./gu, " "))}
          </CardTitle>
          <CardDescription>
            Observed {formatDate(record.observedAt)}
            {scopeLabel ? ` · ${scopeLabel}` : ""}
          </CardDescription>
        </div>
        <StatusPill
          status={status}
          label={humanizeKey(status)}
          className="text-[11px]"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm leading-6">{record.summary}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <MemoryDetailValue label="Freshness" value={freshnessValue} />
          <MemoryDetailValue label="Retention" value={retentionValue} />
          <MemoryDetailValue
            label="Ingested"
            value={
              freshness?.ingestedAt
                ? formatDate(freshness.ingestedAt)
                : "Not reported"
            }
          />
          <MemoryDetailValue
            label="Agent linkage"
            value={record.agentDefinition}
          />
          {record.projectId ? (
            <MemoryDetailValue label="Project scope" value={record.projectId} />
          ) : null}
        </dl>
        {record.evidenceRefs.length ? (
          <details className="rounded-md border px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">
              Evidence references ({record.evidenceRefs.length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {record.evidenceRefs.map((ref) => (
                <code
                  key={ref}
                  className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                >
                  {ref}
                </code>
              ))}
            </div>
          </details>
        ) : null}
        <details className="rounded-md border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">
            Technical details
          </summary>
          <div className="mt-2 flex flex-col gap-2 font-mono text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span className="break-all">Memory ID: {record.id}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Copy memory ID"
                onClick={() => void navigator.clipboard?.writeText(record.id)}
              >
                <Copy />
              </Button>
            </div>
            {record.workflowId ? (
              <span>Workflow ID: {record.workflowId}</span>
            ) : null}
            {record.runId ? <span>Run ID: {record.runId}</span> : null}
          </div>
        </details>
        {correcting ? (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <label
              htmlFor="memory-replacement-summary"
              className="text-sm font-medium"
            >
              Replacement fact
            </label>
            <Textarea
              id="memory-replacement-summary"
              value={replacementSummary}
              onChange={(event) => setReplacementSummary(event.target.value)}
              aria-label="Replacement fact"
              maxLength={10000}
              placeholder="Write the corrected memory fact…"
            />
            <div className="flex flex-wrap gap-2">
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
                  setReplacementSummary("");
                }}
              >
                <PencilLine data-icon="inline-start" />
                Submit proposal
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onToggleCorrection}
              >
                <X data-icon="inline-start" />
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MemoryDetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

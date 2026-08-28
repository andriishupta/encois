import type {
  WorkflowBlueprintProjection,
  WorkflowBlueprintStatus,
  WorkflowExecutionProjection,
} from "@encois/contracts/browser";
import {
  Permission,
  TemporalWorkflowType,
  WorkflowExecutionStatus,
} from "@encois/contracts/browser";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { FilePlus2, GitBranch, Play, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import {
  ListCollection,
  ListFilter,
  ListPagination,
  ListResultsHeader,
  ListSearch,
  ListSort,
  ListToolbar,
  type ListViewMode,
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
import { WorkflowStatusIndicator } from "@/components/workflow-status";
import {
  listWorkflowBlueprintsPage,
  listWorkflows,
  startWorkflow,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate } from "@/lib/formatters";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/workflows/")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: WorkflowsPage,
});

function WorkflowsPage() {
  const canManage = useCan(Permission.WorkflowsManage);
  const canRun = useCan(Permission.WorkflowsRun);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WorkflowBlueprintStatus | "all">("all");
  const [sort, setSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("updated-desc");
  const [view, setView] = useState<ListViewMode>("grid");
  const workflows = useInfiniteQuery({
    queryKey: queryKeys.workflowBlueprintPages(query, status, sort),
    queryFn: ({ pageParam }) =>
      listWorkflowBlueprintsPage({
        query,
        status,
        sort,
        limit: 10,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const runs = useQuery({
    queryKey: queryKeys.workflows(),
    queryFn: () => listWorkflows(),
  });
  const blueprintItems =
    workflows.data?.pages.flatMap((page) => page.items) ?? [];
  const definitions = useMemo(
    () => selectWorkflowDefinitions(blueprintItems),
    [blueprintItems],
  );
  const activeRuns = useMemo(
    () => selectActiveRuns(runs.data ?? []),
    [runs.data],
  );

  return (
    <div data-testid="workflows-page" className="flex flex-col gap-4">
      <PageHeader
        title="Workflows"
        description="Browse the workflow definitions available to this organization. Open a definition to inspect its versioned Blueprint or create a new workflow."
        actions={
          canManage ? (
            <Button asChild>
              <Link data-testid="workflows-new" to="/workflows/new">
                <FilePlus2 data-icon="inline-start" />
                New workflow
              </Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Read-only access
            </span>
          )
        }
      />
      <ListToolbar>
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search workflows by name or purpose…"
          label="Search workflows"
        />
        <ListFilter
          value={status}
          onChange={setStatus}
          label="Filter workflows by status"
          options={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "approved", label: "Published" },
          ]}
        />
        <ListSort
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          label="Sort workflows"
          options={[
            { value: "updated-desc", label: "Recently updated" },
            { value: "updated-asc", label: "Oldest updated" },
            { value: "name-asc", label: "Name A–Z" },
            { value: "status", label: "Status" },
          ]}
        />
      </ListToolbar>
      <ListResultsHeader
        count={definitions.length}
        label="visible workflows"
        view={view}
        onViewChange={setView}
      />
      {workflows.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading workflows…</p>
      ) : null}
      {workflows.isError ? (
        <InlineError
          title="Workflows unavailable"
          message={workflows.error.message}
          onRetry={() => workflows.refetch()}
          retrying={workflows.isFetching}
        />
      ) : null}
      {runs.isError ? (
        <InlineError
          title="Current Runs unavailable"
          message={`Run actions are unavailable because current Runs could not be checked: ${runs.error.message}`}
          onRetry={() => runs.refetch()}
          retrying={runs.isFetching}
        />
      ) : null}
      {definitions.length ? (
        <ListCollection
          items={definitions}
          view={view}
          getKey={(workflow) => `${workflow.blueprintId}:${workflow.version}`}
          renderItem={(workflow) => (
            <WorkflowDefinitionCard
              workflow={workflow}
              activeRun={activeRuns.get(workflow.blueprintId)}
              canRun={canRun}
              runsReady={!runs.isLoading && !runs.isError}
            />
          )}
        />
      ) : null}
      {!workflows.isLoading &&
      !workflows.isError &&
      blueprintItems.length > 0 &&
      !definitions.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={Search}
              title="No workflows match"
              description="Change the search or status filter."
            />
          </CardContent>
        </Card>
      ) : null}
      {!workflows.isLoading && !workflows.isError && definitions.length ? (
        <ListPagination
          hasMore={Boolean(workflows.hasNextPage)}
          loading={workflows.isFetchingNextPage}
          onLoadMore={() => void workflows.fetchNextPage()}
        />
      ) : null}
      {!workflows.isLoading &&
      !workflows.isError &&
      definitions.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={GitBranch}
              title="No workflows yet"
              description={
                <>
                  Create one from a published <ProductTerm term="template" /> or
                  an approved <ProductTerm term="blueprint" />.
                </>
              }
              action={
                canManage ? (
                  <Button asChild>
                    <Link to="/workflows/new">
                      <FilePlus2 data-icon="inline-start" />
                      New workflow
                    </Link>
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function selectWorkflowDefinitions(
  blueprints: readonly WorkflowBlueprintProjection[],
): readonly WorkflowBlueprintProjection[] {
  const definitions = new Map<string, WorkflowBlueprintProjection>();
  for (const blueprint of blueprints) {
    if (blueprint.status === "retired") continue;
    const current = definitions.get(blueprint.blueprintId);
    if (
      !current ||
      blueprint.isCurrent ||
      new Date(blueprint.updatedAt).valueOf() >
        new Date(current.updatedAt).valueOf()
    )
      definitions.set(blueprint.blueprintId, blueprint);
  }
  return [...definitions.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

const activeRunStatuses: ReadonlySet<WorkflowExecutionStatus> = new Set([
  WorkflowExecutionStatus.Queued,
  WorkflowExecutionStatus.Running,
  WorkflowExecutionStatus.Waiting,
  WorkflowExecutionStatus.Paused,
]);

function selectActiveRuns(
  runs: readonly WorkflowExecutionProjection[],
): ReadonlyMap<string, WorkflowExecutionProjection> {
  const activeRuns = new Map<string, WorkflowExecutionProjection>();
  for (const run of runs) {
    if (!run.blueprintId || !activeRunStatuses.has(run.status)) continue;
    const current = activeRuns.get(run.blueprintId);
    if (
      !current ||
      new Date(run.updatedAt).valueOf() > new Date(current.updatedAt).valueOf()
    )
      activeRuns.set(run.blueprintId, run);
  }
  return activeRuns;
}

function WorkflowDefinitionCard({
  workflow,
  activeRun,
  canRun,
  runsReady,
}: {
  workflow: WorkflowBlueprintProjection;
  activeRun?: WorkflowExecutionProjection;
  canRun: boolean;
  runsReady: boolean;
}) {
  const statusLabel = workflow.status === "approved" ? "Published" : "Draft";
  return (
    <Card
      data-testid="workflow-definition-card"
      className="flex h-full flex-col"
    >
      <CardHeader>
        <Link
          to="/workflows/definitions/$workflowId"
          params={{ workflowId: workflow.blueprintId }}
          className="group flex items-start justify-between gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div>
            <CardTitle
              data-testid="workflow-definition-title"
              className="group-hover:underline"
            >
              {workflow.name}
            </CardTitle>
            <CardDescription>
              {statusLabel} · v{workflow.version}
              {workflow.isCurrent ? " · current revision" : ""}
            </CardDescription>
          </div>
          <GitBranch
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <Link
          to="/workflows/definitions/$workflowId"
          params={{ workflowId: workflow.blueprintId }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {workflow.purpose}
        </Link>
        <div className="mt-auto grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Steps:</span>{" "}
            {workflow.steps?.length ?? 0} ·{" "}
            <span className="font-medium text-foreground">Approval:</span>{" "}
            {workflow.requiresApproval ? "required" : "not required"}
          </p>
          <p>
            <span className="font-medium text-foreground">Updated:</span>{" "}
            {formatDate(workflow.updatedAt)}
          </p>
        </div>
        <WorkflowDefinitionActions
          workflow={workflow}
          activeRun={activeRun}
          canRun={canRun}
          runsReady={runsReady}
        />
      </CardContent>
    </Card>
  );
}

function WorkflowDefinitionActions({
  workflow,
  activeRun,
  canRun,
  runsReady,
}: {
  workflow: WorkflowBlueprintProjection;
  activeRun?: WorkflowExecutionProjection;
  canRun: boolean;
  runsReady: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: async () => {
      const latestRuns = await queryClient.fetchQuery({
        queryKey: queryKeys.workflows(),
        queryFn: () => listWorkflows(),
        staleTime: 0,
      });
      const latestActiveRun = selectActiveRuns(latestRuns).get(
        workflow.blueprintId,
      );
      if (latestActiveRun)
        throw new Error("This workflow already has an active Run.");
      return startWorkflow({
        workflowType: TemporalWorkflowType.Dynamic,
        blueprintId: workflow.blueprintId,
        blueprintVersion: workflow.version,
      });
    },
    onSuccess: async (started) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRunListRoot(),
        }),
      ]);
      await navigate({
        to: "/workflows/$workflowId",
        params: { workflowId: started.workflowId },
      });
    },
  });
  const canStartAction =
    canRun && workflow.status === "approved" && workflow.isCurrent;
  const canStart = canStartAction && runsReady && !activeRun && !run.isPending;

  return (
    <div className="flex flex-wrap gap-2">
      {canStartAction ? (
        activeRun ? (
          <Button variant="outline" asChild>
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId: activeRun.workflowId }}
            >
              <WorkflowStatusIndicator status={activeRun.status} compact />
              View active run
            </Link>
          </Button>
        ) : (
          <Button
            data-testid="workflow-definition-run"
            onClick={() => run.mutate()}
            disabled={!canStart}
            title={!runsReady ? "Checking current runs…" : undefined}
          >
            {run.isPending ? (
              "Starting…"
            ) : (
              <>
                <Play data-icon="inline-start" />
                Run
              </>
            )}
          </Button>
        )
      ) : null}
      {run.isError ? (
        <p role="alert" className="basis-full text-xs text-destructive">
          Could not start this workflow: {run.error.message}
        </p>
      ) : null}
    </div>
  );
}

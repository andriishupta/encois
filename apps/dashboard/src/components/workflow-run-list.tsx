import {
  type WorkflowExecutionProjection,
  WorkflowExecutionStatus,
} from "@encois/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  CircleDashed,
  Clock3,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import {
  ListCollection,
  ListFilter,
  ListMeta,
  ListPagination,
  ListSearch,
  ListToolbar,
} from "@/components/list-controls";
import { PageHeader } from "@/components/page-header";
import { ProductTerm } from "@/components/product-term";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowStatusIndicator } from "@/components/workflow-status";
import { listWorkflowsPage } from "@/lib/api";
import {
  formatDate,
  shortIdentifier,
  workflowLabel,
  workflowStatusLabel,
} from "@/lib/formatters";
import { queryKeys } from "@/lib/query-keys";

export function WorkflowRunList() {
  const [status, setStatus] = useState<WorkflowExecutionStatus | "all">("all");
  const [query, setQuery] = useState("");
  const workflows = useInfiniteQuery({
    queryKey: ["workflow-run-list", ...queryKeys.workflows(), query, status],
    queryFn: ({ pageParam }) =>
      listWorkflowsPage({ query, status, limit: 10, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const visibleWorkflows =
    workflows.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={<ProductTerm term="run" plural />}
        description="Monitor each workflow execution, its current state, and the evidence it produces."
      />
      <ListToolbar>
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search runs by workflow, status, or ID…"
          label="Search workflow runs"
        />
        <ListFilter
          value={status}
          onChange={setStatus}
          label="Filter workflow runs by status"
          options={[
            { value: "all", label: "All statuses" },
            ...Object.values(WorkflowExecutionStatus).map((value) => ({
              value,
              label: workflowStatusLabel(value),
            })),
          ]}
        />
        <ListMeta>{visibleWorkflows.length} visible runs</ListMeta>
      </ListToolbar>
      {workflows.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading workflow runs…</p>
      ) : null}
      {workflows.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not load workflow runs: {workflows.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {visibleWorkflows.length ? (
        <ListCollection
          items={visibleWorkflows}
          view="list"
          getKey={(workflow) => workflow.workflowId}
          renderItem={(workflow) => <WorkflowRunCard workflow={workflow} />}
        />
      ) : null}
      {!workflows.isLoading &&
      !workflows.isError &&
      !visibleWorkflows.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={workflows.data ? RefreshCw : CircleDashed}
              title={workflows.data ? "No runs match" : "No workflow runs yet"}
              description={
                workflows.data
                  ? "Choose another search or lifecycle status."
                  : "A workflow run will appear here when an authorized member starts one."
              }
            />
          </CardContent>
        </Card>
      ) : null}
      {!workflows.isLoading && !workflows.isError && visibleWorkflows.length ? (
        <ListPagination
          hasMore={Boolean(workflows.hasNextPage)}
          loading={workflows.isFetchingNextPage}
          onLoadMore={() => void workflows.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function WorkflowRunCard({
  workflow,
}: {
  workflow: WorkflowExecutionProjection;
}) {
  const label = workflowLabel(workflow.blueprintId, workflow.workflowType);
  const Icon =
    workflow.status === WorkflowExecutionStatus.Completed
      ? Activity
      : GitBranch;

  return (
    <Link
      to="/workflows/$workflowId"
      params={{ workflowId: workflow.workflowId }}
      className="group"
    >
      <Card className="transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
              <Icon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <CardTitle className="truncate">{label}</CardTitle>
              <CardDescription className="truncate">
                {workflow.statusMessage ??
                  "Current workflow run status and progress."}
              </CardDescription>
            </div>
          </div>
          <ArrowUpRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <WorkflowStatusIndicator
            status={workflow.status}
            reason={workflow.statusReason}
            compact
          />
          <span className="flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden="true" />
            Updated {formatDate(workflow.updatedAt)}
          </span>
          <span className="truncate text-muted-foreground">
            Trigger: {workflow.trigger ?? "Not reported"}
          </span>
          <span className="truncate text-muted-foreground">
            Technical ID:{" "}
            <span className="font-mono">
              {shortIdentifier(workflow.workflowId)}
            </span>
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

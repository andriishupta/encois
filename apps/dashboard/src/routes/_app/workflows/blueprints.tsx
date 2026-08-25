import type {
  WorkflowBlueprintProjection,
  WorkflowBlueprintStatus,
} from "@encois/contracts";
import { Permission } from "@encois/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { GitBranch, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import {
  ListCollection,
  ListFilter,
  ListMeta,
  ListPagination,
  ListSearch,
  ListToolbar,
  type ListViewMode,
  ListViewToggle,
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
import { deleteWorkflowBlueprint, listWorkflowBlueprintsPage } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate } from "@/lib/formatters";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/workflows/blueprints")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: WorkflowBlueprintsPage,
});

function WorkflowBlueprintsPage() {
  const canManage = useCan(Permission.WorkflowsManage);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WorkflowBlueprintStatus | "all">("all");
  const [sort, setSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("updated-desc");
  const [view, setView] = useState<ListViewMode>("grid");
  const blueprints = useInfiniteQuery({
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
    enabled: pathname === "/workflows/blueprints",
  });
  if (pathname !== "/workflows/blueprints") return <Outlet />;
  const visibleBlueprints =
    blueprints.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Workflow Blueprints"
        description="Immutable, organization-scoped execution definitions. A Run is created from a Blueprint snapshot; changing one never rewrites an existing Run."
      />
      <ListToolbar>
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search Blueprints by name or purpose…"
          label="Search workflow Blueprints"
        />
        <ListFilter
          value={status}
          onChange={setStatus}
          label="Filter Blueprints by lifecycle status"
          options={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "approved", label: "Published / approved" },
            { value: "retired", label: "Archived / retired" },
          ]}
        />
        <ListFilter
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          label="Sort Blueprints"
          options={[
            { value: "updated-desc", label: "Recently updated" },
            { value: "updated-asc", label: "Oldest updated" },
            { value: "name-asc", label: "Name A–Z" },
            { value: "status", label: "Status" },
          ]}
        />
        <ListViewToggle value={view} onChange={setView} />
      </ListToolbar>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {visibleBlueprints.length} visible Blueprints
        </p>
        <ListMeta>API-sorted revisions</ListMeta>
      </div>
      {blueprints.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Blueprints…</p>
      ) : null}
      {blueprints.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not load Blueprints: {blueprints.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {visibleBlueprints.length ? (
        <ListCollection
          items={visibleBlueprints}
          view={view}
          getKey={(blueprint) =>
            `${blueprint.blueprintId}:${blueprint.version}`
          }
          renderItem={(blueprint) => (
            <BlueprintCard blueprint={blueprint} canManage={canManage} />
          )}
        />
      ) : null}
      {!blueprints.isLoading &&
      !blueprints.isError &&
      blueprints.data &&
      !visibleBlueprints.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={Search}
              title="No Blueprints match"
              description="Change the search or lifecycle filter."
            />
          </CardContent>
        </Card>
      ) : null}
      {!blueprints.isLoading && !blueprints.isError && !blueprints.data ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={GitBranch}
              title="No Blueprints"
              description={
                <>
                  Create one from a published <ProductTerm term="template" />{" "}
                  and submit it through the{" "}
                  <ProductTerm term="approvalBoundary" />.
                </>
              }
            />
          </CardContent>
        </Card>
      ) : null}
      {!blueprints.isLoading &&
      !blueprints.isError &&
      visibleBlueprints.length ? (
        <ListPagination
          hasMore={Boolean(blueprints.hasNextPage)}
          loading={blueprints.isFetchingNextPage}
          onLoadMore={() => void blueprints.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function BlueprintCard({
  blueprint,
  canManage,
}: {
  blueprint: WorkflowBlueprintProjection;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteWorkflowBlueprint(blueprint.blueprintId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflowBlueprintsRoot(),
      }),
  });

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{blueprint.name}</CardTitle>
            <CardDescription>
              v{blueprint.version} · {blueprint.status}
              {blueprint.isCurrent ? " · current" : ""}
            </CardDescription>
          </div>
          <GitBranch
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="text-sm text-muted-foreground">{blueprint.purpose}</p>
        <div className="mt-auto grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Steps:</span>{" "}
            {blueprint.steps?.length ?? 0} ·{" "}
            <span className="font-medium text-foreground">Approval:</span>{" "}
            {blueprint.requiresApproval ? "required" : "not required"}
          </p>
          <p>
            <span className="font-medium text-foreground">Updated:</span>{" "}
            {formatDate(blueprint.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link
              to="/workflows/blueprints/$blueprintId"
              params={{ blueprintId: blueprint.blueprintId }}
            >
              Review revisions
            </Link>
          </Button>
          {blueprint.status === "approved" && blueprint.isCurrent ? (
            <Button variant="outline" asChild>
              <Link
                to="/workflows/new"
                search={{ blueprint: blueprint.blueprintId }}
              >
                Use as workflow source
              </Link>
            </Button>
          ) : null}
          {canManage ? (
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
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          ) : null}
          {remove.isError ? (
            <p role="alert" className="basis-full text-xs text-destructive">
              Could not delete this Blueprint: {remove.error.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

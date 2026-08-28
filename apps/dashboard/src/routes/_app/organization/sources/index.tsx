import {
  type KnowledgeSource,
  KnowledgeSourceStatus,
  Permission,
} from "@encois/contracts/browser";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { FileText, Plus, Search, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { CurrentScopeText, ScopePill } from "@/components/current-scope";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import { LinkCardIndicator } from "@/components/link-card";
import {
  ListCollection,
  ListFilter,
  ListPagination,
  ListResultsHeader,
  ListSearch,
  ListToolbar,
  type ListViewMode,
} from "@/components/list-controls";
import { PageHeader } from "@/components/page-header";
import { DescriptionPill, StatusPill } from "@/components/pill";
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listKnowledgeSourcesPage } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { humanizeKey } from "@/lib/formatters";
import { formatUnitPath } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/sources/")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.KnowledgeRead))
      throw redirect({ to: "/forbidden" });
  },
  component: SourcesPage,
});

const pageSize = 10;

function SourcesPage() {
  const { units, currentUnitId } = useOrganization();
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId)
    ? currentUnitId
    : undefined;
  const currentUnit = units.find((unit) => unit.id === selectedScopeUnitId);
  const canManage = hasPermission(getAuthSession(), Permission.KnowledgeManage);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<KnowledgeSourceStatus | "all">("all");
  const [view, setView] = useState<ListViewMode>("grid");
  const sources = useInfiniteQuery({
    queryKey: queryKeys.sourcePages(
      selectedScopeUnitId,
      query,
      status,
      "name-asc",
    ),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listKnowledgeSourcesPage({
        scopeUnitId: selectedScopeUnitId,
        query,
        status,
        sort: "name-asc",
        limit: pageSize,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const items = useMemo(
    () => sources.data?.pages.flatMap((page) => page.items) ?? [],
    [sources.data],
  );
  const firstPage = sources.data?.pages[0];
  const total = firstPage?.pagination.total ?? 0;
  const statuses = [
    { value: "all", label: "All statuses" },
    ...Object.values(KnowledgeSourceStatus).map((value) => ({
      value,
      label: humanizeKey(value),
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={<ProductTerm term="knowledgeSource" plural />}
        description={
          <>
            Scoped inputs available in <CurrentScopeText />. Integration Sources
            and uploaded documents use the same permission-aware pipeline.
          </>
        }
        actions={
          canManage ? (
            <Button asChild>
              <Link
                to="/organization/sources/new"
                search={{ sourceType: undefined }}
              >
                <Plus data-icon="inline-start" />
                Add source
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
          placeholder="Search Sources by name, provider, or type…"
          label="Search Sources"
        />
        <ListFilter
          value={status}
          onChange={(value) =>
            setStatus(value as KnowledgeSourceStatus | "all")
          }
          options={statuses}
          label="Filter Sources by status"
        />
      </ListToolbar>
      <ListResultsHeader
        count={items.length}
        total={total}
        label="visible sources"
        view={view}
        onViewChange={setView}
      />
      {sources.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Sources…</p>
      ) : null}
      {sources.isError ? (
        <InlineError
          title="Sources unavailable"
          message={sources.error.message}
          onRetry={() => sources.refetch()}
          retrying={sources.isFetching}
        />
      ) : null}
      {!sources.isLoading && !sources.isError && items.length ? (
        <ListCollection
          items={items}
          view={view}
          getKey={(source) => source.id}
          renderItem={(source) => <SourceCard source={source} units={units} />}
        />
      ) : null}
      {!sources.isLoading && !sources.isError && !items.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={query || status !== "all" ? Search : Waypoints}
              title={
                query || status !== "all" ? (
                  "No Sources match"
                ) : (
                  <>
                    No Sources in <CurrentScopeText />
                    {currentUnit?.type === "organization" ? "" : " scope"}
                  </>
                )
              }
              description={
                query || status !== "all" ? (
                  "Change the search or status filter."
                ) : (
                  <>
                    No Sources are available in <CurrentScopeText />
                    {currentUnit?.type === "organization" ? "" : " scope"}.
                  </>
                )
              }
              action={
                canManage ? (
                  <Button asChild>
                    <Link
                      to="/organization/sources/new"
                      search={{ sourceType: undefined }}
                    >
                      <Plus data-icon="inline-start" />
                      Add source
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : null}
      {!sources.isLoading && !sources.isError && items.length ? (
        <ListPagination
          hasMore={Boolean(sources.hasNextPage)}
          loading={sources.isFetchingNextPage}
          onLoadMore={() => void sources.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function SourceCard({
  source,
  units,
}: {
  source: KnowledgeSource;
  units: ReturnType<typeof useOrganization>["units"];
}) {
  const Icon = source.kind === "uploaded_document" ? FileText : Waypoints;
  const isFailed = source.status === KnowledgeSourceStatus.Failed;
  const statusLabel =
    source.status === KnowledgeSourceStatus.Ingesting
      ? "Ingesting"
      : humanizeKey(source.status);
  const freshnessLabel = source.freshness?.status
    ? humanizeKey(source.freshness.status)
    : "Freshness unavailable";
  return (
    <Link
      to="/organization/sources/$sourceId"
      params={{ sourceId: source.id }}
      className="group block"
    >
      <Card className="relative flex h-full min-h-[170px] flex-col transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
              <Icon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <CardTitle className="min-w-0 truncate">{source.name}</CardTitle>
              <CardDescription className="mt-1">
                {source.provider ??
                  source.contentType ??
                  humanizeKey(source.kind)}
              </CardDescription>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
            <StatusPill
              status={
                isFailed
                  ? "failed"
                  : source.currentRevisionId
                    ? "ready"
                    : "not ready"
              }
              label={
                isFailed
                  ? "Failed"
                  : source.currentRevisionId
                    ? "Ready"
                    : "Not ready"
              }
              className={
                isFailed
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : undefined
              }
            />
            {!isFailed ? (
              <StatusPill status={source.status} label={statusLabel} />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 pr-14 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <ScopePill
              label="Read"
              name={formatSourceScope(source.readScope.ids, units)}
            />
            <ScopePill
              label="Visible"
              name={formatSourceScope(source.visibilityScope.ids, units)}
            />
            <DescriptionPill>{freshnessLabel}</DescriptionPill>
          </div>
        </CardContent>
        <LinkCardIndicator />
      </Card>
    </Link>
  );
}

function formatSourceScope(
  ids: readonly string[],
  units: ReturnType<typeof useOrganization>["units"],
): string {
  return ids.map((id) => formatUnitPath(units, id) || id).join(", ");
}

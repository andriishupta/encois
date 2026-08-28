import { Permission, type SavedInvestigation } from "@encois/contracts/browser";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Bookmark, Plus } from "lucide-react";
import { useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import { LinkCardIndicator } from "@/components/link-card";
import {
  ListCollection,
  ListPagination,
  ListResultsHeader,
  ListSearch,
  ListToolbar,
  type ListViewMode,
} from "@/components/list-controls";
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
import { listSavedInvestigationsPage } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate, humanizeKey } from "@/lib/formatters";
import { formatUnitPath } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/investigations/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  beforeLoad: () => {
    const session = getAuthSession();
    if (
      !hasPermission(session, Permission.OrganizationManage) &&
      !hasPermission(session, Permission.WorkflowsRead) &&
      !hasPermission(session, Permission.KnowledgeRead) &&
      !hasPermission(session, Permission.ContextRead) &&
      !hasPermission(session, Permission.MemoryRead)
    )
      throw redirect({ to: "/forbidden" });
  },
  component: OrganizationInvestigationsPage,
});

const pageSize = 10;

function OrganizationInvestigationsPage() {
  const navigate = Route.useNavigate();
  const { q } = Route.useSearch();
  const { units } = useOrganization();
  const [view, setView] = useState<ListViewMode>("grid");
  const investigations = useInfiniteQuery({
    queryKey: queryKeys.savedInvestigationPages(q ?? "", "updated-desc"),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listSavedInvestigationsPage({
        query: q,
        sort: "updated-desc",
        limit: pageSize,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const items = investigations.data?.pages.flatMap((page) => page.items) ?? [];
  const total = investigations.data?.pages[0]?.pagination.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Investigations"
        description="Create and review repeatable, scope-bound investigations against organization context."
        actions={
          <Button asChild>
            <Link
              to="/organization/investigations/new"
              search={{ q: undefined }}
            >
              <Plus data-icon="inline-start" />
              New Investigation
            </Link>
          </Button>
        }
      />
      <ListToolbar>
        <ListSearch
          value={q ?? ""}
          onChange={(value) =>
            void navigate({
              replace: true,
              resetScroll: false,
              search: { q: value || undefined },
            })
          }
          placeholder="Search investigations by name or query…"
          label="Search investigations"
        />
      </ListToolbar>
      <ListResultsHeader
        count={items.length}
        total={total}
        label="visible investigations"
        view={view}
        onViewChange={setView}
      />
      {investigations.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading investigations…</p>
      ) : null}
      {investigations.isError ? (
        <InlineError
          title="Investigations unavailable"
          message={investigations.error.message}
          onRetry={() => void investigations.refetch()}
          retrying={investigations.isFetching}
        />
      ) : null}
      {!investigations.isLoading && !investigations.isError && items.length ? (
        <ListCollection
          items={items}
          view={view}
          getKey={(item) => item.id}
          renderItem={(item) => (
            <InvestigationCard investigation={item} units={units} />
          )}
        />
      ) : null}
      {!investigations.isLoading && !investigations.isError && !items.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={Bookmark}
              title={q ? "No investigations match" : "No investigations yet"}
              description={
                q
                  ? "Change the search query."
                  : "Create an investigation to make it available here."
              }
            />
          </CardContent>
        </Card>
      ) : null}
      {!investigations.isLoading && !investigations.isError && items.length ? (
        <ListPagination
          hasMore={Boolean(investigations.hasNextPage)}
          loading={investigations.isFetchingNextPage}
          onLoadMore={() => void investigations.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function InvestigationCard({
  investigation,
  units,
}: {
  investigation: SavedInvestigation;
  units: ReturnType<typeof useOrganization>["units"];
}) {
  const contextLabel = investigation.scope.ids
    .map((id) => formatUnitPath(units, id) || id)
    .join(", ");

  return (
    <Link
      to="/organization/investigations/$investigationId"
      params={{ investigationId: investigation.id }}
      search={{ q: undefined }}
      className="group block"
    >
      <Card className="relative h-full transition-colors group-hover:border-foreground/30">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span className="truncate">{investigation.name}</span>
            <DescriptionPill className="text-[11px] font-normal">
              {investigation.kind}
            </DescriptionPill>
          </CardTitle>
          <CardDescription>
            {humanizeKey(investigation.query)} · updated{" "}
            {formatDate(investigation.updatedAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="pr-14">
          <span className="block truncate text-xs text-muted-foreground">
            Context: {contextLabel}
          </span>
        </CardContent>
        <LinkCardIndicator />
      </Card>
    </Link>
  );
}

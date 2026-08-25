import {
  type IntegrationProjection,
  IntegrationStatus,
  Permission,
} from "@encois/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import {
  ArrowUpRight,
  CheckCircle2,
  Github,
  PlugZap,
  Plus,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
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
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listIntegrationsPage } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { humanizeKey, shortIdentifier } from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/integrations/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: IntegrationsPage,
});

const pageSize = 10;

function IntegrationsPage() {
  const navigate = useNavigate();
  const { q } = Route.useSearch();
  const { organizationName, units, currentUnitId, members } = useOrganization();
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId)
    ? currentUnitId
    : undefined;
  const currentUnit = units.find((unit) => unit.id === selectedScopeUnitId);
  const scopeLabel =
    currentUnit?.type === "organization"
      ? (organizationName ?? currentUnit.name)
      : (currentUnit?.name ?? "current scope");
  const actor = members.find(
    (member) => member.id === getAuthSession()?.userId,
  );
  const canManage =
    useCan(Permission.IntegrationsManage) &&
    (actor?.roleKey === "organization_admin" || actor?.roleKey === "admin");
  const [status, setStatus] = useState<IntegrationStatus | "all">("all");
  const [sort, setSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("updated-desc");
  const [view, setView] = useState<ListViewMode>("grid");
  const integrations = useInfiniteQuery({
    queryKey: queryKeys.integrationPages(
      selectedScopeUnitId,
      q ?? "",
      status,
      sort,
    ),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listIntegrationsPage({
        scopeUnitId: selectedScopeUnitId,
        query: q,
        status,
        sort,
        limit: pageSize,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const items = useMemo(
    () => integrations.data?.pages.flatMap((page) => page.items) ?? [],
    [integrations.data],
  );
  const firstIntegrationPage = integrations.data?.pages[0];
  const total = firstIntegrationPage?.pagination.total ?? 0;
  const statuses = [
    { value: "all", label: "All statuses" },
    ...Object.values(IntegrationStatus).map((value) => ({
      value,
      label: humanizeKey(value),
    })),
  ];
  const sorts = [
    { value: "updated-desc", label: "Recently updated" },
    { value: "updated-asc", label: "Oldest updated" },
    { value: "name-asc", label: "Name" },
    { value: "status", label: "Status" },
  ] as const;
  function updateQuery(value: string) {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (current) => ({ ...current, q: value || undefined }),
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={<ProductTerm term="integration" plural />}
        description={
          <>
            Organization-level provider integrations are available to authorized
            unit-scoped Sources. Current scope: {scopeLabel}.
          </>
        }
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/organization/integrations/new">
                <Plus data-icon="inline-start" />
                Add integration
              </Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Read-only access
            </span>
          )
        }
      />
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Existing Integrations
          </h2>
          <p className="text-sm text-muted-foreground">
            Configured provider connections visible in the current organization
            scope.
          </p>
        </div>
      </div>
      <ListToolbar>
        <ListSearch
          value={q ?? ""}
          onChange={updateQuery}
          placeholder="Search Integrations by provider or name…"
          label="Search Integrations"
        />
        <ListFilter
          value={status}
          onChange={(value) => setStatus(value as IntegrationStatus | "all")}
          options={statuses}
          label="Filter Integrations by status"
        />
        <ListFilter
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={sorts}
          label="Sort Integrations"
        />
      </ListToolbar>
      <ListResultsHeader
        count={items.length}
        label="visible integrations"
        meta={`${total} available`}
        view={view}
        onViewChange={setView}
      />
      {integrations.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Integrations…</p>
      ) : null}
      {integrations.isError ? (
        <InlineError
          title="Integrations unavailable"
          message={integrations.error.message}
          onRetry={() => integrations.refetch()}
          retrying={integrations.isFetching}
        />
      ) : null}
      {!integrations.isLoading && !integrations.isError && items.length ? (
        <ListCollection
          items={items}
          view={view}
          getKey={(integration) => integration.id}
          renderItem={(integration) => (
            <IntegrationPreviewCard
              integration={integration}
              view={view}
              scopeLabel={scopeLabel}
            />
          )}
        />
      ) : null}
      {!integrations.isLoading && !integrations.isError && !items.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={q || status !== "all" ? Search : PlugZap}
              title={
                q || status !== "all" ? (
                  "No Integrations match"
                ) : (
                  <>
                    No Integrations in {scopeLabel}
                    {currentUnit?.type === "organization" ? "" : " scope"}
                  </>
                )
              }
              description={
                q || status !== "all"
                  ? "Change the search or status filter."
                  : `No connected Integrations are available in ${scopeLabel}${currentUnit?.type === "organization" ? "" : " scope"}.`
              }
            />
          </CardContent>
        </Card>
      ) : null}
      {!integrations.isLoading && !integrations.isError && items.length ? (
        <ListPagination
          hasMore={Boolean(integrations.hasNextPage)}
          loading={integrations.isFetchingNextPage}
          onLoadMore={() => void integrations.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function IntegrationPreviewCard({
  integration,
  view,
  scopeLabel,
}: {
  integration: IntegrationProjection;
  view: ListViewMode;
  scopeLabel: string;
}) {
  const Icon =
    integration.provider.toLowerCase() === "github" ? Github : PlugZap;
  return (
    <Link
      to="/organization/integrations/$integrationId"
      params={{ integrationId: integration.id }}
      className="group block"
    >
      <Card
        className={
          view === "list"
            ? "transition-colors group-hover:border-foreground/30 md:flex md:items-center md:justify-between"
            : "h-full transition-colors group-hover:border-foreground/30"
        }
      >
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border bg-muted/30">
              <Icon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div className="flex flex-col gap-1.5">
              <CardTitle>{integration.name}</CardTitle>
              <CardDescription>
                {integration.provider} · {integration.type.toUpperCase()}
              </CardDescription>
            </div>
          </div>
          <ArrowUpRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {integration.status === IntegrationStatus.Active ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <PlugZap className="size-3.5" aria-hidden="true" />
          )}
          <span>{humanizeKey(integration.status)}</span>
          <span className="rounded-full bg-secondary px-2 py-1">
            Visible in {scopeLabel}
          </span>
          <span className="ml-auto">
            ID:{" "}
            <span className="font-mono">{shortIdentifier(integration.id)}</span>
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

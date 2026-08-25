import type { WorkflowTemplateProjection } from "@encois/contracts";
import { Permission } from "@encois/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import {
  AvailabilityBadge,
  unavailableCardClassName,
} from "@/components/availability-state";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listWorkflowTemplatesPage } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/workflows/templates")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: WorkflowTemplatesPage,
});

function WorkflowTemplatesPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const [sort, setSort] = useState<
    "updated-desc" | "updated-asc" | "name-asc" | "status"
  >("updated-desc");
  const [view, setView] = useState<ListViewMode>("grid");
  const templates = useInfiniteQuery({
    queryKey: queryKeys.workflowTemplatePages(query, status, sort),
    queryFn: ({ pageParam }) =>
      listWorkflowTemplatesPage({
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
  const visibleTemplates =
    templates.data?.pages.flatMap((page) => page.items) ?? [];
  const activeCount = visibleTemplates.filter(
    (template) => template.status === "active",
  ).length;
  const disabledCount = visibleTemplates.filter(
    (template) => template.status === "disabled",
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Workflow templates"
        description="Provider-neutral patterns that can be resolved into an independent Blueprint. Active templates can be used now; disabled templates remain visible but cannot be used."
      />
      <ListToolbar>
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search templates by name, purpose, or provider…"
          label="Search workflow templates"
        />
        <ListFilter
          value={status}
          onChange={setStatus}
          label="Filter workflow templates by status"
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
        <ListFilter
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          label="Sort workflow templates"
          options={[
            { value: "updated-desc", label: "Recently updated" },
            { value: "updated-asc", label: "Oldest updated" },
            { value: "name-asc", label: "Name A–Z" },
            { value: "status", label: "Status" },
          ]}
        />
      </ListToolbar>
      <ListResultsHeader
        count={visibleTemplates.length}
        label="visible templates"
        meta={`${activeCount} active · ${disabledCount} disabled`}
        view={view}
        onViewChange={setView}
      />
      {templates.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading templates…</p>
      ) : null}
      {templates.isError ? (
        <InlineError
          title="Workflow templates unavailable"
          message={templates.error.message}
          onRetry={() => templates.refetch()}
          retrying={templates.isFetching}
        />
      ) : null}
      {visibleTemplates.length ? (
        <ListCollection
          items={visibleTemplates}
          view={view}
          getKey={(template) => template.id}
          renderItem={(template) => <TemplateCard template={template} />}
        />
      ) : null}
      {!templates.isLoading &&
      !templates.isError &&
      !visibleTemplates.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={Sparkles}
              title="No templates match"
              description="Try another search or ask an administrator to add a reviewed template."
            />
          </CardContent>
        </Card>
      ) : null}
      {!templates.isLoading && !templates.isError && visibleTemplates.length ? (
        <ListPagination
          hasMore={Boolean(templates.hasNextPage)}
          loading={templates.isFetchingNextPage}
          onLoadMore={() => void templates.fetchNextPage()}
        />
      ) : null}
    </div>
  );
}

function TemplateCard({ template }: { template: WorkflowTemplateProjection }) {
  const disabled = template.status !== "active";
  return (
    <Card
      className={cn(
        "flex h-full flex-col",
        disabled && unavailableCardClassName,
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{template.title}</CardTitle>
          {disabled ? <AvailabilityBadge label="Disabled" /> : null}
        </div>
        <CardDescription>
          {template.category} · v{template.version}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="text-sm text-muted-foreground">{template.description}</p>
        <div className="flex flex-wrap gap-1.5">
          {template.requiredCapabilities.map((capability) => (
            <span
              key={capability}
              className="rounded-full bg-secondary px-2 py-1 text-[11px] text-secondary-foreground"
            >
              {capability}
            </span>
          ))}
        </div>
        <details className="mt-auto rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            Technical details
          </summary>
          <div className="mt-2 grid gap-2">
            <p>
              Provider slots:{" "}
              {template.template.providerSlots?.length || "None"}
            </p>
            <p>
              Steps: {template.template.steps?.length ?? 0} · Output:{" "}
              {template.template.output.type}
            </p>
            <p>Estimated duration: Not reported by Template</p>
            <p>Risk: Review approval requirements in the plan preview</p>
          </div>
        </details>
        {disabled ? (
          <Button variant="outline" disabled>
            Disabled
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link to="/workflows/new" search={{ template: template.key }}>
              Use in workflow creation
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

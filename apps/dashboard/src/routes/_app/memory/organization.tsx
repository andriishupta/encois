import {
  type ExecutionScope,
  type GraphInspectionParams,
  type GraphInspectorQueryName,
  Permission,
  type SavedInvestigation,
} from "@encois/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CircleAlert, Network, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContextGraphCanvas } from "@/components/context-graph-canvas";
import { EmptyPanel } from "@/components/empty-panel";
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  createSavedInvestigation,
  deleteSavedInvestigation,
  isApiError,
  listSavedInvestigations,
  queryContextGraph,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/memory/organization")({
  validateSearch: (search: Record<string, unknown>) => ({
    savedId: typeof search.savedId === "string" ? search.savedId : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.ContextRead))
      throw redirect({ to: "/forbidden" });
  },
  component: ContextGraphPage,
});

const queryOptions: readonly {
  value: GraphInspectorQueryName;
  label: string;
  description: string;
}[] = [
  {
    value: "all_context",
    label: "All context",
    description: "The current organization-scoped graph projection.",
  },
  {
    value: "release.blockers",
    label: "Release blockers",
    description: "Blocked entities and their linked graph facts.",
  },
  {
    value: "source.facts",
    label: "Source facts",
    description: "Facts projected from connected Sources.",
  },
  {
    value: "project.related_entities",
    label: "Organization unit neighborhood",
    description:
      "Entities directly related to a selected organization unit key.",
  },
];

function ContextGraphPage() {
  const { units } = useOrganization();
  const { savedId } = Route.useSearch();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState<GraphInspectorQueryName>("all_context");
  const [scope, setScope] = useState("all");
  const [savedScope, setSavedScope] = useState<ExecutionScope | undefined>();
  const [projectId, setProjectId] = useState("");
  const [nodeType, setNodeType] = useState("");
  const [relationship, setRelationship] = useState("");
  const selectedScope =
    scope === "all"
      ? undefined
      : scope === "saved"
        ? savedScope
        : { ids: [scope] };
  const graphParams: GraphInspectionParams = {
    ...(query === "project.related_entities" && projectId.trim()
      ? { projectId: projectId.trim() }
      : {}),
    ...(nodeType.trim() ? { nodeType: nodeType.trim() } : {}),
    ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
  };
  const [savedName, setSavedName] = useState("");
  const saved = useQuery({
    queryKey: queryKeys.savedInvestigations(),
    queryFn: listSavedInvestigations,
  });
  const saveInvestigation = useMutation({
    mutationFn: () =>
      createSavedInvestigation({
        name: savedName.trim(),
        kind: "graph",
        query,
        ...(Object.keys(graphParams).length ? { params: graphParams } : {}),
        scope: selectedScope ?? {
          ids: units
            .filter((unit) => unit.canView && unit.id !== "organization")
            .map((unit) => unit.id),
        },
      }),
    onSuccess: async () => {
      setSavedName("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.savedInvestigations(),
      });
    },
  });
  const removeInvestigation = useMutation({
    mutationFn: (id: string) => deleteSavedInvestigation(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.savedInvestigations(),
      });
    },
  });
  const graph = useQuery({
    queryKey: queryKeys.contextGraph(
      query,
      scope,
      projectId,
      nodeType,
      relationship,
    ),
    queryFn: () =>
      queryContextGraph({
        query,
        ...(Object.keys(graphParams).length ? { params: graphParams } : {}),
        ...(selectedScope ? { scope: selectedScope } : {}),
      }),
    enabled:
      query !== "project.related_entities" || projectId.trim().length > 0,
  });
  const selectedQuery = useMemo(
    () => queryOptions.find((option) => option.value === query),
    [query],
  );
  const loadSavedInvestigation = useCallback(
    (item: SavedInvestigation) => {
      if (item.kind !== "graph") return;
      const nextQuery = queryOptions.some(
        (option) => option.value === item.query,
      )
        ? (item.query as GraphInspectorQueryName)
        : "all_context";
      const stringParam = (key: string) =>
        typeof item.params[key] === "string"
          ? (item.params[key] as string)
          : "";
      setQuery(nextQuery);
      setProjectId(
        nextQuery === "project.related_entities"
          ? stringParam("projectId")
          : "",
      );
      setNodeType(stringParam("nodeType"));
      setRelationship(stringParam("relationship"));
      setSavedScope(item.scope);
      setScope(
        item.scope.ids.length === 1 &&
          units.some((unit) => unit.id === item.scope.ids[0])
          ? item.scope.ids[0]
          : "saved",
      );
    },
    [units],
  );
  const [loadedSavedId, setLoadedSavedId] = useState<string>();
  useEffect(() => {
    if (!savedId || loadedSavedId === savedId || !saved.data) return;
    const item = saved.data.find((candidate) => candidate.id === savedId);
    if (item) loadSavedInvestigation(item);
    setLoadedSavedId(savedId);
  }, [loadSavedInvestigation, loadedSavedId, saved.data, savedId]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Organization memory graph"
        description={
          <>
            Inspect the scoped relationships and evidence that power{" "}
            <ProductTerm term="investigation" plural />. This read-only surface
            keeps scope and evidence visible.
          </>
        }
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Restricted surface
          </span>
        }
      />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>
            <ProductTerm term="investigation" plural />
          </CardTitle>
          <CardDescription>
            Save this bounded graph query for repeatable review. Scope stays
            attached to the saved record.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                value={savedName}
                onChange={(event) => setSavedName(event.target.value)}
                placeholder="e.g. Release blockers"
                maxLength={120}
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
              />
              <Button
                type="button"
                onClick={() => saveInvestigation.mutate()}
                disabled={!savedName.trim() || saveInvestigation.isPending}
              >
                {saveInvestigation.isPending ? (
                  "Saving…"
                ) : (
                  <>
                    <Save data-icon="inline-start" />
                    Save
                  </>
                )}
              </Button>
            </div>
            {saveInvestigation.isError ? (
              <p role="alert" className="text-xs text-destructive">
                Could not save: {saveInvestigation.error.message}
              </p>
            ) : null}
            {saved.isError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
              >
                Saved investigations are unavailable: {saved.error.message}
              </p>
            ) : null}
            {removeInvestigation.isError ? (
              <p role="alert" className="text-xs text-destructive">
                Could not delete the saved investigation:{" "}
                {removeInvestigation.error.message}
              </p>
            ) : null}
            {saved.data?.length ? (
              <div className="flex flex-col gap-2">
                {saved.data.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-md border p-2 text-xs"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-w-0 flex-1 justify-start truncate px-1 text-left"
                      onClick={() => loadSavedInvestigation(item)}
                      disabled={item.kind !== "graph"}
                    >
                      {item.name}
                    </Button>
                    <span className="text-muted-foreground">{item.query}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${item.name}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete saved investigation “${item.name}”? This cannot be undone.`,
                          )
                        )
                          removeInvestigation.mutate(item.id);
                      }}
                      disabled={removeInvestigation.isPending}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-4 text-muted-foreground" />
            Organization memory graph
          </CardTitle>
          <CardDescription>{selectedQuery?.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5 text-xs font-medium">
              <ProductTerm term="query" />
              <Select
                value={query}
                aria-label="Query"
                onChange={(event) => {
                  setQuery(event.target.value as GraphInspectorQueryName);
                }}
                options={queryOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5 text-xs font-medium">
              Scope
              <Select
                value={scope}
                aria-label="Scope"
                onChange={(event) => {
                  const value = event.target.value;
                  setScope(value);
                  if (value !== "saved") setSavedScope(undefined);
                }}
                options={[
                  { value: "all", label: "All available units" },
                  ...(scope === "saved" && savedScope
                    ? [
                        {
                          value: "saved",
                          label: `Saved scope (${savedScope.ids.length} units)`,
                        },
                      ]
                    : []),
                  ...units
                    .filter(
                      (unit) => unit.canView && unit.id !== "organization",
                    )
                    .map((unit) => ({ value: unit.id, label: unit.name })),
                ]}
              />
            </div>
            {query === "project.related_entities" ? (
              <div className="flex flex-1 flex-col gap-1.5 text-xs font-medium">
                Organization unit key
                <Input
                  value={projectId}
                  aria-label="Organization unit key"
                  onChange={(event) => setProjectId(event.target.value)}
                  placeholder="Organization unit id"
                  maxLength={160}
                />
              </div>
            ) : null}
            <div className="flex flex-1 flex-col gap-1.5 text-xs font-medium">
              Start node type{" "}
              <span className="font-normal text-muted-foreground">
                Optional · linked endpoints stay visible
              </span>
              <Input
                value={nodeType}
                aria-label="Start node type"
                onChange={(event) => setNodeType(event.target.value)}
                placeholder="e.g. service"
                maxLength={80}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5 text-xs font-medium">
              Relationship{" "}
              <span className="font-normal text-muted-foreground">
                Optional
              </span>
              <Input
                value={relationship}
                aria-label="Relationship"
                onChange={(event) => setRelationship(event.target.value)}
                placeholder="e.g. depends_on"
                maxLength={120}
              />
            </div>
          </div>
          {graph.isLoading ? (
            <div className="flex h-[560px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              Loading graph projection…
            </div>
          ) : null}
          {graph.isError ? (
            <EmptyPanel
              icon={CircleAlert}
              title={
                isApiError(graph.error) &&
                graph.error.code === "GRAPH_UNAVAILABLE"
                  ? "Organization memory graph unavailable"
                  : "Graph query failed"
              }
              description={graph.error.message}
            />
          ) : null}
          {graph.data && graph.data.nodes.length === 0 ? (
            <EmptyPanel
              icon={Network}
              title="No graph facts in this scope"
              description="The selected query returned no visible nodes. Ingest a Source or widen the organization scope."
            />
          ) : null}
          {graph.data && graph.data.nodes.length > 0 ? (
            <ContextGraphCanvas graph={graph.data} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

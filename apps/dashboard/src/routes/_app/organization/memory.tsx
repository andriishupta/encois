import {
  type GraphInspectionParams,
  type GraphInspectorQueryName,
  Permission,
} from "@encois/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CircleAlert, Network, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { ContextGraphCanvas } from "@/components/context-graph-canvas";
import { EmptyPanel } from "@/components/empty-panel";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { isApiError, queryContextGraph } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/memory")({
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
  const [query, setQuery] = useState<GraphInspectorQueryName>("all_context");
  const [scope, setScope] = useState("all");
  const [projectId, setProjectId] = useState("");
  const [nodeType, setNodeType] = useState("");
  const [relationship, setRelationship] = useState("");
  const selectedScope = scope === "all" ? undefined : { ids: [scope] };
  const graphParams: GraphInspectionParams = {
    ...(query === "project.related_entities" && projectId.trim()
      ? { projectId: projectId.trim() }
      : {}),
    ...(nodeType.trim() ? { nodeType: nodeType.trim() } : {}),
    ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
  };
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
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Organization memory graph"
        description={
          "Inspect scoped relationships and evidence available to the organization."
        }
        actions={
          <Pill tone="description" icon={ShieldCheck} className="py-1.5">
            Restricted surface
          </Pill>
        }
      />
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
              Query
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
                  setScope(event.target.value);
                }}
                options={[
                  { value: "all", label: "All available units" },
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

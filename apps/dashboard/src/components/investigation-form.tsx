import type {
  GraphInspectionParams,
  GraphInspectorQueryName,
} from "@encois/contracts/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { createSavedInvestigation } from "@/lib/api";
import { flattenUnitOptions } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

const queryOptions: readonly {
  value: GraphInspectorQueryName;
  label: string;
}[] = [
  { value: "all_context", label: "All context" },
  { value: "release.blockers", label: "Release blockers" },
  { value: "source.facts", label: "Source facts" },
  {
    value: "project.related_entities",
    label: "Organization unit neighborhood",
  },
];

export function InvestigationForm({
  detailPath,
}: {
  detailPath: "/organization/investigations/$investigationId";
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { units } = useOrganization();
  const [name, setName] = useState("");
  const [query, setQuery] = useState<GraphInspectorQueryName>("all_context");
  const [scope, setScope] = useState("all");
  const [projectId, setProjectId] = useState("");
  const [nodeType, setNodeType] = useState("");
  const [relationship, setRelationship] = useState("");
  const scopeOptions = [
    { value: "all", label: "All authorized units" },
    ...flattenUnitOptions(units)
      .filter(({ unit }) => unit.canView)
      .map(({ unit, depth }) => ({
        value: unit.id,
        label: `${"— ".repeat(depth)}${unit.name}`,
      })),
  ];
  const create = useMutation({
    mutationFn: () => {
      const params: GraphInspectionParams = {
        ...(query === "project.related_entities" && projectId.trim()
          ? { projectId: projectId.trim() }
          : {}),
        ...(nodeType.trim() ? { nodeType: nodeType.trim() } : {}),
        ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
      };
      const scopeIds =
        scope === "all"
          ? units.filter((unit) => unit.canView).map((unit) => unit.id)
          : [scope];
      return createSavedInvestigation({
        name: name.trim(),
        kind: "graph",
        query,
        ...(Object.keys(params).length ? { params } : {}),
        scope: { ids: scopeIds },
      });
    },
    onSuccess: async (investigation) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.savedInvestigationPages(),
      });
      await navigate({
        to: detailPath,
        params: { investigationId: investigation.id },
        search: { q: undefined },
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>New investigation</CardTitle>
        <CardDescription>
          Save a graph query with the organization context it should inspect.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <Field id="investigation-name" label="Name">
          <Input
            id="investigation-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Release blockers"
            maxLength={120}
          />
        </Field>
        <Field id="investigation-query" label="Query">
          <Select
            id="investigation-query"
            value={query}
            aria-label="Query"
            onChange={(event) =>
              setQuery(event.target.value as GraphInspectorQueryName)
            }
            options={queryOptions}
          />
        </Field>
        <Field id="investigation-context" label="Context">
          <Select
            id="investigation-context"
            value={scope}
            aria-label="Investigation context"
            onChange={(event) => setScope(event.target.value)}
            options={scopeOptions}
          />
        </Field>
        {query === "project.related_entities" ? (
          <Field id="investigation-project-id" label="Organization unit key">
            <Input
              id="investigation-project-id"
              value={projectId}
              aria-label="Organization unit key"
              onChange={(event) => setProjectId(event.target.value)}
              placeholder="Organization unit id"
              maxLength={160}
            />
          </Field>
        ) : null}
        <Field id="investigation-node-type" label="Start node type">
          <Input
            id="investigation-node-type"
            value={nodeType}
            aria-label="Start node type"
            onChange={(event) => setNodeType(event.target.value)}
            placeholder="Optional, e.g. service"
            maxLength={80}
          />
        </Field>
        <Field id="investigation-relationship" label="Relationship">
          <Input
            id="investigation-relationship"
            value={relationship}
            aria-label="Relationship"
            onChange={(event) => setRelationship(event.target.value)}
            placeholder="Optional, e.g. depends_on"
            maxLength={120}
          />
        </Field>
        <div className="flex items-end justify-end md:col-span-2">
          <Button
            type="button"
            onClick={() => create.mutate()}
            disabled={
              !name.trim() ||
              !units.some((unit) => unit.canView) ||
              create.isPending
            }
          >
            <Save data-icon="inline-start" />
            {create.isPending ? "Saving…" : "Save investigation"}
          </Button>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-destructive md:col-span-2">
            Could not save the investigation: {create.error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

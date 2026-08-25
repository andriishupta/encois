import { Permission } from "@encois/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft, BrainCircuit } from "lucide-react";
import { useEffect, useState } from "react";
import { OrganizationUnitSelect } from "@/components/organization-unit-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createMemoryChange } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/memory/workflow/add")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.MemoryManage))
      throw redirect({ to: "/forbidden" });
  },
  component: AddWorkflowMemoryPage,
});

const agentDefinitions = [
  "context.synthesizer@1",
  "release-investigation.synthesizer@1",
  "source-ingestion",
] as const;

function AddWorkflowMemoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { units } = useOrganization();
  const [agentDefinition, setAgentDefinition] = useState<string>(
    agentDefinitions[0],
  );
  const [scope, setScope] = useState("");
  const [summary, setSummary] = useState("");
  const [evidenceRefs, setEvidenceRefs] = useState("");
  const mutation = useMutation({
    mutationFn: createMemoryChange,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.memoryChanges(),
      });
      await navigate({ to: "/memory/workflow" });
    },
  });

  useEffect(() => {
    if (!scope) setScope(units.find((unit) => unit.canManage)?.id ?? "");
  }, [scope, units]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const references = [
      ...new Set(
        evidenceRefs
          .split(/\r?\n/gu)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (!scope || !summary.trim() || references.length === 0) return;
    mutation.mutate({
      agentDefinition,
      scope: { ids: [scope] },
      action: "add",
      replacementSummary: summary.trim(),
      evidenceRefs: references,
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Add Workflow memory"
        description="Create an evidence-linked memory proposal for one authorized organization scope. It will remain subject to review and approval."
        actions={
          <Button variant="outline" asChild>
            <Link to="/memory/workflow">
              <ArrowLeft data-icon="inline-start" />
              Back to memory
            </Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            New memory proposal
          </CardTitle>
          <CardDescription>
            Memory is not written directly from the browser. This creates a
            reviewable change for the runtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <label
              className="flex flex-col gap-2 text-sm font-medium"
              htmlFor="workflow-memory-agent-definition"
            >
              Agent definition
              <Select
                id="workflow-memory-agent-definition"
                value={agentDefinition}
                onChange={(event) => setAgentDefinition(event.target.value)}
                options={agentDefinitions.map((definition) => ({
                  value: definition,
                  label: definition,
                }))}
              />
            </label>
            <OrganizationUnitSelect
              id="workflow-memory-scope"
              label="Organization scope"
              value={scope}
              units={units}
              filter={(unit) => unit.canView}
              isDisabled={(unit) => !unit.canManage}
              onChange={setScope}
              required
              description="The proposal is visible and applicable only within this selected scope."
            />
            <label
              className="flex flex-col gap-2 text-sm font-medium"
              htmlFor="workflow-memory-fact"
            >
              Memory fact
              <Textarea
                id="workflow-memory-fact"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                minLength={1}
                maxLength={10000}
                rows={6}
                placeholder="Write the evidence-backed fact to remember…"
                required
              />
            </label>
            <label
              className="flex flex-col gap-2 text-sm font-medium"
              htmlFor="workflow-memory-evidence-refs"
            >
              Evidence references{" "}
              <span className="font-normal text-muted-foreground">
                One reference per line
              </span>
              <Textarea
                id="workflow-memory-evidence-refs"
                value={evidenceRefs}
                onChange={(event) => setEvidenceRefs(event.target.value)}
                rows={4}
                placeholder="source:source-id:revision-id"
                required
              />
            </label>
            {mutation.isError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                Could not submit the memory proposal: {mutation.error.message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 border-t pt-5">
              <Button type="button" variant="ghost" asChild>
                <Link to="/memory/workflow">Cancel</Link>
              </Button>
              <Button
                type="submit"
                disabled={
                  mutation.isPending ||
                  !scope ||
                  !summary.trim() ||
                  !evidenceRefs.trim()
                }
              >
                {mutation.isPending ? "Submitting…" : "Submit proposal"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

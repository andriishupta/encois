import type { WorkflowBlueprintProjection } from "@encois/contracts";
import { Permission } from "@encois/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft, GitBranch, Trash2 } from "lucide-react";
import { EmptyPanel } from "@/components/empty-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { deleteWorkflowDefinition, listWorkflowBlueprints } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate } from "@/lib/formatters";
import { useCan } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/workflows/definitions/$workflowId")(
  {
    beforeLoad: () => {
      if (!hasPermission(getAuthSession(), Permission.WorkflowsRead))
        throw redirect({ to: "/forbidden" });
    },
    component: WorkflowDefinitionPage,
  },
);

function WorkflowDefinitionPage() {
  const { workflowId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = useCan(Permission.WorkflowsManage);
  const blueprints = useQuery({
    queryKey: queryKeys.workflowBlueprints(),
    queryFn: listWorkflowBlueprints,
  });
  const revisions = (blueprints.data ?? [])
    .filter(
      (blueprint) =>
        blueprint.blueprintId === workflowId && blueprint.status !== "retired",
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const workflow =
    revisions.find((revision) => revision.isCurrent) ?? revisions[0];
  const remove = useMutation({
    mutationFn: () => deleteWorkflowDefinition(workflowId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowBlueprintsRoot(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
      ]);
      await navigate({ to: "/workflows" });
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={workflow?.name ?? "Workflow"}
        description="Inspect the current Workflow definition and its versioned Blueprint revisions."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/workflows">
                <ArrowLeft data-icon="inline-start" />
                Back to Workflows
              </Link>
            </Button>
            {workflow?.status === "approved" && workflow.isCurrent ? (
              <Button variant="outline" asChild>
                <Link
                  to="/workflows/new"
                  search={{ blueprint: workflow.blueprintId }}
                >
                  Copy workflow
                </Link>
              </Button>
            ) : null}
            {canManage && workflow ? (
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this Workflow definition? Its Blueprint revisions will be hidden, while historical Runs remain available.",
                    )
                  )
                    remove.mutate();
                }}
              >
                <Trash2 data-icon="inline-start" />
                {remove.isPending ? "Deleting…" : "Delete Workflow"}
              </Button>
            ) : null}
          </div>
        }
      />
      {blueprints.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading Workflow definition…
        </p>
      ) : null}
      {blueprints.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not load this Workflow: {blueprints.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {remove.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not delete this Workflow: {remove.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {!blueprints.isLoading && !blueprints.isError && !workflow ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={GitBranch}
              title="Workflow not found"
              description="This Workflow is not available in the current organization or scope."
            />
          </CardContent>
        </Card>
      ) : null}
      {workflow ? (
        <WorkflowDefinitionContent workflow={workflow} revisions={revisions} />
      ) : null}
    </div>
  );
}

function WorkflowDefinitionContent({
  workflow,
  revisions,
}: {
  workflow: WorkflowBlueprintProjection;
  revisions: readonly WorkflowBlueprintProjection[];
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{workflow.purpose}</CardTitle>
          <CardDescription>
            {workflow.status === "approved" ? "Published" : "Draft"} · v
            {workflow.version}
            {workflow.isCurrent ? " · current revision" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <DefinitionValue
            label="Steps"
            value={String(workflow.steps.length)}
          />
          <DefinitionValue
            label="Approval"
            value={workflow.requiresApproval ? "Required" : "Not required"}
          />
          <DefinitionValue label="Revisions" value={String(revisions.length)} />
          <DefinitionValue
            label="Updated"
            value={formatDate(workflow.updatedAt)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Blueprint revisions</CardTitle>
          <CardDescription>
            Versioned execution snapshots remain separate from the Workflow
            definition lifecycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {revisions.map((revision) => (
            <Link
              key={revision.version}
              to="/workflows/blueprints/$blueprintId"
              params={{ blueprintId: revision.blueprintId }}
              className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
            >
              <GitBranch
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  v{revision.version}
                  {revision.isCurrent ? " · current" : ""}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {revision.status} · {revision.steps.length} steps · updated{" "}
                  {formatDate(revision.updatedAt)}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                Open Blueprint
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function DefinitionValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

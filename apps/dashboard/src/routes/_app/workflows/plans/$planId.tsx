import type {
  WorkflowChangePlan,
  WorkflowPlanRecord,
} from "@encois/contracts/browser";
import { Permission } from "@encois/contracts/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft, Check, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { OrganizationUnitSelect } from "@/components/organization-unit-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  applyWorkflowPlan,
  approveWorkflowPlan,
  deleteWorkflowPlan,
  getWorkflowPlan,
  updateWorkflowPlan,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate } from "@/lib/formatters";
import { formatUnitPath } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { invalidateWorkflowPlanQueries } from "@/lib/query-invalidation";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/workflows/plans/$planId")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsManage))
      throw redirect({ to: "/forbidden" });
  },
  component: WorkflowPlanDetailPage,
});

function WorkflowPlanDetailPage() {
  const { planId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { units } = useOrganization();
  const planQuery = useQuery({
    queryKey: queryKeys.workflowPlan(planId),
    queryFn: () => getWorkflowPlan(planId),
  });
  const plan = planQuery.data;
  const change = plan?.plan.changes.find((item) => item.blueprint);
  const blueprint = change?.blueprint;
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [reason, setReason] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!plan) return;
    setName(blueprint?.name ?? "");
    setPurpose(blueprint?.purpose ?? "");
    setReason(change?.reason ?? "");
    const scopeIds = plan.plan.scope?.ids ?? [];
    setScopeId(scopeIds.length === 1 && scopeIds[0] !== "*" ? scopeIds[0] : "");
  }, [blueprint?.name, blueprint?.purpose, change?.reason, plan]);

  const editable = plan?.status === "proposed" && Boolean(blueprint && change);
  const save = useMutation({
    mutationFn: () => {
      if (!plan || !change?.blueprint || !editable)
        throw new Error("This Plan is not editable.");
      return updateWorkflowPlan(
        planId,
        buildEditedPlan(plan.plan, change, name, purpose, reason, scopeId),
      );
    },
    onSuccess: async () => {
      setSuccess("Plan changes saved. It remains awaiting approval.");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowPlan(planId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowPlansRoot(),
        }),
      ]);
    },
  });
  const approve = useMutation({
    mutationFn: () => approveWorkflowPlan(planId),
    onSuccess: async () => {
      await invalidateWorkflowPlanQueries(queryClient, planId);
    },
  });
  const apply = useMutation({
    mutationFn: () => applyWorkflowPlan(planId),
    onSuccess: async () => {
      await Promise.all([
        invalidateWorkflowPlanQueries(queryClient, planId),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowBlueprintsRoot(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRunListRoot(),
        }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteWorkflowPlan(planId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflowPlansRoot(),
      });
      await navigate({ to: "/workflows/plans" });
    },
  });
  const actionError =
    save.error?.message ??
    approve.error?.message ??
    apply.error?.message ??
    remove.error?.message;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={blueprint?.name ?? "Change Plan"}
        description="Review this persisted Change Plan and manage its approval boundary."
        actions={
          <Button variant="outline" asChild>
            <Link to="/workflows/plans">
              <ArrowLeft data-icon="inline-start" />
              Back to Change Plans
            </Link>
          </Button>
        }
      />
      {planQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Plan…</p>
      ) : null}
      {planQuery.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p role="alert" className="text-sm text-destructive">
              Could not load this Plan: {planQuery.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {!planQuery.isLoading && !planQuery.isError && !plan ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              title="Plan not found"
              description="This Plan is not available in the current organization or scope."
            />
          </CardContent>
        </Card>
      ) : null}
      {plan ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                {editable ? "Edit proposal" : "Proposal details"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {editable ? (
                <>
                  <label
                    className="flex flex-col gap-2 text-sm font-medium"
                    htmlFor="plan-name"
                  >
                    Workflow name
                    <input
                      id="plan-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground"
                    />
                  </label>
                  <label
                    className="flex flex-col gap-2 text-sm font-medium"
                    htmlFor="plan-purpose"
                  >
                    Purpose
                    <Textarea
                      id="plan-purpose"
                      value={purpose}
                      onChange={(event) => setPurpose(event.target.value)}
                      rows={3}
                      className="font-normal text-foreground"
                    />
                  </label>
                  <OrganizationUnitSelect
                    id="plan-scope"
                    label="Execution scope"
                    value={scopeId}
                    units={units}
                    onChange={setScopeId}
                    description="Leave unchanged if this proposal uses a broader or multi-unit scope."
                  />
                  <label
                    className="flex flex-col gap-2 text-sm font-medium"
                    htmlFor="plan-reason"
                  >
                    Reason
                    <Textarea
                      id="plan-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={3}
                      className="font-normal text-foreground"
                    />
                  </label>
                  <Button
                    className="self-start"
                    disabled={
                      save.isPending ||
                      !name.trim() ||
                      !purpose.trim() ||
                      reason.trim().length < 3
                    }
                    onClick={() => {
                      setSuccess("");
                      save.mutate();
                    }}
                  >
                    <Save data-icon="inline-start" />
                    {save.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </>
              ) : (
                <ReadOnlyPlanDetails plan={plan} units={units} />
              )}
              {!editable && plan.status !== "proposed" ? (
                <p className="text-sm text-muted-foreground">
                  This Plan is {planStatusLabel(plan.status).toLowerCase()} and
                  can no longer be edited. Create a new proposal for changes.
                </p>
              ) : null}
              {!editable && !blueprint ? (
                <p className="text-sm text-muted-foreground">
                  This Plan has no Blueprint snapshot to edit. Its change type
                  must be handled by the corresponding workflow command.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Approval boundary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              {plan.status === "proposed" ? (
                <Button
                  variant="outline"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate()}
                >
                  <Check data-icon="inline-start" />
                  {approve.isPending ? "Approving…" : "Approve"}
                </Button>
              ) : null}
              {plan.status === "approved" ? (
                <Button
                  disabled={apply.isPending}
                  onClick={() => apply.mutate()}
                >
                  {apply.isPending ? "Applying…" : "Apply plan"}
                </Button>
              ) : null}
              {plan.status !== "applied" ? (
                <Button
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm("Delete this Change Plan?"))
                      remove.mutate();
                  }}
                >
                  <Trash2 data-icon="inline-start" />
                  {remove.isPending ? "Deleting…" : "Delete Plan"}
                </Button>
              ) : null}
              <span className="ml-auto text-sm text-muted-foreground">
                {planStatusLabel(plan.status)} · updated{" "}
                {formatDate(plan.updatedAt)}
              </span>
            </CardContent>
          </Card>
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          {success ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {success}
            </p>
          ) : null}
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Technical details</summary>
            <div className="mt-2 flex flex-col gap-1 font-mono text-xs">
              <span>Change Plan {plan.planId}</span>
              <span>Coordinator {plan.coordinatorId}</span>
              <span>Created {formatDate(plan.createdAt)}</span>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}

function buildEditedPlan(
  plan: WorkflowChangePlan,
  change: WorkflowChangePlan["changes"][number],
  name: string,
  purpose: string,
  reason: string,
  scopeId: string,
): WorkflowChangePlan {
  const changes = plan.changes.map((item) =>
    item === change && item.blueprint
      ? {
          ...item,
          reason: reason.trim(),
          blueprint: {
            ...item.blueprint,
            name: name.trim(),
            purpose: purpose.trim(),
          },
        }
      : item,
  );
  return {
    ...plan,
    ...(scopeId ? { scope: { ids: [scopeId] } } : {}),
    changes,
  };
}

function ReadOnlyPlanDetails({
  plan,
  units,
}: {
  plan: WorkflowPlanRecord;
  units: ReturnType<typeof useOrganization>["units"];
}) {
  const change = plan.plan.changes[0];
  const scope = plan.plan.scope?.ids
    ?.map((id) => formatUnitPath(units, id) || id)
    .join(", ");
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-2">
      <PlanValue
        label="Workflow"
        value={change?.blueprint?.name ?? change?.kind ?? "Change"}
      />
      <PlanValue
        label="Purpose"
        value={change?.blueprint?.purpose ?? "Not provided"}
      />
      <PlanValue label="Scope" value={scope || "Organization scope"} />
      <PlanValue label="Reason" value={change?.reason ?? "Not provided"} />
    </div>
  );
}

function PlanValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words">{value}</p>
    </div>
  );
}

function planStatusLabel(status: WorkflowPlanRecord["status"]): string {
  if (status === "proposed") return "Awaiting approval";
  if (status === "approved") return "Ready to apply";
  if (status === "applied") return "Applied";
  if (status === "rejected") return "Rejected";
  return "Expired";
}

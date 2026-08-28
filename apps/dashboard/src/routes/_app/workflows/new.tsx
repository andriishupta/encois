import type {
  WorkflowBlueprintProjection,
  WorkflowCreationIntent,
  WorkflowPlanRecord,
  WorkflowTemplateProjection,
} from "@encois/contracts/browser";
import { Permission, WorkflowStepKind } from "@encois/contracts/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FilePlus2,
  GitBranch,
  LoaderCircle,
  Play,
  PlugZap,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AvailabilityBadge,
  unavailableCardClassName,
} from "@/components/availability-state";
import { EmptyPanel } from "@/components/empty-panel";
import { OrganizationUnitSelect } from "@/components/organization-unit-select";
import { PageHeader } from "@/components/page-header";
import { DescriptionPill, StatusPill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardButton,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  applyWorkflowPlan,
  approveWorkflowPlan,
  listWorkflowBlueprints,
  listWorkflowTemplates,
  previewWorkflowCreation,
  submitWorkflowCreation,
} from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatUnitPath } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/workflows/new")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { blueprint?: string; template?: string } => ({
    blueprint:
      typeof search.blueprint === "string" ? search.blueprint : undefined,
    template: typeof search.template === "string" ? search.template : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsManage))
      throw redirect({ to: "/forbidden" });
  },
  component: NewWorkflowPage,
});

type CreationMode = WorkflowCreationIntent["mode"];
type Stage = 1 | 2 | 3;

const modeOptions: readonly {
  mode: CreationMode;
  title: string;
  description: string;
  icon: typeof FilePlus2;
  disabled?: boolean;
}[] = [
  {
    mode: "template",
    title: "From a template",
    description: "Start with a reviewed, provider-neutral workflow pattern.",
    icon: FilePlus2,
  },
  {
    mode: "blueprint",
    title: "Use an existing Blueprint",
    description:
      "Create a new workflow from an approved version in this organization.",
    icon: GitBranch,
  },
  {
    mode: "manual",
    title: "Describe it manually",
    description: "AI-generated workflows are coming soon.",
    icon: WandSparkles,
    disabled: true,
  },
];

function NewWorkflowPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentUnitId, units } = useOrganization();
  const search = Route.useSearch();
  const [executionScopeId, setExecutionScopeId] = useState("");
  const [stage, setStage] = useState<Stage>(
    search.blueprint || search.template ? 2 : 1,
  );
  const [mode, setMode] = useState<CreationMode | null>(() =>
    search.blueprint ? "blueprint" : search.template ? "template" : null,
  );
  const [templateKey, setTemplateKey] = useState<string | undefined>(
    () => search.template,
  );
  const [blueprintKey, setBlueprintKey] = useState<string | undefined>(
    () => search.blueprint,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [runAfterApply, setRunAfterApply] = useState(true);
  const [submittedPlanId, setSubmittedPlanId] = useState<string>();
  const [createdPlan, setCreatedPlan] = useState<WorkflowPlanRecord>();
  const [completed, setCompleted] = useState(false);

  const templates = useQuery({
    queryKey: queryKeys.workflowTemplates(),
    queryFn: () => listWorkflowTemplates(),
    enabled: mode === "template",
  });
  const blueprints = useQuery({
    queryKey: queryKeys.workflowBlueprints(),
    queryFn: listWorkflowBlueprints,
    enabled: mode === "blueprint",
  });

  const selectedTemplate = useMemo(
    () => templates.data?.find((item) => item.key === templateKey),
    [templateKey, templates.data],
  );
  const availableBlueprints = useMemo(() => {
    const approved = (blueprints.data ?? []).filter(
      (item) => item.status === "approved",
    );
    const current = approved.filter((item) => item.isCurrent);
    return current.length ? current : approved;
  }, [blueprints.data]);
  const selectedBlueprint = useMemo(
    () => availableBlueprints.find((item) => item.blueprintId === blueprintKey),
    [availableBlueprints, blueprintKey],
  );
  const selectedSourceTitle =
    selectedTemplate?.title ?? selectedBlueprint?.name;
  const currentScope = executionScopeId
    ? formatUnitPath(units, executionScopeId) || "Current organization scope"
    : "Current organization scope";

  useEffect(() => {
    if (!units.length) return;
    const preferredScopeId =
      currentUnitId === "organization"
        ? units.find((unit) => unit.type === "organization" && unit.canView)?.id
        : currentUnitId;
    if (
      preferredScopeId &&
      units.some((unit) => unit.id === preferredScopeId && unit.canView)
    )
      setExecutionScopeId(preferredScopeId);
  }, [currentUnitId, units]);

  const buildIntent = (start: boolean): WorkflowCreationIntent => ({
    mode: mode ?? "manual",
    name: name.trim(),
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(templateKey ? { templateKey } : {}),
    ...(blueprintKey ? { blueprintKey } : {}),
    ...(executionScopeId ? { scope: { ids: [executionScopeId] } } : {}),
    start,
  });

  const preview = useMutation({
    mutationFn: () => previewWorkflowCreation(buildIntent(false)),
    onSuccess: () => setStage(3),
  });
  const submit = useMutation({
    mutationFn: () => submitWorkflowCreation(buildIntent(runAfterApply)),
    onSuccess: async (plan) => {
      setCreatedPlan(plan);
      setSubmittedPlanId(plan.planId);
      queryClient.setQueryData(queryKeys.workflowPlan(plan.planId), plan);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflowPlansRoot(),
      });
      await navigate({
        to: "/workflows/plans/$planId",
        params: { planId: plan.planId },
      });
    },
  });
  const createAndApprove = useMutation({
    mutationFn: async () => {
      const plan = await submitWorkflowCreation(buildIntent(runAfterApply));
      setCreatedPlan(plan);
      setSubmittedPlanId(plan.planId);
      return approveWorkflowPlan(plan.planId);
    },
    onSuccess: async (plan) => {
      setSubmittedPlanId(plan.planId);
      queryClient.setQueryData(queryKeys.workflowPlan(plan.planId), plan);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflowPlansRoot(),
      });
      await navigate({
        to: "/workflows/plans/$planId",
        params: { planId: plan.planId },
      });
    },
  });
  const approve = useMutation({
    mutationFn: () => approveWorkflowPlan(submittedPlanId ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflowPlansRoot(),
      });
    },
  });
  const apply = useMutation({
    mutationFn: () => applyWorkflowPlan(submittedPlanId ?? ""),
    onSuccess: async () => {
      setCompleted(true);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowPlansRoot(),
        }),
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

  const sourceReady =
    mode === "template"
      ? selectedTemplate?.status === "active"
      : mode === "blueprint"
        ? Boolean(blueprintKey)
        : false;
  const canPreview = Boolean(name.trim() && sourceReady && !preview.isPending);
  const submitted = submit.data ?? createdPlan;
  const approved =
    approve.data ?? (submitted?.status === "approved" ? submitted : undefined);

  function chooseMode(nextMode: CreationMode) {
    setMode(nextMode);
    setTemplateKey(undefined);
    setBlueprintKey(undefined);
    setStage(1);
    preview.reset();
    submit.reset();
    createAndApprove.reset();
    approve.reset();
    apply.reset();
    setSubmittedPlanId(undefined);
    setCreatedPlan(undefined);
    setCompleted(false);
  }

  function goToPreview() {
    preview.reset();
    preview.mutate();
  }

  return (
    <div data-testid="workflow-create-page" className="flex flex-col gap-8">
      <PageHeader
        title="New workflow"
        description="Create a governed workflow from a catalog template or an approved Blueprint. Internal identifiers and execution details are managed for you."
        actions={
          <Button variant="outline" asChild>
            <Link to="/workflows">
              <ArrowLeft data-icon="inline-start" />
              Back to workflows
            </Link>
          </Button>
        }
      />

      <fieldset
        className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-3"
        aria-label="Workflow creation progress"
      >
        <StepIndicator
          number="1"
          label="Choose source"
          active={stage === 1}
          complete={stage > 1}
        />
        <StepIndicator
          number="2"
          label="Configure"
          active={stage === 2}
          complete={stage > 2}
        />
        <StepIndicator
          number="3"
          label="Review and apply"
          active={stage === 3}
          complete={completed}
        />
      </fieldset>

      {stage === 1 ? (
        <SourceStage
          mode={mode}
          onModeChange={chooseMode}
          templates={templates.data ?? []}
          blueprints={availableBlueprints}
          selectedTemplateKey={templateKey}
          selectedBlueprintKey={blueprintKey}
          onTemplateChange={(key) => {
            setTemplateKey(key);
            setStage(2);
          }}
          onBlueprintChange={(key) => {
            setBlueprintKey(key);
            setStage(2);
          }}
          templatesLoading={templates.isLoading}
          blueprintsLoading={blueprints.isLoading}
          error={
            mode === "template"
              ? templates.error
              : mode === "blueprint"
                ? blueprints.error
                : null
          }
        />
      ) : null}
      {stage === 2 ? (
        <ConfigureStage
          name={name}
          description={description}
          mode={mode}
          sourceTitle={selectedSourceTitle}
          currentScope={currentScope}
          executionScopeId={executionScopeId}
          units={units}
          onExecutionScopeChange={setExecutionScopeId}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onBack={() => setStage(1)}
          onPreview={goToPreview}
          canPreview={canPreview}
          error={preview.error}
        />
      ) : null}
      {stage === 3 ? (
        <ReviewStage
          preview={preview.data}
          isLoading={preview.isPending}
          error={
            preview.error ??
            submit.error ??
            createAndApprove.error ??
            approve.error ??
            apply.error
          }
          runAfterApply={runAfterApply}
          onRunChange={setRunAfterApply}
          submitted={submitted}
          approved={approved}
          completed={completed}
          onSubmit={() => {
            createAndApprove.reset();
            submit.mutate();
          }}
          submitting={submit.isPending}
          onCreateAndApprove={() => {
            submit.reset();
            createAndApprove.mutate();
          }}
          creatingAndApproving={createAndApprove.isPending}
          onApprove={() => approve.mutate()}
          approving={approve.isPending}
          onApply={() => apply.mutate()}
          applying={apply.isPending}
          onBack={() => {
            preview.reset();
            setStage(2);
          }}
          onOpenWorkflows={() => void navigate({ to: "/workflows" })}
        />
      ) : null}
    </div>
  );
}

function SourceStage({
  mode,
  onModeChange,
  templates,
  blueprints,
  selectedTemplateKey,
  selectedBlueprintKey,
  onTemplateChange,
  onBlueprintChange,
  templatesLoading,
  blueprintsLoading,
  error,
}: {
  mode: CreationMode | null;
  onModeChange: (mode: CreationMode) => void;
  templates: readonly WorkflowTemplateProjection[];
  blueprints: readonly WorkflowBlueprintProjection[];
  selectedTemplateKey?: string;
  selectedBlueprintKey?: string;
  onTemplateChange: (key: string) => void;
  onBlueprintChange: (key: string) => void;
  templatesLoading: boolean;
  blueprintsLoading: boolean;
  error: Error | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Choose a starting point</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a reviewed template or an approved Blueprint to continue.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {modeOptions.map((option) => {
          const Icon = option.icon;
          return (
            <CardButton
              key={option.mode}
              data-testid={`workflow-source-${option.mode}`}
              type="button"
              disabled={option.disabled}
              onClick={() => onModeChange(option.mode)}
              className={cn(
                "min-h-36 items-start gap-4 p-5",
                mode === option.mode &&
                  "border-foreground bg-accent/50 ring-2 ring-foreground/10",
                option.disabled && unavailableCardClassName,
              )}
              aria-pressed={mode === option.mode}
            >
              <span className="flex w-full items-start justify-between gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                {option.disabled ? <AvailabilityBadge /> : null}
              </span>
              <span>
                <span className="block font-medium">{option.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </CardButton>
          );
        })}
      </div>
      {mode === "template" ? (
        <SelectionList
          title="Workflow templates"
          description="Active templates can be used now. Disabled templates remain visible but cannot be selected."
          loading={templatesLoading}
          error={error}
          empty="No workflow templates are available in this scope."
          items={templates}
          selectedKey={selectedTemplateKey}
          getKey={(item) => item.key}
          itemTestId={(item) => `workflow-template-${item.key}`}
          isDisabled={(item) => item.status !== "active"}
          onSelect={onTemplateChange}
          renderItem={(item, selected) => (
            <TemplateOption item={item} selected={selected} />
          )}
        />
      ) : null}
      {mode === "blueprint" ? (
        <SelectionList
          title="Current approved Blueprints"
          description="Use the explicitly current approved revision for this organization. Historical revisions remain available in the registry."
          loading={blueprintsLoading}
          error={error}
          empty="No approved Blueprints are available in this scope."
          items={blueprints}
          selectedKey={selectedBlueprintKey}
          getKey={(item) => item.blueprintId}
          onSelect={onBlueprintChange}
          renderItem={(item, selected) => (
            <BlueprintOption item={item} selected={selected} />
          )}
        />
      ) : null}
      {mode === "manual" ? (
        <Card className={unavailableCardClassName}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Describe the outcome <AvailabilityBadge />
            </CardTitle>
            <CardDescription>
              AI-generated workflows are not available yet. Use an active
              Template or an approved Blueprint.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}

function ConfigureStage({
  name,
  description,
  mode,
  sourceTitle,
  currentScope,
  executionScopeId,
  units,
  onExecutionScopeChange,
  onNameChange,
  onDescriptionChange,
  onBack,
  onPreview,
  canPreview,
  error,
}: {
  name: string;
  description: string;
  mode: CreationMode | null;
  sourceTitle?: string;
  currentScope: string;
  executionScopeId: string;
  units: ReturnType<typeof useOrganization>["units"];
  onExecutionScopeChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onBack: () => void;
  onPreview: () => void;
  canPreview: boolean;
  error: Error | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configure workflow</CardTitle>
        <CardDescription>
          Give this workflow a human name and choose the organization scope it
          will execute against. Technical identifiers are generated for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
          <InfoItem
            label="Starting point"
            value={
              sourceTitle ??
              (mode === "manual" ? "Manual description" : "Not selected")
            }
          />
          <InfoItem label="Selected scope" value={currentScope} />
        </div>
        <div className="flex flex-col gap-5">
          <label
            className="flex flex-col gap-2 text-sm font-medium"
            htmlFor="workflow-name"
          >
            Workflow name
            <input
              data-testid="workflow-name"
              id="workflow-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Release readiness — Checkout"
              className="h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>
          <label
            className="flex flex-col gap-2 text-sm font-medium"
            htmlFor="workflow-description"
          >
            Purpose{" "}
            <span className="font-normal text-muted-foreground">Optional</span>
            <input
              id="workflow-description"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Explain what this workflow should investigate."
              className="h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>
        </div>
        <OrganizationUnitSelect
          id="workflow-execution-scope"
          testId="workflow-execution-scope"
          label="Organization scope"
          value={executionScopeId}
          units={units}
          filter={() => true}
          isDisabled={(unit) => !unit.canView}
          onChange={onExecutionScopeChange}
          required
          description="The workflow runs only against Sources visible in this scope."
        />
        {error ? <ErrorCallout message={error.message} /> : null}
        <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          <Button
            data-testid="workflow-preview-plan"
            disabled={!canPreview || !executionScopeId}
            onClick={onPreview}
          >
            {canPreview && executionScopeId
              ? "Preview plan"
              : "Choose a scope to continue"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewStage({
  preview,
  isLoading,
  error,
  runAfterApply,
  onRunChange,
  submitted,
  approved,
  completed,
  onSubmit,
  submitting,
  onCreateAndApprove,
  creatingAndApproving,
  onApprove,
  approving,
  onApply,
  applying,
  onBack,
  onOpenWorkflows,
}: {
  preview?: import("@encois/contracts").WorkflowCreationPreview;
  isLoading: boolean;
  error: Error | null;
  runAfterApply: boolean;
  onRunChange: (value: boolean) => void;
  submitted?: WorkflowPlanRecord;
  approved?: WorkflowPlanRecord;
  completed: boolean;
  onSubmit: () => void;
  submitting: boolean;
  onCreateAndApprove: () => void;
  creatingAndApproving: boolean;
  onApprove: () => void;
  approving: boolean;
  onApply: () => void;
  applying: boolean;
  onBack: () => void;
  onOpenWorkflows: () => void;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex min-h-72 items-center justify-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
          Validating the plan against scope and capabilities…
        </CardContent>
      </Card>
    );
  }

  if (error && !preview) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <ErrorCallout message={error.message} />
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" />
            Change configuration
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!preview) return null;

  const finalPlan = approved ?? submitted;
  const planStatus = completed
    ? "applied"
    : (approved?.status ?? submitted?.status);
  const missingRequiredProvider = preview.providerBindings.some(
    (binding) => binding.required && binding.status === "missing",
  );
  return (
    <Card data-testid="workflow-review-stage">
      <CardHeader>
        <CardTitle>Review and apply</CardTitle>
        <CardDescription>
          Preview is read-only. Submit stores a reviewable plan, approval
          records the human decision, and apply writes the Blueprint registry or
          starts a Run.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error ? <ErrorCallout message={error.message} /> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem label="Source" value={preview.source.title} />
          <InfoItem
            label="Steps"
            value={String(preview.blueprint.steps?.length ?? 0)}
          />
          <InfoItem
            label="Blueprint approval"
            value={preview.approvalRequired ? "Required" : "Not required"}
          />
          <InfoItem
            label="Plan state"
            value={planStatusLabel(planStatus ?? "preview")}
          />
        </div>

        <ProviderBindingList
          bindings={preview.providerBindings}
          completed={completed}
        />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Execution topology</h3>
          {preview.blueprint.steps.map((step, index) => (
            <div
              key={step.id}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {stepLabel(step.kind, index)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {step.dependsOn?.length
                    ? `After ${step.dependsOn.length} prerequisite${step.dependsOn.length === 1 ? "" : "s"}`
                    : "Can start from the resolved scope"}
                </span>
              </span>
              <DescriptionPill>{step.kind}</DescriptionPill>
            </div>
          ))}
        </div>

        <details className="rounded-lg border bg-muted/20 p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Technical details
          </summary>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
            <p>Blueprint version: {preview.blueprint.version}</p>
            <p>Purpose: {preview.blueprint.purpose}</p>
            <p>
              Capabilities:{" "}
              {preview.requiredCapabilities?.length
                ? preview.requiredCapabilities.join(", ")
                : "None declared"}
            </p>
          </div>
        </details>

        {preview.warnings.filter(
          (warning) =>
            !completed ||
            !warning.toLowerCase().includes("not persisted until"),
        ).length ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="font-medium">
              {finalPlan ? "Apply notes" : "Before you apply"}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {preview.warnings
                .filter(
                  (warning) =>
                    !completed ||
                    !warning.toLowerCase().includes("not persisted until"),
                )
                .map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
            </ul>
          </div>
        ) : null}
        {missingRequiredProvider ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-medium">
                A required provider Source is missing
              </p>
              <p className="mt-1 text-destructive/80">
                Add a matching Source in the selected organization unit scope
                before submitting this plan.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link
                to="/organization/sources/new"
                search={{ sourceType: "integration" }}
              >
                <PlugZap data-icon="inline-start" />
                Add Source
              </Link>
            </Button>
          </div>
        ) : null}

        {!finalPlan ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium">After approval</p>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                data-testid="workflow-save-approved"
                type="radio"
                checked={!runAfterApply}
                onChange={() => onRunChange(false)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">
                  Save as an approved workflow
                </span>
                <span className="block text-muted-foreground">
                  Create the Blueprint now and start it later.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                checked={runAfterApply}
                onChange={() => onRunChange(true)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">Run after apply</span>
                <span className="block text-muted-foreground">
                  Start the first investigation after the registry snapshot is
                  applied.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        {planStatus === "proposed" ? (
          <div
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"
          >
            <p className="font-medium">Plan submitted for approval</p>
            <p className="mt-1 text-muted-foreground">
              A workflow manager must approve this plan before the Blueprint can
              be persisted.
            </p>
          </div>
        ) : null}
        {planStatus === "approved" ? (
          <div
            data-testid="workflow-plan-approved"
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"
          >
            <p className="font-medium">Plan approved</p>
            <p className="mt-1 text-muted-foreground">
              Apply will persist the immutable Blueprint revision
              {runAfterApply ? " and request its first Run" : ""}.
            </p>
          </div>
        ) : null}

        {completed ? (
          <div
            data-testid="workflow-plan-applied"
            className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm"
          >
            <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
            <div>
              <p className="font-medium">Change Plan applied</p>
              <p className="mt-1 text-muted-foreground">
                The immutable Blueprint is now available to the Coordinator.{" "}
                {runAfterApply
                  ? "The first Run is starting; open Workflows to follow it."
                  : "Open Workflows when you are ready to start a Run."}
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={Boolean(finalPlan)}
          >
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          {completed ? (
            <Button data-testid="workflow-open-list" onClick={onOpenWorkflows}>
              Open workflows <ArrowRight data-icon="inline-end" />
            </Button>
          ) : creatingAndApproving ? (
            <Button disabled>
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
              Creating and approving…
            </Button>
          ) : !submitted ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={onSubmit}
                disabled={
                  submitting || creatingAndApproving || missingRequiredProvider
                }
              >
                {submitting ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Check data-icon="inline-start" />
                )}
                {submitting
                  ? "Creating…"
                  : missingRequiredProvider
                    ? "Configure Source first"
                    : "Create plan"}
              </Button>
              <Button
                data-testid="workflow-create-and-approve"
                onClick={onCreateAndApprove}
                disabled={
                  submitting || creatingAndApproving || missingRequiredProvider
                }
              >
                {creatingAndApproving ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <CheckCircle2 data-icon="inline-start" />
                )}
                {creatingAndApproving
                  ? "Creating and approving…"
                  : "Create and approve plan now"}
              </Button>
            </div>
          ) : planStatus === "proposed" ? (
            <Button onClick={onApprove} disabled={approving}>
              {approving ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Check data-icon="inline-start" />
              )}
              {approving ? "Approving…" : "Approve plan"}
            </Button>
          ) : (
            <Button
              data-testid="workflow-apply-plan"
              onClick={onApply}
              disabled={applying || planStatus !== "approved"}
            >
              {applying ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {applying ? "Applying…" : "Apply plan"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderBindingList({
  bindings,
  completed,
}: {
  bindings: readonly import("@encois/contracts").WorkflowProviderBindingProjection[];
  completed: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
      <div>
        <h3 className="text-sm font-semibold">Provider bindings</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Each requirement is resolved server-side through an organization
          Integration and a matching Source in the selected scope.
        </p>
      </div>
      {bindings.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {bindings.map((binding) => {
            const ready = binding.status === "ready";
            return (
              <div
                key={binding.slotKey}
                className={cn(
                  "rounded-md border p-3",
                  ready ? "border-emerald-500/30" : "border-amber-500/30",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{binding.slotKey}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {binding.required ? "Required" : "Optional"} ·{" "}
                      {binding.capabilities.join(", ") ||
                        "No capability constraint"}
                    </p>
                  </div>
                  <StatusPill
                    status={ready ? "resolved" : "missing"}
                    label={ready ? "Resolved" : "Missing"}
                    className="text-[11px] font-medium"
                  />
                </div>
                {ready ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {binding.integrationName ??
                      binding.provider ??
                      "Active provider Source"}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-amber-700">
                    {completed
                      ? binding.required
                        ? "This required binding was not resolved."
                        : "This optional slot will be skipped by the runtime."
                      : "Add a matching active Source before applying this plan."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No external provider bindings are required by this source.
        </p>
      )}
    </div>
  );
}

function SelectionList<T>({
  title,
  description,
  loading,
  error,
  empty,
  items,
  selectedKey,
  getKey,
  itemTestId,
  isDisabled,
  onSelect,
  renderItem,
}: {
  title: string;
  description: string;
  loading: boolean;
  error: Error | null;
  empty: string;
  items: readonly T[];
  selectedKey?: string;
  getKey: (item: T) => string;
  itemTestId?: (item: T) => string;
  isDisabled?: (item: T) => boolean;
  onSelect: (key: string) => void;
  renderItem: (item: T, selected: boolean) => ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading available options…
          </div>
        ) : error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error.message}
          </p>
        ) : items.length === 0 ? (
          <EmptyPanel
            icon={GitBranch}
            title="Nothing available"
            description={empty}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item) => {
              const key = getKey(item);
              const disabled = isDisabled?.(item) ?? false;
              return (
                <CardButton
                  key={key}
                  data-testid={itemTestId?.(item)}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(key)}
                  className={cn(
                    "h-full gap-3 p-4",
                    selectedKey === key &&
                      "border-foreground bg-accent/40 ring-2 ring-foreground/10",
                    disabled && unavailableCardClassName,
                  )}
                  aria-pressed={selectedKey === key}
                >
                  {renderItem(item, selectedKey === key)}
                </CardButton>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateOption({
  item,
  selected,
}: {
  item: WorkflowTemplateProjection;
  selected: boolean;
}) {
  const disabled = item.status !== "active";
  return (
    <>
      <span className="flex w-full items-start justify-between gap-3">
        <span>
          <span className="block font-medium">{item.title}</span>
          <span className="mt-1 block text-xs uppercase tracking-wide text-muted-foreground">
            {item.category}
          </span>
        </span>
        {disabled ? (
          <AvailabilityBadge label="Disabled" />
        ) : selected ? (
          <CheckCircle2 className="size-5" />
        ) : null}
      </span>
      <span className="block text-sm text-muted-foreground">
        {item.description}
      </span>
      <span className="mt-auto flex flex-wrap gap-1.5">
        {item.requiredCapabilities.slice(0, 4).map((capability) => (
          <DescriptionPill key={capability} className="text-[11px]">
            {capability}
          </DescriptionPill>
        ))}
      </span>
    </>
  );
}

function BlueprintOption({
  item,
  selected,
}: {
  item: WorkflowBlueprintProjection;
  selected: boolean;
}) {
  return (
    <>
      <span className="flex w-full items-start justify-between gap-3">
        <span>
          <span className="block font-medium">{item.name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Version {item.version} · {item.status}
          </span>
        </span>
        {selected ? <CheckCircle2 className="size-5" /> : null}
      </span>
      <span className="block text-sm text-muted-foreground">
        {item.purpose}
      </span>
      <span className="mt-auto block text-xs text-muted-foreground">
        {item.steps?.length ?? 0} steps ·{" "}
        {item.requiresApproval ? "Approval required" : "Read-only plan"}
      </span>
    </>
  );
}

function StepIndicator({
  number,
  label,
  active,
  complete,
}: {
  number: string;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
        active && "border-foreground bg-accent/50",
        complete && "border-emerald-500/40",
      )}
    >
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium",
          complete && "bg-emerald-500 text-white",
        )}
      >
        {complete ? <Check className="size-4" /> : number}
      </span>
      <span className={cn(active ? "font-medium" : "text-muted-foreground")}>
        {label}
      </span>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function ErrorCallout({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

function stepLabel(kind: string, index: number): string {
  if (kind === WorkflowStepKind.Tool) return `Evidence collection ${index + 1}`;
  if (kind === WorkflowStepKind.Agent)
    return `Specialist synthesis ${index + 1}`;
  if (kind === WorkflowStepKind.Approval) return `Human approval ${index + 1}`;
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} step ${index + 1}`;
}

function planStatusLabel(
  status: WorkflowPlanRecord["status"] | "preview",
): string {
  if (status === "preview") return "Preview only";
  if (status === "proposed") return "Awaiting approval";
  if (status === "approved") return "Approved · ready to apply";
  if (status === "applied") return "Applied";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

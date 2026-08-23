import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Check, GitBranch, ListChecks, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getOrganization, listWorkflowBlueprints, listWorkflowTemplates, startOrganizationOnboarding, updateOrganizationOnboarding } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/onboarding/workflows')({
  component: WorkflowRecommendationsPage,
})

function WorkflowRecommendationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const organization = useQuery({ queryKey: queryKeys.organization(), queryFn: getOrganization })
  const templates = useQuery({ queryKey: queryKeys.workflowTemplates('onboarding-catalog'), queryFn: () => listWorkflowTemplates({}) })
  const blueprints = useQuery({ queryKey: queryKeys.workflowBlueprints(), queryFn: listWorkflowBlueprints })
  const [selected, setSelected] = useState<string[]>()

  const catalog = useMemo(() => [
    ...(templates.data ?? []).map((template) => ({ value: template.key, title: template.title, description: template.description, meta: `Template · ${template.category} · v${template.version}`, icon: BookOpen })),
    ...(blueprints.data ?? []).filter((blueprint) => blueprint.status === 'approved' && blueprint.isCurrent).map((blueprint) => ({ value: blueprint.blueprintId, title: blueprint.name, description: blueprint.purpose, meta: `Blueprint · v${blueprint.version}`, icon: GitBranch })),
  ], [blueprints.data, templates.data])
  const selectedWorkflows = selected ?? organization.data?.onboarding.selectedWorkflows ?? []
  const catalogValues = useMemo(() => new Set(catalog.map((item) => item.value)), [catalog])
  const unknownSelections = selectedWorkflows.filter((value) => !catalogValues.has(value))
  const finish = useMutation({
    mutationFn: async () => {
      await updateOrganizationOnboarding({ coordinationMode: CoordinationMode.StartCoordinator, selectedWorkflows })
      return startOrganizationOnboarding()
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.organization() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows() }),
      ])
      await navigate({ to: '/' })
    },
  })

  if (organization.isLoading || templates.isLoading || blueprints.isLoading) return <p className="text-sm text-muted-foreground">Loading workflow catalog…</p>
  const loadingError = organization.error ?? templates.error ?? blueprints.error
  if (loadingError || !organization.data) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{loadingError?.message ?? 'The onboarding state could not be loaded.'}</p>

  function toggleWorkflow(value: string) {
    setSelected((current) => {
      const next = current ?? organization.data?.onboarding.selectedWorkflows ?? []
      return next.includes(value) ? next.filter((item) => item !== value) : [...next, value]
    })
  }

  function removeUnknownSelections() {
    setSelected(selectedWorkflows.filter((value) => catalogValues.has(value)))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Choose your first workflows</h1>
        <p className="mt-2 text-muted-foreground">Select published Templates or current approved Blueprints. The workspace stores these product references and resolves runtime identifiers in the control plane.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Available workflow catalog</CardTitle>
          <CardDescription>Choose the workflow definitions the Coordinator should prepare for this organization.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {catalog.length ? catalog.map((workflow) => {
            const selectedWorkflow = selectedWorkflows.includes(workflow.value)
            const Icon = workflow.icon
            return <button key={workflow.value} type="button" aria-pressed={selectedWorkflow} onClick={() => toggleWorkflow(workflow.value)} className={cn('flex items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent', selectedWorkflow && 'border-primary bg-accent')}><span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', selectedWorkflow && 'bg-primary text-primary-foreground')}><Icon className="size-5" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{workflow.title}</span><span className="mt-1 block text-sm text-muted-foreground">{workflow.description}</span><span className="mt-1 block text-xs text-muted-foreground">{workflow.meta}</span></span><span className={cn('flex size-5 shrink-0 items-center justify-center rounded-sm border', selectedWorkflow && 'border-primary bg-primary text-primary-foreground')}>{selectedWorkflow ? <Check className="size-3.5" aria-hidden="true" /> : null}</span></button>
          }) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No Templates or approved Blueprints are available in this organization scope.</p>}
          {unknownSelections.length ? <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>{unknownSelections.length} previously selected catalog reference{unknownSelections.length === 1 ? '' : 's'} is not currently available.</span><Button type="button" size="sm" variant="outline" onClick={removeUnknownSelections}>Remove unavailable</Button></div> : null}
        </CardContent>
      </Card>
      <Card className="border-dashed bg-muted/20">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background"><ListChecks className="size-4 text-muted-foreground" aria-hidden="true" /></span>
          <div><p className="font-medium">Workspace status: {organization.data.onboarding.status}</p><p className="mt-1 text-muted-foreground">Finishing setup starts the Coordinator workflow. The dashboard opens only after bootstrap reports ready.</p></div>
        </CardContent>
      </Card>
      {finish.isError ? <p className="text-sm text-destructive" role="alert">{finish.error.message}</p> : null}
      <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">{selectedWorkflows.length} workflow{selectedWorkflows.length === 1 ? '' : 's'} selected</p>
        <Button type="button" onClick={() => finish.mutate()} disabled={finish.isPending || selectedWorkflows.length === 0 || unknownSelections.length > 0}>{finish.isPending ? 'Starting setup…' : 'Finish setup'}<ArrowRight data-icon="inline-end" /></Button>
      </div>
    </div>
  )
}

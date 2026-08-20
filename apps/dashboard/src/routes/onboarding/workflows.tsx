import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Check, GitBranch, ListChecks, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getMockOnboardingState, updateMockOnboardingState } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/onboarding/workflows')({
  beforeLoad: () => {
    const state = getMockOnboardingState()
    if (!state?.workspaceName) throw redirect({ to: '/onboarding/workspace' })
    if (!state.memorySource) throw redirect({ to: '/onboarding/memory' })
  },
  component: WorkflowRecommendationsPage,
})

const workflowTemplates = [
  { id: 'release-readiness', name: 'Release readiness', description: 'Review delivery risk across issues, code changes, and release context.', icon: GitBranch, recommended: true },
  { id: 'release-candidate', name: 'Release candidate check', description: 'Prepare a focused summary before a release candidate is promoted.', icon: ShieldCheck, recommended: true },
  { id: 'delivery-health', name: 'Delivery health', description: 'Track blockers, stale work, and signals that need attention.', icon: ListChecks, recommended: false },
]

function WorkflowRecommendationsPage() {
  const navigate = useNavigate()
  const existing = getMockOnboardingState()
  const [selected, setSelected] = useState<string[]>(existing?.selectedWorkflows.length ? existing.selectedWorkflows : ['release-readiness', 'release-candidate'])

  function toggleWorkflow(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function handleFinish() {
    updateMockOnboardingState({ onboardingComplete: true, selectedWorkflows: selected, status: 'pending-initialization' })
    void navigate({ to: '/' })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Choose your first workflows</h1>
        <p className="mt-2 text-muted-foreground">These are standard templates. They stay pending until the workspace is initialized and can be changed later.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recommended for your workspace</CardTitle>
          <CardDescription>Select the workflows you want Encois to prepare first.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {workflowTemplates.map((workflow) => {
            const selectedWorkflow = selected.includes(workflow.id)
            const Icon = workflow.icon
            return (
              <button key={workflow.id} type="button" aria-pressed={selectedWorkflow} onClick={() => toggleWorkflow(workflow.id)} className={cn('flex items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent', selectedWorkflow && 'border-primary bg-accent')}>
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', selectedWorkflow && 'bg-primary text-primary-foreground')}><Icon className="size-5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{workflow.name}{workflow.recommended ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-secondary-foreground">Recommended</span> : null}</span><span className="mt-1 block text-sm text-muted-foreground">{workflow.description}</span></span>
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-sm border', selectedWorkflow && 'border-primary bg-primary text-primary-foreground')}><Check className="size-3.5" aria-hidden={!selectedWorkflow} /></span>
              </button>
            )
          })}
        </CardContent>
      </Card>
      <Card className="border-dashed bg-muted/20">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background"><GitBranch className="size-4 text-muted-foreground" aria-hidden="true" /></span>
          <div><p className="font-medium">Workspace status: pending initialization</p><p className="mt-1 text-muted-foreground">After you finish, the dashboard will show the Coordinator and these workflows as pending setup.</p></div>
        </CardContent>
      </Card>
      <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">{selected.length} workflow{selected.length === 1 ? '' : 's'} selected</p>
        <Button type="button" onClick={handleFinish} disabled={selected.length === 0}>
          Finish setup and open dashboard
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

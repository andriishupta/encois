import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleDashed, Clock3, GitBranch, Play, RefreshCw, RotateCcw, TimerReset } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { WorkflowCanvas } from '@/components/workflow-canvas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getWorkflow } from '@/lib/api'

export const Route = createFileRoute('/_app/workflows/$workflowId')({
  component: WorkflowDetailPage,
})

const workflowSteps = [
  { name: 'Resolve Blueprint context', type: 'Activity', status: 'Waiting for input', icon: CircleDashed },
  { name: 'Collect source evidence', type: 'Tool activity', status: 'Pending', icon: Clock3 },
  { name: 'Synthesize context', type: 'Agent activity', status: 'Pending', icon: Play },
] as const

function WorkflowDetailPage() {
  const { workflowId } = Route.useParams()
  const workflow = useQuery({ queryKey: ['workflow', workflowId], queryFn: () => getWorkflow(workflowId), refetchInterval: 30_000 })
  const status = workflow.data?.status ?? (workflow.isLoading ? 'loading' : 'unavailable')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Blueprint execution" description="Workflow execution detail and the evidence collection lifecycle." actions={<Button disabled>Run workflow</Button>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Status" value={status} icon={CircleDashed} />
        <SummaryCard label="Workflow ID" value={workflowId} icon={GitBranch} mono />
        <SummaryCard label="Run ID" value={workflow.data?.runId ?? 'Not available'} icon={RotateCcw} />
        <SummaryCard label="Transitions" value="—" icon={TimerReset} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Workflow canvas</CardTitle>
            <CardDescription>Execution graph for the generic Blueprint.</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            <span>Auto-refresh every 30s</span>
          </div>
        </CardHeader>
        <CardContent>
          <WorkflowCanvas refreshCount={workflow.dataUpdatedAt} lastPolledAt={workflow.dataUpdatedAt ? new Date(workflow.dataUpdatedAt) : null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Execution steps</CardTitle>
          <CardDescription>Temporal activities and specialist work will be rendered here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {workflowSteps.map((step, index) => {
            const Icon = step.icon
            return (
              <div key={step.name} className="flex items-start gap-3 rounded-lg border p-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{index + 1}</div>
                <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{step.name}</p>
                  <p className="text-xs text-muted-foreground">{step.type}</p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{step.status}</span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence and event history</CardTitle>
          <CardDescription>Source references, timestamps, retries, and state transitions will appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            No event history loaded.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  mono = false,
}: {
  label: string
  value: string
  icon: typeof GitBranch
  mono?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <p className={mono ? 'truncate font-mono text-sm' : 'truncate text-sm font-medium'}>{value}</p>
      </CardContent>
    </Card>
  )
}

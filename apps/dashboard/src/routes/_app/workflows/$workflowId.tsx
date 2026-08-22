import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CircleDashed, GitBranch, RefreshCw, RotateCcw, TimerReset } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { WorkflowCanvas } from '@/components/workflow-canvas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getWorkflow } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/_app/workflows/$workflowId')({
  component: WorkflowDetailPage,
})

function WorkflowDetailPage() {
  const { workflowId } = Route.useParams()
  const workflow = useQuery({ queryKey: queryKeys.workflow(workflowId), queryFn: () => getWorkflow(workflowId), refetchInterval: 30_000 })
  const status = workflow.data?.status ?? (workflow.isLoading ? 'loading' : 'unavailable')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={<><ProductTerm term="blueprint" /> execution</>} description={<><ProductTerm term="workflow" /> execution detail and the <ProductTerm term="evidence" /> collection lifecycle.</>} actions={<Button disabled>Run workflow</Button>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Status" value={status} icon={CircleDashed} />
        <SummaryCard label="Workflow ID" value={workflowId} icon={GitBranch} mono />
        <SummaryCard label="Run ID" value={workflow.data?.runId ?? 'Not available'} icon={RotateCcw} />
        <SummaryCard label="Transitions" value="—" icon={TimerReset} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle><ProductTerm term="workflow" /> canvas</CardTitle>
            <CardDescription>Topology preview for the generic <ProductTerm term="blueprint" />. Step-level state is not exposed by the current projection.</CardDescription>
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
          <CardDescription><ProductTerm term="temporal" /> activities and specialist work will appear after the Gateway exposes workflow events.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyPanel icon={CircleDashed} title="Step projection is not available" description="The current API returns workflow identity and status, but not Temporal activity or evidence events." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><ProductTerm term="evidence" /> and event history</CardTitle>
          <CardDescription>Source references, timestamps, retries, and state transitions will appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyPanel icon={CircleDashed} title="Event history is not available" description={<><ProductTerm term="evidence" /> references, retries, and state transitions need a dedicated Gateway projection endpoint.</>} />
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

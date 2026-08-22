import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { WorkflowExecutionStatus, type WorkflowStatusReason } from '@encois/contracts'
import { Activity, ArrowUpRight, CircleDashed, Clock3, GitBranch, Plus } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyPanel } from '@/components/empty-panel'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listWorkflows } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/_app/workflows/')({
  component: WorkflowsPage,
})

function WorkflowsPage() {
  const workflows = useQuery({ queryKey: queryKeys.workflows(), queryFn: listWorkflows })
  const hasWorkflows = Boolean(workflows.data?.length)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={<ProductTerm term="workflow" plural />}
        description={<>Track <ProductTerm term="blueprint" plural /> executions, delegated agents, and <ProductTerm term="workflow" /> progress.</>}
        actions={
          <Button asChild>
            <Link to="/workflows/new">
              <Plus data-icon="inline-start" />
              New workflow
            </Link>
          </Button>
        }
      />
      {workflows.isLoading ? <p className="text-sm text-muted-foreground">Loading workflows…</p> : null}
      {workflows.isError ? <Card><CardContent className="pt-6 text-sm text-destructive">Could not load workflows: {workflows.error.message}</CardContent></Card> : null}
      {hasWorkflows ? <div className="grid gap-4">{workflows.data?.map((workflow) => <WorkflowPreviewCard key={workflow.workflowId} id={workflow.workflowId} title={workflow.blueprintId ?? workflow.workflowType} status={workflow.status} statusReason={workflow.statusReason} description="Current workflow status and progress." icon={workflow.status === WorkflowExecutionStatus.Completed ? Activity : GitBranch} />)}</div> : null}
      {!workflows.isLoading && !workflows.isError && !hasWorkflows ? <Card>
        <CardContent className="pt-6">
          <EmptyPanel icon={CircleDashed} title="No workflows yet" description={<>Start a <ProductTerm term="blueprint" /> execution to create the first durable <ProductTerm term="workflow" />.</>} />
        </CardContent>
      </Card> : null}
    </div>
  )
}

function WorkflowPreviewCard({
  id,
  title,
  status,
  statusReason,
  description,
  icon: Icon,
}: {
  id: string
  title: string
  status: WorkflowExecutionStatus
  statusReason?: WorkflowStatusReason
  description: string
  icon: typeof GitBranch
}) {
  return (
    <Link to="/workflows/$workflowId" params={{ workflowId: id }} className="group">
      <Card className="transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <CardTitle className="truncate">{title}</CardTitle>
              <CardDescription className="truncate">{description}</CardDescription>
            </div>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="rounded-full bg-secondary px-2 py-1 text-secondary-foreground">{formatStatus(status, statusReason)}</span>
          <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" aria-hidden="true" />Last run unavailable</span>
          <span className="truncate font-mono">{id}</span>
        </CardContent>
      </Card>
    </Link>
  )
}

function formatStatus(status: WorkflowExecutionStatus, statusReason?: WorkflowStatusReason): string {
  return statusReason ? `${status} · ${statusReason.replaceAll('_', ' ')}` : status
}

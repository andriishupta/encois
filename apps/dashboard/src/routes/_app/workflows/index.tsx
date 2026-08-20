import { createFileRoute, Link } from '@tanstack/react-router'
import { Activity, ArrowUpRight, CircleDashed, Clock3, GitBranch, Plus } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyPanel } from '@/components/empty-panel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/workflows/')({
  component: WorkflowsPage,
})

function WorkflowsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Workflows"
        description="Track investigations, delegated agents, and workflow progress."
        actions={
          <Button asChild>
            <Link to="/workflows/new">
              <Plus data-icon="inline-start" />
              New workflow
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4">
        <WorkflowPreviewCard id="release-risk-aug-30" title="Release risk investigation" status="Waiting for input" description="Checks release readiness across Jira, GitHub, and monitoring signals." icon={GitBranch} />
        <WorkflowPreviewCard id="deployment-regression-001" title="Deployment regression" status="Completed" description="Correlates a deployment change with operational health signals." icon={Activity} />
      </div>
      <Card>
        <CardContent className="pt-6">
          <EmptyPanel icon={CircleDashed} title="More workflows will appear here" description="These two entries are static UI previews. The real list will come from the Gateway API." />
        </CardContent>
      </Card>
    </div>
  )
}

function WorkflowPreviewCard({
  id,
  title,
  status,
  description,
  icon: Icon,
}: {
  id: string
  title: string
  status: string
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
          <span className="rounded-full bg-secondary px-2 py-1 text-secondary-foreground">{status}</span>
          <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" aria-hidden="true" />Last run unavailable</span>
          <span className="truncate font-mono">{id}</span>
        </CardContent>
      </Card>
    </Link>
  )
}

import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowUpRight, CheckCircle2, Github, Plus, PlugZap } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyPanel } from '@/components/empty-panel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/integrations/')({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Integrations"
        description="Manage the systems Encois can read from and normalize into evidence."
        actions={<Button asChild><Link to="/integrations/new"><Plus data-icon="inline-start" />Add integration</Link></Button>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <IntegrationPreviewCard id="github" name="GitHub" description="Repositories, pull requests, reviews, and deployments." icon={Github} connected />
        <IntegrationPreviewCard id="jira" name="Jira" description="Projects, issues, releases, and delivery signals." icon={PlugZap} />
        <IntegrationPreviewCard id="google-workspace" name="Google Workspace" description="Documents, calendars, and organizational context." icon={PlugZap} />
      </div>
      <Card>
        <CardContent className="pt-6">
          <EmptyPanel icon={PlugZap} title="Connector catalog is not active" description="These entries are static UI previews. Credentials and provider permissions will be handled by the Agent Gateway." />
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationPreviewCard({
  id,
  name,
  description,
  icon: Icon,
  connected = false,
}: {
  id: string
  name: string
  description: string
  icon: typeof PlugZap
  connected?: boolean
}) {
  return (
    <Link to="/integrations/$integrationId" params={{ integrationId: id }} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span>
            <div className="flex flex-col gap-1.5"><CardTitle>{name}</CardTitle><CardDescription>{description}</CardDescription></div>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5" aria-hidden="true" /><span>{connected ? 'Preview connected' : 'Not connected'}</span><span className="ml-auto font-mono">{id}</span>
        </CardContent>
      </Card>
    </Link>
  )
}

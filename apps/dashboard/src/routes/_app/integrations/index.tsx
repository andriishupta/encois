import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, CheckCircle2, Github, Plus, PlugZap } from 'lucide-react'
import { IntegrationStatus, type IntegrationProjection } from '@encois/contracts'
import { PageHeader } from '@/components/page-header'
import { EmptyPanel } from '@/components/empty-panel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listIntegrations } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/_app/integrations/')({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const integrations = useQuery({ queryKey: queryKeys.integrations(), queryFn: listIntegrations })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Integrations"
        description="Manage the systems Encois can read from and normalize into evidence."
        actions={<Button asChild><Link to="/integrations/new"><Plus data-icon="inline-start" />Add integration</Link></Button>}
      />
      {integrations.isLoading ? <p className="text-sm text-muted-foreground">Loading integrations…</p> : null}
      {integrations.isError ? <Card><CardContent className="pt-6 text-sm text-destructive">Could not load integrations: {integrations.error.message}</CardContent></Card> : null}
      {integrations.data?.length ? <div className="grid gap-4 md:grid-cols-2">{integrations.data.map((integration) => <IntegrationPreviewCard key={integration.id} integration={integration} />)}</div> : null}
      {!integrations.isLoading && !integrations.isError && !integrations.data?.length ? <Card>
        <CardContent className="pt-6">
          <EmptyPanel icon={PlugZap} title="No integrations in scope" description="The Gateway returned no integrations visible to this organization scope." />
        </CardContent>
      </Card> : null}
    </div>
  )
}

function IntegrationPreviewCard({
  integration,
}: {
  integration: IntegrationProjection
}) {
  const Icon = integration.provider.toLowerCase() === 'github' ? Github : PlugZap
  return (
    <Link to="/integrations/$integrationId" params={{ integrationId: integration.id }} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border bg-muted/30"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span>
              <div className="flex flex-col gap-1.5"><CardTitle>{integration.name}</CardTitle><CardDescription>{integration.provider}</CardDescription></div>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </CardHeader>
          <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
          {integration.status === IntegrationStatus.Active ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <PlugZap className="size-3.5" aria-hidden="true" />}<span>{integration.status}</span><span className="ml-auto font-mono">{integration.id}</span>
        </CardContent>
      </Card>
    </Link>
  )
}

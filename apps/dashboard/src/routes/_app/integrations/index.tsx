import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, CheckCircle2, Github, Plus, PlugZap, RefreshCw } from 'lucide-react'
import { IntegrationStatus, type IntegrationProjection } from '@encois/contracts'
import { PageHeader } from '@/components/page-header'
import { EmptyPanel } from '@/components/empty-panel'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listIntegrations } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'
import { useCan } from '@/lib/permissions'
import { humanizeKey, shortIdentifier } from '@/lib/formatters'

const providerCatalog = [
  { key: 'github', name: 'GitHub', description: 'Repositories, pull requests, and delivery activity.', capabilities: ['code.read', 'pull-requests.read', 'activity.read'] },
  { key: 'gitlab', name: 'GitLab', description: 'Repositories, merge requests, and delivery activity.', capabilities: ['code.read', 'pull-requests.read', 'activity.read'] },
  { key: 'jira', name: 'Jira', description: 'Issues, projects, and operational activity.', capabilities: ['issues.read', 'activity.read'] },
  { key: 'linear', name: 'Linear', description: 'Issues and project execution context.', capabilities: ['issues.read', 'activity.read'] },
  { key: 'slack', name: 'Slack', description: 'Read-only message and activity context.', capabilities: ['messages.read', 'activity.read'] },
  { key: 'google-drive', name: 'Google Drive', description: 'Scoped documents for project context.', capabilities: ['documents.read'] },
] as const

export const Route = createFileRoute('/_app/integrations/')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsRead)) throw redirect({ to: '/forbidden' })
  },
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const integrations = useQuery({ queryKey: queryKeys.integrations(), queryFn: listIntegrations })
  const canManage = useCan(Permission.IntegrationsManage)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={<ProductTerm term="integration" plural />}
        description={<>Manage the systems Encois can read from and normalize into <ProductTerm term="evidence" />.</>}
        actions={canManage ? <Button asChild><Link to="/integrations/new"><Plus data-icon="inline-start" />Add integration</Link></Button> : <span className="text-xs text-muted-foreground">Read-only access</span>}
      />
      {integrations.isLoading ? <p className="text-sm text-muted-foreground">Loading integrations…</p> : null}
      {integrations.isError ? <Card><CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-destructive">Could not load integrations: {integrations.error.message}</p><Button type="button" variant="outline" onClick={() => void integrations.refetch()}><RefreshCw data-icon="inline-start" />Retry</Button></CardContent></Card> : null}
      {integrations.data?.length ? <div className="grid gap-4 md:grid-cols-2">{integrations.data.map((integration) => <IntegrationPreviewCard key={integration.id} integration={integration} />)}</div> : null}
      {!integrations.isLoading && !integrations.isError && !integrations.data?.length ? <Card>
        <CardContent className="pt-6">
          <EmptyPanel icon={PlugZap} title={<>No <ProductTerm term="integration" plural /> in <ProductTerm term="scope" /></>} description={<>No connected integrations are available in your current <ProductTerm term="scope" />.</>} />
        </CardContent>
      </Card> : null}
      {canManage ? <Card>
        <CardHeader>
          <CardTitle>Integration catalog</CardTitle>
          <CardDescription>Supported read-only providers. Registering one creates a pending connection; authorization is completed by the deployment’s provider adapter.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {providerCatalog.map((provider) => {
            const connected = integrations.data?.filter((integration) => integration.provider.toLowerCase() === provider.key) ?? []
            return <div key={provider.key} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{provider.name}</p><p className="mt-1 text-xs text-muted-foreground">{provider.description}</p></div><span className="rounded-full bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">{connected.length ? `${connected.length} registered` : 'Available'}</span></div><p className="mt-3 text-[11px] text-muted-foreground">Read scopes: {provider.capabilities.join(' · ')}</p><Button className="mt-4" variant="outline" size="sm" asChild><Link to="/integrations/new">Register {provider.name}</Link></Button></div>
          })}
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
          {integration.status === IntegrationStatus.Active ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <PlugZap className="size-3.5" aria-hidden="true" />}<span>{humanizeKey(integration.status)}</span><span className="ml-auto">Technical ID: <span className="font-mono">{shortIdentifier(integration.id)}</span></span>
        </CardContent>
      </Card>
    </Link>
  )
}

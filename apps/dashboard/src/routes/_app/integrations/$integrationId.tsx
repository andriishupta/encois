import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, Clock3, Github, PlugZap, Save, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/integrations/$integrationId')({
  component: IntegrationDetailPage,
})

function IntegrationDetailPage() {
  const { integrationId } = Route.useParams()
  const [enabled, setEnabled] = useState(integrationId === 'github')
  const Icon = integrationId === 'github' ? Github : PlugZap
  const providerName = integrationId === 'github' ? 'GitHub' : integrationId === 'jira' ? 'Jira' : 'Google Workspace'

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/integrations">
            <ArrowLeft data-icon="inline-start" />
            Integrations
          </Link>
        </Button>
        <span>/</span>
        <span className="font-mono">{integrationId}</span>
      </div>

      <PageHeader title={providerName} description="Provider connection, scope, and read permissions." actions={<Button disabled><Save data-icon="inline-start" />Save changes</Button>} />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={Icon} label="Provider" value={providerName} />
        <SummaryCard icon={enabled ? CheckCircle2 : PlugZap} label="Status" value={enabled ? 'Enabled' : 'Disabled'} />
        <SummaryCard icon={Clock3} label="Last sync" value="Not available" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Connection settings</CardTitle>
            <CardDescription>These controls are local UI state until the control plane is connected.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="display-name">
              Display name
              <input id="display-name" defaultValue={providerName} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="sync-frequency">
              Sync frequency
              <select id="sync-frequency" defaultValue="on-demand" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <option value="on-demand">On demand</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
              </select>
            </label>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">Read-only access</p>
                  <p className="text-xs text-muted-foreground">Write actions stay disabled in the MVP.</p>
                </div>
              </div>
              <span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">Enforced</span>
            </div>
            <button type="button" aria-pressed={enabled} onClick={() => setEnabled((value) => !value)} className="flex items-center justify-between gap-4 rounded-lg border p-3 text-left transition-colors hover:bg-accent">
              <div>
                <p className="text-sm font-medium">Integration enabled</p>
                <p className="text-xs text-muted-foreground">Toggle only changes this local preview.</p>
              </div>
              <span className={enabled ? 'rounded-full bg-primary px-2 py-1 text-xs text-primary-foreground' : 'rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground'}>{enabled ? 'Enabled' : 'Disabled'}</span>
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Permission scope</CardTitle>
            <CardDescription>Effective organization scope for provider reads.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Organization scope</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">acme/*</p>
            </div>
            <p className="text-sm text-muted-foreground">Credentials are intentionally not shown in the browser. The Agent Gateway will resolve them at execution time.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof PlugZap
  label: string
  value: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <p className="truncate text-sm font-medium">{value}</p>
      </CardContent>
    </Card>
  )
}

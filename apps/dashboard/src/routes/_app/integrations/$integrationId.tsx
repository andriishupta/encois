import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IntegrationStatus, type IntegrationUpdateRequest } from '@encois/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, Clock3, Github, PlugZap, Save, ShieldCheck } from 'lucide-react'
import { EmptyPanel } from '@/components/empty-panel'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listIntegrations, updateIntegration } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/_app/integrations/$integrationId')({
  component: IntegrationDetailPage,
})

function IntegrationDetailPage() {
  const { integrationId } = Route.useParams()
  const queryClient = useQueryClient()
  const integrations = useQuery({ queryKey: queryKeys.integrations(), queryFn: listIntegrations })
  const integration = integrations.data?.find((item) => item.id === integrationId)
  const mutation = useMutation({
    mutationFn: (input: IntegrationUpdateRequest) => updateIntegration(integrationId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.integrations() })
    },
  })

  if (integrations.isLoading) return <p className="text-sm text-muted-foreground">Loading integration…</p>
  if (integrations.isError) return <Card><CardContent className="pt-6 text-sm text-destructive">Could not load integration: {integrations.error.message}</CardContent></Card>
  if (!integration) return <Card><CardContent className="pt-6"><EmptyPanel icon={PlugZap} title="Integration not found" description="This integration is not visible in the current organization scope." /></CardContent></Card>

  const Icon = integration.provider.toLowerCase() === 'github' ? Github : PlugZap
  const providerName = integration.provider

  function saveChanges(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const displayName = String(form.get('displayName') ?? '').trim()
    const status = String(form.get('status') ?? '')
    const input: IntegrationUpdateRequest = {
      ...(displayName ? { displayName } : {}),
      ...(Object.values(IntegrationStatus).includes(status as IntegrationStatus) ? { status: status as IntegrationStatus } : {}),
    }
    if (Object.keys(input).length > 0) mutation.mutate(input)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`${providerName} integration`} description={<>Provider connection, <ProductTerm term="scope" />, and read permissions.</>} />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={Icon} label="Provider" value={providerName} />
        <SummaryCard icon={integration.status === IntegrationStatus.Active ? CheckCircle2 : PlugZap} label="Status" value={integration.status} />
        <SummaryCard icon={Clock3} label="Last sync" value="Not available yet" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Connection settings</CardTitle>
            <CardDescription>Connection details are managed securely. Provider credentials are never shown here.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-5" onSubmit={saveChanges}>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="display-name">
                Display name
                <input id="display-name" name="displayName" defaultValue={integration.name} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="integration-status">
                Status
                <select id="integration-status" name="status" defaultValue={integration.status} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  {Object.values(IntegrationStatus).map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">Read-only provider access</p>
                    <p className="text-xs text-muted-foreground">External write tools remain disabled in the MVP.</p>
                  </div>
                </div>
                <span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">Enforced</span>
              </div>
              {mutation.isError ? <p className="text-sm text-destructive">Could not save changes: {mutation.error.message}</p> : null}
              {mutation.isSuccess ? <p className="text-sm text-muted-foreground">Changes saved.</p> : null}
              <div className="flex justify-end border-t pt-5">
                <Button type="submit" disabled={mutation.isPending}>
                  <Save data-icon="inline-start" />
                  {mutation.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Permission <ProductTerm term="scope" /></CardTitle>
            <CardDescription>Effective organization <ProductTerm term="scope" /> for provider reads.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">Organization <ProductTerm term="scope" /></p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">Resolved securely</p>
            </div>
            <p className="text-sm text-muted-foreground">Credentials are intentionally not shown in the browser and are handled securely.</p>
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

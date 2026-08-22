import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, PlugZap, Save } from 'lucide-react'
import { Permission, type IntegrationCreateRequest } from '@encois/contracts'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createIntegration } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { queryKeys } from '@/lib/query-keys'
import { useOrganization } from '@/lib/organization-context'

export const Route = createFileRoute('/_app/integrations/new')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.IntegrationsManage)) throw redirect({ to: '/forbidden' })
  },
  component: NewIntegrationPage,
})

function NewIntegrationPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { units, currentUnitId } = useOrganization()
  const [displayName, setDisplayName] = useState('')
  const [provider, setProvider] = useState('github')
  const [organizationUnitId, setOrganizationUnitId] = useState('')
  const [grantedScopes, setGrantedScopes] = useState<string[]>(['code.read', 'pull-requests.read', 'activity.read'])
  const mutation = useMutation({
    mutationFn: (input: IntegrationCreateRequest) => createIntegration(input),
    onSuccess: async (integration) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.integrations() })
      await navigate({ to: '/integrations/$integrationId', params: { integrationId: integration.id } })
    },
  })

  useEffect(() => {
    if (organizationUnitId) return
    const preferred = currentUnitId !== 'organization' ? currentUnitId : units.find((unit) => unit.parentId === null)?.id
    if (preferred) setOrganizationUnitId(preferred)
  }, [currentUnitId, organizationUnitId, units])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate({ displayName: displayName.trim(), provider, organizationUnitId, grantedScopes })
  }

  const providerScopes: Record<string, readonly string[]> = {
    github: ['code.read', 'pull-requests.read', 'activity.read'],
    gitlab: ['code.read', 'pull-requests.read', 'activity.read'],
    jira: ['issues.read', 'activity.read'],
    linear: ['issues.read', 'activity.read'],
    slack: ['messages.read', 'activity.read'],
    'google-drive': ['documents.read'],
  }

  function changeProvider(nextProvider: string) {
    setProvider(nextProvider)
    setGrantedScopes([...(providerScopes[nextProvider] ?? [])])
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Register integration" description={<>Register a provider connection and bind it to an organization <ProductTerm term="scope" />. Credentials are never entered into the dashboard.</>} actions={<Button variant="outline" asChild><Link to="/integrations"><ArrowLeft data-icon="inline-start" />Back to integrations</Link></Button>} />
      <Card className="max-w-3xl">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-md border bg-muted/30"><PlugZap className="size-5 text-muted-foreground" aria-hidden="true" /></div>
          <CardTitle>Connection registration</CardTitle>
          <CardDescription>This creates a pending, auditable integration record. Provider OAuth or secret provisioning is a separate step and must be completed before ingestion.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-6" onSubmit={submit}>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="integration-name">Display name<input id="integration-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="GitHub Engineering" required minLength={2} maxLength={160} className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="integration-provider">Provider<select id="integration-provider" value={provider} onChange={(event) => changeProvider(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option value="github">GitHub</option><option value="gitlab">GitLab</option><option value="jira">Jira</option><option value="linear">Linear</option><option value="slack">Slack</option><option value="google-drive">Google Drive</option></select></label>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="integration-scope"><ProductTerm term="scope" /><select id="integration-scope" value={organizationUnitId} onChange={(event) => setOrganizationUnitId(event.target.value)} required disabled={units.length === 0} className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"><option value="" disabled>Select an organization unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><span className="text-xs font-normal text-muted-foreground">Members can only use this integration where their existing permissions allow access.</span></label>
            <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">Read capabilities</legend>
              <p className="text-xs text-muted-foreground">These capabilities are recorded on the binding and used by workflow provider preflight. Write capabilities are not available here.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(providerScopes[provider] ?? []).map((scope) => <label key={scope} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={grantedScopes.includes(scope)} onChange={(event) => setGrantedScopes((current) => event.target.checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope))} />{scope}</label>)}
              </div>
            </fieldset>
            {mutation.isError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not register integration: {mutation.error.message}</div> : null}
            <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4 text-sm"><CheckCircle2 className="mt-0.5 size-4 text-primary" aria-hidden="true" /><div><p className="font-medium">Read-only by default</p><p className="mt-1 text-muted-foreground">This registration does not grant write access to GitHub, Jira, Slack, or any other provider.</p></div></div>
            <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between"><Button variant="ghost" asChild><Link to="/integrations">Cancel</Link></Button><Button type="submit" disabled={mutation.isPending || !organizationUnitId}>{mutation.isPending ? 'Registering…' : <><Save data-icon="inline-start" />Register pending integration</>}</Button></div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

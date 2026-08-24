import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileText, LoaderCircle, PlugZap, Save, Upload } from 'lucide-react'
import { IntegrationStatus, KnowledgeSourceKind, Permission, type KnowledgeSourceCreateRequest } from '@encois/contracts'
import { PageHeader } from '@/components/page-header'
import { OrganizationUnitSelect } from '@/components/organization-unit-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { createKnowledgeSource, isApiError, listIntegrations, startSourceIngestion, uploadKnowledgeSourcePdf } from '@/lib/api'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { useOrganization } from '@/lib/organization-context'
import { queryKeys } from '@/lib/query-keys'

export const Route = createFileRoute('/_app/organization/sources/new')({
  validateSearch: (search: Record<string, unknown>) => ({
    sourceType: search.sourceType === KnowledgeSourceKind.Integration ? KnowledgeSourceKind.Integration : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.KnowledgeManage)) throw redirect({ to: '/forbidden' })
  },
  component: NewSourcePage,
})

function NewSourcePage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const { units, currentUnitId } = useOrganization()
  const selectedScopeUnitId = units.some((unit) => unit.id === currentUnitId) ? currentUnitId : undefined
  const integrations = useQuery({ queryKey: queryKeys.integrations(selectedScopeUnitId), queryFn: () => listIntegrations({ scopeUnitId: selectedScopeUnitId }) })
  const [kind, setKind] = useState<KnowledgeSourceKind>(() => search.sourceType === KnowledgeSourceKind.Integration ? KnowledgeSourceKind.Integration : KnowledgeSourceKind.UploadedDocument)
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [integrationId, setIntegrationId] = useState('')
  const [readScopeId, setReadScopeId] = useState('')
  const [visibilityScopeId, setVisibilityScopeId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scopeOptions = useMemo(() => units.filter((unit) => unit.canManage), [units])
  const activeIntegrations = useMemo(() => integrations.data?.filter((integration) => integration.status === IntegrationStatus.Active && integration.credentialConfigured) ?? [], [integrations.data])
  const selectedIntegration = activeIntegrations.find((integration) => integration.id === integrationId)

  useEffect(() => {
    if (readScopeId && visibilityScopeId) return
    const preferred = currentUnitId !== 'organization' && scopeOptions.some((unit) => unit.id === currentUnitId)
      ? currentUnitId
      : scopeOptions.find((unit) => unit.parentId === null)?.id ?? scopeOptions[0]?.id ?? ''
    if (!readScopeId) setReadScopeId(preferred)
    if (!visibilityScopeId) setVisibilityScopeId(preferred)
  }, [currentUnitId, readScopeId, scopeOptions, visibilityScopeId])

  useEffect(() => {
    if (!integrationId && activeIntegrations[0]) setIntegrationId(activeIntegrations[0].id)
  }, [activeIntegrations, integrationId])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setError('A source name is required.')
      return
    }
    if (!readScopeId || !visibilityScopeId) {
      setError('Choose both a read scope and a visibility scope.')
      return
    }
    if (kind === KnowledgeSourceKind.UploadedDocument && !file) {
      setError('Choose a PDF before saving the source.')
      return
    }
    if (kind === KnowledgeSourceKind.Integration && !selectedIntegration) {
      setError('Choose an authorized Integration before creating this source.')
      return
    }

    setSaving(true)
    setError(null)
    const scopes = { readScope: { ids: [readScopeId] }, visibilityScope: { ids: [visibilityScopeId] } }
    try {
      if (kind === KnowledgeSourceKind.UploadedDocument && file) {
        const uploaded = await uploadKnowledgeSourcePdf(file, name, scopes)
        await startSourceIngestion(uploaded.source.id, uploaded.revision.id)
        await navigate({ to: '/organization/sources/$sourceId', params: { sourceId: uploaded.source.id } })
        return
      }
      const input: KnowledgeSourceCreateRequest = {
        name: name.trim(),
        kind: KnowledgeSourceKind.Integration,
        provider: selectedIntegration?.provider,
        integrationId: selectedIntegration?.id,
        ...scopes,
      }
      const source = await createKnowledgeSource(input)
      await navigate({ to: '/organization/sources/$sourceId', params: { sourceId: source.id } })
    } catch (cause) {
      setError(isApiError(cause) ? cause.message : 'The source could not be created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Add Source" description={<>Create a provider-backed Source or upload an immutable document. The Source keeps its Integration, read scope, visibility scope, and revision history.</>} actions={<Button variant="outline" asChild><Link to="/organization/sources"><ArrowLeft data-icon="inline-start" />Back to Sources</Link></Button>} />
      <form className="max-w-3xl" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <div className="flex size-10 items-center justify-center rounded-md border bg-muted/30">{kind === KnowledgeSourceKind.Integration ? <PlugZap className="size-5 text-muted-foreground" aria-hidden="true" /> : <FileText className="size-5 text-muted-foreground" aria-hidden="true" />}</div>
            <CardTitle>Source configuration</CardTitle>
            <CardDescription>These scopes are enforced before the Source or its ingestion workflow is created.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-kind">Source type<Select id="source-kind" value={kind} onChange={(event) => setKind(event.target.value as KnowledgeSourceKind)} options={[{ value: KnowledgeSourceKind.UploadedDocument, label: 'Uploaded document' }, { value: KnowledgeSourceKind.Integration, label: 'Integration Source' }]} /></label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-name">Source name<Input id="source-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === KnowledgeSourceKind.Integration ? 'GitHub Engineering context' : 'Project architecture'} maxLength={120} required /></label>

            {kind === KnowledgeSourceKind.Integration ? <div className="flex flex-col gap-2"><label className="flex flex-col gap-2 text-sm font-medium" htmlFor="source-integration">Authorized Integration<Select id="source-integration" value={integrationId} onChange={(event) => setIntegrationId(event.target.value)} disabled={integrations.isLoading || integrations.isError || activeIntegrations.length === 0} required options={[{ value: '', label: integrations.isLoading ? 'Loading integrations…' : integrations.isError ? 'Integrations unavailable' : 'Select an authorized integration', disabled: true }, ...activeIntegrations.map((integration) => ({ value: integration.id, label: `${integration.name} · ${integration.provider}` }))]} /></label>{integrations.isError ? <p role="alert" className="text-xs text-destructive">Could not load integrations: {integrations.error.message}</p> : null}{!integrations.isLoading && !integrations.isError && !activeIntegrations.length ? <p className="text-xs text-amber-700">No authorized active Integration is available. Register and authorize one before creating a provider-backed Source.</p> : null}</div> : <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors hover:bg-accent" htmlFor="source-file"><span className="flex size-10 items-center justify-center rounded-full bg-muted"><Upload className="size-5" aria-hidden="true" /></span><span className="text-sm font-medium">{file?.name ?? 'Choose a PDF'}</span><span className="text-xs text-muted-foreground">PDF · maximum 10 MiB</span><input id="source-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => setFile(event.target.files?.[0])} /></label>}

            <div className="grid gap-5 sm:grid-cols-2">
              <OrganizationUnitSelect id="source-read-scope" label="Read scope" value={readScopeId} units={units} isDisabled={(unit) => !unit.canManage} onChange={setReadScopeId} required />
              <OrganizationUnitSelect id="source-visibility-scope" label="Visibility scope" value={visibilityScopeId} units={units} isDisabled={(unit) => !unit.canManage} onChange={setVisibilityScopeId} required />
            </div>
            <p className="text-xs text-muted-foreground">Read scope controls what ingestion may access. Visibility scope controls who can discover the normalized Source and its evidence.</p>
            {kind === KnowledgeSourceKind.Integration ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p className="font-medium">Provider authorization remains explicit</p><p className="mt-1 text-muted-foreground">Creating this Source does not copy credentials or enable write access. Ingestion will remain unavailable until the organization Integration has valid provider credentials.</p></div> : null}
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between"><Button variant="ghost" asChild><Link to="/organization/sources">Cancel</Link></Button><Button type="submit" disabled={saving || !readScopeId || !visibilityScopeId || (kind === KnowledgeSourceKind.Integration && (!selectedIntegration || integrations.isLoading))}>{saving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}{saving ? 'Saving…' : kind === KnowledgeSourceKind.Integration ? 'Create Source' : 'Upload and ingest'}</Button></div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

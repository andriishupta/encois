import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { BookOpen, Check, CircleAlert, GitBranch, Radio, RefreshCw, Save, SlidersHorizontal, Sparkles } from 'lucide-react'
import type { OrganizationOnboardingProjection } from '@encois/contracts'
import { CoordinationMode, Permission } from '@encois/contracts'
import { PageHeader } from '@/components/page-header'
import { ProductTerm, setProductTooltipsEnabled, useProductTooltipsEnabled } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthSession, hasPermission, isDashboardMockMode } from '@/lib/auth'
import { listWorkflowBlueprints, listWorkflowTemplates, updateOrganizationOnboarding } from '@/lib/api'
import { updateMockOnboardingState } from '@/lib/onboarding'
import { useOrganization } from '@/lib/organization-context'
import { usePermissions } from '@/lib/permissions'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace, workspaceQueryKey } from '@/lib/workspace'

export const Route = createFileRoute('/_app/settings/workspace')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.SettingsRead)) throw redirect({ to: '/forbidden' })
  },
  component: WorkspaceSettingsPage,
})

function WorkspaceSettingsPage() {
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const { onboarding, organizationName, isLoading, isUsingApi, error } = useOrganization()
  const { can } = usePermissions()
  const mockMode = isDashboardMockMode()
  const [name, setName] = useState(workspace?.workspaceName ?? '')
  const [scope, setScope] = useState('Organization-wide')
  const [preference, setPreference] = useState('Evidence first')
  const [saved, setSaved] = useState(false)
  const productTooltipsEnabled = useProductTooltipsEnabled()

  useEffect(() => {
    if (workspace?.workspaceName) setName(workspace.workspaceName)
  }, [workspace?.workspaceName])

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mockMode) return
    queryClient.setQueryData(workspaceQueryKey(), updateMockOnboardingState({ workspaceName: name }))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Workspace settings" description={mockMode ? 'Define local development defaults for investigations in this workspace.' : `Organization-managed defaults for ${organizationName ?? 'this workspace'}.`} />
      {!mockMode && error ? <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Workspace organization state could not be loaded: {error}</span></div> : null}
      {!mockMode && isLoading ? <p className="text-sm text-muted-foreground">Loading organization-managed workspace state…</p> : null}
      {!mockMode ? <div role="status" className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">Workspace name, scope, and investigation defaults are managed by the organization control plane. Onboarding configuration can be edited below when your session has the required permission.</div> : null}
      <form className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]" onSubmit={saveSettings}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />Workspace</CardTitle>
            <CardDescription>{mockMode ? 'These preferences apply to the current organization scope.' : 'Workspace preferences are managed by your organization.'}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="settings-workspace-name">Workspace name<input id="settings-workspace-name" value={name} onChange={(event) => setName(event.target.value)} disabled={!mockMode} className={inputClassName} /></label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="settings-scope">Default scope<select id="settings-scope" value={scope} onChange={(event) => setScope(event.target.value)} disabled={!mockMode} className={inputClassName}><option>Organization-wide</option><option>Engineering</option><option>Selected projects</option></select></label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="settings-preference">Default investigation preference<select id="settings-preference" value={preference} onChange={(event) => setPreference(event.target.value)} disabled={!mockMode} className={inputClassName}><option>Evidence first</option><option>Fast summary</option><option>Deep investigation</option></select></label>
            <div className="flex justify-end"><Button type="submit" disabled={!mockMode}>{saved ? <><Check data-icon="inline-start" />Saved locally</> : mockMode ? <><Save data-icon="inline-start" />Save local defaults</> : 'Managed by organization'}</Button></div>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader><CardTitle>Default investigation preferences</CardTitle><CardDescription>These are starting defaults. Each investigation can use a narrower scope.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {['Show evidence and freshness', 'Include delegated agent steps', 'Surface unresolved input early'].map((item) => <div key={item} className="flex items-center gap-3 rounded-lg border px-3 py-3 text-sm"><span className="flex size-5 items-center justify-center rounded-full bg-muted"><Check className="size-3.5 text-muted-foreground" aria-hidden="true" /></span>{item}</div>)}
            <div className="mt-2 border-t pt-5">
              <p className="text-sm font-medium">Product term explanations</p>
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm" htmlFor="settings-product-tooltips">
                <input id="settings-product-tooltips" type="checkbox" checked={productTooltipsEnabled} onChange={(event) => setProductTooltipsEnabled(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                <span>
                  <span className="block font-medium">Explain product terms on hover</span>
                  <span className="mt-1 block text-xs text-muted-foreground">Show definitions for terms such as <ProductTerm term="coordinator" /> and <ProductTerm term="knowledgeSource" />. This preference is saved in this browser.</span>
                </span>
              </label>
            </div>
          </CardContent>
        </Card>
      </form>

      {isUsingApi && onboarding ? <OnboardingConfigurationCard onboarding={onboarding} canManage={can(Permission.OnboardingManage)} canReadCatalog={can(Permission.WorkflowsRead)} /> : null}
    </div>
  )
}

function OnboardingConfigurationCard({ onboarding, canManage, canReadCatalog }: { onboarding: OrganizationOnboardingProjection; canManage: boolean; canReadCatalog: boolean }) {
  const queryClient = useQueryClient()
  const templates = useQuery({ queryKey: queryKeys.workflowTemplates('onboarding-catalog'), queryFn: () => listWorkflowTemplates({}), enabled: canReadCatalog, staleTime: 60_000 })
  const blueprints = useQuery({ queryKey: queryKeys.workflowBlueprints(), queryFn: listWorkflowBlueprints, enabled: canReadCatalog, staleTime: 30_000 })
  const [mode, setMode] = useState(onboarding.coordinationMode)
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>([...onboarding.selectedWorkflows])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setMode(onboarding.coordinationMode)
    setSelectedWorkflows([...onboarding.selectedWorkflows])
  }, [onboarding.coordinationMode, onboarding.selectedWorkflows])

  const catalog = useMemo(() => ({
    templates: (templates.data ?? []).map((template) => ({ value: template.key, title: template.title, description: template.description, meta: `Template · ${template.category} · v${template.version}`, icon: BookOpen })),
    blueprints: (blueprints.data ?? []).filter((blueprint) => blueprint.status === 'approved' && blueprint.isCurrent).map((blueprint) => ({ value: blueprint.blueprintId, title: blueprint.name, description: blueprint.purpose, meta: `Blueprint · v${blueprint.version}`, icon: GitBranch })),
  }), [blueprints.data, templates.data])
  const catalogValues = useMemo(() => new Set([...catalog.templates, ...catalog.blueprints].map((item) => item.value)), [catalog.blueprints, catalog.templates])
  const catalogReady = canReadCatalog && !templates.isLoading && !blueprints.isLoading && !templates.isError && !blueprints.isError
  const unknownSelections = catalogReady ? selectedWorkflows.filter((value) => !catalogValues.has(value)) : []
  const selectionChanged = onboarding.coordinationMode !== mode || (catalogReady && (onboarding.selectedWorkflows.length !== selectedWorkflows.length || onboarding.selectedWorkflows.some((value, index) => value !== selectedWorkflows[index])))
  const save = useMutation({
    mutationFn: () => updateOrganizationOnboarding(catalogReady ? { coordinationMode: mode, selectedWorkflows } : { coordinationMode: mode }),
    onSuccess: async () => {
      setSaved(true)
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization() })
    },
  })

  function toggleSelection(value: string) {
    setSaved(false)
    setSelectedWorkflows((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  }

  function removeUnknownSelections() {
    setSaved(false)
    setSelectedWorkflows((current) => current.filter((value) => catalogValues.has(value)))
  }

  const catalogError = templates.error?.message ?? blueprints.error?.message
  const catalogLoading = templates.isLoading || blueprints.isLoading
  const isInitializing = onboarding.status === 'initializing'

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />Workspace initialization</CardTitle>
            <CardDescription>Choose how the organization Coordinator should begin and which product catalog entries it should prepare.</CardDescription>
          </div>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">{onboardingStatusLabel(onboarding.status)}</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {!canManage ? <div role="status" className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">You can view the current initialization state, but changing it requires <code className="rounded bg-muted px-1 py-0.5 text-xs">onboarding:manage</code>. The browser never supplies Coordinator or Temporal runtime IDs.</div> : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <ModeOption selected={mode === CoordinationMode.StartCoordinator} onClick={() => { setSaved(false); setMode(CoordinationMode.StartCoordinator) }} disabled={!canManage || isInitializing} icon={Sparkles} title="Start the Coordinator" description="Recommended. Start an audited Coordinator run after the catalog choices are saved." />
          <ModeOption selected={mode === CoordinationMode.ConnectOnly} onClick={() => { setSaved(false); setMode(CoordinationMode.ConnectOnly) }} disabled={!canManage || isInitializing} icon={Radio} title="Connect sources only" description="Save the organization setup and leave the Coordinator stopped until an administrator starts it." />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><h3 className="text-sm font-medium">Initial workflow catalog</h3><p className="mt-1 text-xs text-muted-foreground">Select published Templates or current approved Blueprints. These are product references; runtime IDs are resolved by the control plane.</p></div>
            <span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{selectedWorkflows.length} selected</span>
          </div>
          {!canReadCatalog ? <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Workflow catalog visibility is restricted by the current session. An administrator with workflow read access can configure the initial selection.</div> : null}
          {canReadCatalog && catalogLoading ? <p className="text-sm text-muted-foreground">Loading Templates and Blueprints…</p> : null}
          {canReadCatalog && catalogError ? <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-destructive">The initialization catalog could not be loaded: {catalogError}</p><Button type="button" size="sm" variant="outline" onClick={() => { void templates.refetch(); void blueprints.refetch() }}><RefreshCw data-icon="inline-start" />Retry</Button></div> : null}
          {canReadCatalog && !catalogLoading && !catalogError ? <div className="grid gap-3 md:grid-cols-2"><CatalogGroup title="Templates" items={catalog.templates} selected={selectedWorkflows} onToggle={toggleSelection} disabled={!canManage || isInitializing} /><CatalogGroup title="Approved Blueprints" items={catalog.blueprints} selected={selectedWorkflows} onToggle={toggleSelection} disabled={!canManage || isInitializing} /></div> : null}
          {unknownSelections.length ? <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>{unknownSelections.length} previously selected catalog reference{unknownSelections.length === 1 ? '' : 's'} is not currently available. Remove it explicitly before saving this configuration.</span>{canManage ? <Button type="button" size="sm" variant="outline" onClick={removeUnknownSelections}>Remove unavailable</Button> : null}</div> : null}
        </div>

        {save.error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Could not save initialization settings: {save.error.message}</p> : null}
        {saved ? <p role="status" className="rounded-md border border-primary/30 bg-primary/[0.05] p-3 text-sm text-primary">Initialization settings saved. The Dashboard will show the next available Coordinator action.</p> : null}
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{isInitializing ? 'Initialization is already in progress. Wait for the current control-plane operation to finish.' : 'Saving changes returns the organization to Pending until initialization is explicitly started.'}</p>
          <Button type="button" onClick={() => save.mutate()} disabled={!canManage || isInitializing || save.isPending || !selectionChanged || unknownSelections.length > 0}>{save.isPending ? 'Saving…' : saved ? 'Saved' : 'Save initialization settings'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

type CatalogItem = { value: string; title: string; description: string; meta: string; icon: typeof BookOpen }

function CatalogGroup({ title, items, selected, onToggle, disabled }: { title: string; items: readonly CatalogItem[]; selected: readonly string[]; onToggle: (value: string) => void; disabled: boolean }) {
  return <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p><span className="text-xs text-muted-foreground">{items.length}</span></div>{items.length ? items.map((item) => <CatalogOption key={item.value} item={item} selected={selected.includes(item.value)} onToggle={onToggle} disabled={disabled} />) : <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No available {title.toLowerCase()} in the current scope.</p>}</div>
}

function CatalogOption({ item, selected, onToggle, disabled }: { item: CatalogItem; selected: boolean; onToggle: (value: string) => void; disabled: boolean }) {
  const Icon = item.icon
  return <button type="button" aria-pressed={selected} disabled={disabled} onClick={() => onToggle(item.value)} className={`flex min-w-0 items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-primary bg-primary/[0.05]' : 'bg-background'}`}><span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span><span className="mt-1 block text-[11px] text-muted-foreground">{item.meta}</span></span><span className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-sm border ${selected ? 'border-primary bg-primary text-primary-foreground' : ''}`}>{selected ? <Check className="size-3.5" aria-hidden="true" /> : null}</span></button>
}

function ModeOption({ selected, onClick, disabled, icon: Icon, title, description }: { selected: boolean; onClick: () => void; disabled: boolean; icon: typeof Sparkles; title: string; description: string }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} disabled={disabled} className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-primary bg-accent' : 'bg-background'}`}><span className={`flex size-9 shrink-0 items-center justify-center rounded-md ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span><span className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : ''}`}>{selected ? <Check className="size-3" aria-hidden="true" /> : null}</span></button>
}

function onboardingStatusLabel(status: OrganizationOnboardingProjection['status']): string {
  return { pending: 'Pending', initializing: 'Initializing', ready: 'Ready', failed: 'Needs attention' }[status]
}

const inputClassName = 'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50'

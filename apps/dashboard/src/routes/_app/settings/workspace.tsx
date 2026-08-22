import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Check, Save, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ProductTerm, setProductTooltipsEnabled, useProductTooltipsEnabled } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthSession, hasPermission, isDashboardMockMode } from '@/lib/auth'
import { Permission } from '@encois/contracts'
import { updateMockOnboardingState } from '@/lib/onboarding'
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
  const mockMode = isDashboardMockMode()
  const [name, setName] = useState(workspace?.workspaceName ?? '')
  const [scope, setScope] = useState('Organization-wide')
  const [preference, setPreference] = useState('Evidence first')
  const [saved, setSaved] = useState(false)
  const productTooltipsEnabled = useProductTooltipsEnabled()

  function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mockMode) return
    queryClient.setQueryData(workspaceQueryKey, updateMockOnboardingState({ workspaceName: name }))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Workspace settings" description="Define the name, scope, and default behavior for investigations in this workspace." />
      <form className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]" onSubmit={saveSettings}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />Workspace</CardTitle>
            <CardDescription>{mockMode ? 'These preferences apply to the current organization scope.' : 'Workspace preferences are managed by your organization.'}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="settings-workspace-name">Workspace name<input id="settings-workspace-name" value={name} onChange={(event) => setName(event.target.value)} className={inputClassName} /></label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="settings-scope">Default scope<select id="settings-scope" value={scope} onChange={(event) => setScope(event.target.value)} className={inputClassName}><option>Organization-wide</option><option>Engineering</option><option>Selected projects</option></select></label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="settings-preference">Default investigation preference<select id="settings-preference" value={preference} onChange={(event) => setPreference(event.target.value)} className={inputClassName}><option>Evidence first</option><option>Fast summary</option><option>Deep investigation</option></select></label>
            <div className="flex justify-end"><Button type="submit" disabled={!mockMode}>{saved ? <><Check data-icon="inline-start" />Saved</> : <><Save data-icon="inline-start" />Save changes</>}</Button></div>
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
    </div>
  )
}

const inputClassName = 'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50'

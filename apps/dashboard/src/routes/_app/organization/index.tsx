import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2, ChevronRight, Plus, ShieldCheck, Users } from 'lucide-react'
import { OrganizationCanvas } from '@/components/organization-canvas'
import { PageHeader } from '@/components/page-header'
import { ProductTerm } from '@/components/product-term'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  flattenUnitOptions,
  formatUnitPath,
  getOrganizationUnit,
  getUnitPath,
  humanizeUnitType,
  type OrganizationUnitType,
} from '@/lib/organization'
import { useOrganization } from '@/lib/organization-context'

export const Route = createFileRoute('/_app/organization/')({
  component: OrganizationPage,
})

const unitTypes: OrganizationUnitType[] = ['department', 'team', 'project', 'service', 'custom']

function OrganizationPage() {
  const { units, createUnit, currentUnitId, setCurrentUnitId, isLoading, error } = useOrganization()
  const [addUnitOpen, setAddUnitOpen] = useState(false)
  const [newUnitName, setNewUnitName] = useState('')
  const [newUnitType, setNewUnitType] = useState<OrganizationUnitType>('team')
  const [newParentId, setNewParentId] = useState('organization')
  const [newRelation, setNewRelation] = useState<'child' | 'sibling'>('child')

  const selectedUnit = getOrganizationUnit(units, currentUnitId) ?? units[0]
  const unitOptions = flattenUnitOptions(units)

  function openAddUnit(unitId = currentUnitId) {
    setNewParentId(unitId)
    setNewRelation('child')
    setAddUnitOpen(true)
  }

  async function addUnit() {
    const name = newUnitName.trim()
    if (!name) return

    const selectedParent = getOrganizationUnit(units, newParentId)
    if (newRelation === 'sibling' && selectedParent?.parentId === null) return
    const parentId = newRelation === 'sibling' ? selectedParent?.parentId ?? null : newParentId
    const created = await createUnit({ parentId, type: newUnitType, name })
    setCurrentUnitId(created.id)
    setNewUnitName('')
    setAddUnitOpen(false)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Organization"
        description={<>Explore the organization-owned visibility tree and manage <ProductTerm term="organizationUnit" plural /> within your <ProductTerm term="scope" />.</>}
        actions={(
          <Button type="button" onClick={() => openAddUnit()}>
            <Plus data-icon="inline-start" />
            Add unit
          </Button>
        )}
      />

      <div className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-muted-foreground"><span className="font-medium text-foreground">Organization administrator surface.</span> Units and direct membership permissions are stored by the Gateway and inherited through child units.</p>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading organization scope…</p> : null}
      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle><ProductTerm term="organizationUnit" plural /></CardTitle>
            <CardDescription>Parent and child relationships are shown from top to bottom. Select a unit to inspect its <ProductTerm term="scope" />.</CardDescription>
          </CardHeader>
          <CardContent>
            <OrganizationCanvas units={units} selectedUnitId={currentUnitId} onSelectUnit={setCurrentUnitId} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {selectedUnit ? <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="size-4 text-muted-foreground" aria-hidden="true" />{selectedUnit.name}</CardTitle>
              <CardDescription>{formatUnitPath(units, selectedUnit.id)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{selectedUnit.description}</p>
              <div className="grid gap-2 text-sm">
                <DetailRow label="Unit type" value={humanizeUnitType(selectedUnit.type)} />
                <DetailRow label="Manager" value={selectedUnit.manager} />
                <DetailRow label="Members" value={String(selectedUnit.memberCount)} />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                <Button type="button" variant="outline" onClick={() => openAddUnit(selectedUnit.id)}><Plus data-icon="inline-start" />Add related unit</Button>
                <Button type="button" variant="outline" asChild><Link to="/organization/permissions"><Users data-icon="inline-start" />Manage permissions</Link></Button>
              </div>
            </CardContent>
          </Card> : <Card><CardHeader><CardTitle>Organization scope</CardTitle><CardDescription>The Gateway has not returned an organization projection.</CardDescription></CardHeader></Card>}

          {selectedUnit ? <Card>
            <CardHeader>
            <CardTitle><ProductTerm term="scope" /> inheritance</CardTitle>
              <CardDescription>Membership roots can include descendants; explicit restrictions will narrow the effective scope.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <ScopeRow label="Parent units" value={String(Math.max(0, getUnitPath(units, selectedUnit.id).length - 1))} />
              <ScopeRow label="Child units" value={String(units.filter((unit) => unit.parentId === selectedUnit.id).length)} />
              <ScopeRow label="Permission board" value="Available to administrators" />
            </CardContent>
          </Card> : null}
        </div>
      </div>

      {addUnitOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Add <ProductTerm term="organizationUnit" /></CardTitle>
            <CardDescription>Choose whether the new unit sits alongside the selected unit or below it as a child.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="unit-name">
                Unit name
                <input id="unit-name" value={newUnitName} onChange={(event) => setNewUnitName(event.target.value)} placeholder="e.g. Platform" className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="unit-type">
                Unit type
                <select id="unit-type" value={newUnitType} onChange={(event) => setNewUnitType(event.target.value as OrganizationUnitType)} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  {unitTypes.map((type) => <option key={type} value={type}>{humanizeUnitType(type)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="unit-relative-to">
                Relative to
                <select id="unit-relative-to" value={newParentId} onChange={(event) => { setNewParentId(event.target.value); if (event.target.value === 'organization') setNewRelation('child') }} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  {unitOptions.map(({ unit, depth }) => <option key={unit.id} value={unit.id}>{'— '.repeat(depth)}{unit.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="unit-relation">
                Placement
                <select id="unit-relation" value={newRelation} onChange={(event) => setNewRelation(event.target.value as 'child' | 'sibling')} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <option value="child">Child of selected unit</option>
                  <option value="sibling" disabled={newParentId === 'organization'}>Parallel to selected unit</option>
                </select>
              </label>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setAddUnitOpen(false)}>Cancel</Button>
              <Button type="button" onClick={() => { void addUnit() }} disabled={!newUnitName.trim()}>Create unit</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 border-b py-2 last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>
}

function ScopeRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2"><span className="text-muted-foreground">{label}</span><span className="text-right text-xs font-medium">{value}</span></div>
}

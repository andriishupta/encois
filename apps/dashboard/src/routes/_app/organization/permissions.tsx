import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, ChevronRight, LockKeyhole, Plus, ShieldCheck, UserRound, X } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  flattenUnitOptions,
  formatUnitPath,
  getEffectiveUnitIds,
  getManagedUnitIds,
  getOrganizationUnit,
  humanizeAccessLevel,
  type AccessLevel,
  type OrganizationMember,
  type OrganizationUnit,
  type UnitPermission,
} from '@/lib/organization'
import { useOrganization } from '@/lib/organization-context'

export const Route = createFileRoute('/_app/organization/permissions')({
  component: OrganizationPermissionsPage,
})

const accessLevels: AccessLevel[] = ['viewer', 'contributor', 'manager', 'admin']

function OrganizationPermissionsPage() {
  const { units, members, permissions, createPermission, updatePermission, removePermission, currentUnitId, isLoading, error } = useOrganization()
  const focusedUnit = getOrganizationUnit(units, currentUnitId)
  const focusedManager = members.find((member) => member.name === focusedUnit?.manager)
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [addPermissionOpen, setAddPermissionOpen] = useState(false)
  const [newUnitId, setNewUnitId] = useState(currentUnitId)
  const [newAccess, setNewAccess] = useState<AccessLevel>('viewer')
  useEffect(() => {
    if (members.some((member) => member.id === selectedMemberId)) return
    setSelectedMemberId(focusedManager?.id ?? members[0]?.id ?? '')
  }, [focusedManager?.id, members, selectedMemberId])
  useEffect(() => {
    if (units.some((unit) => unit.id === newUnitId)) return
    setNewUnitId(currentUnitId || units[0]?.id || '')
  }, [currentUnitId, newUnitId, units])

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? members[0]
  if (!selectedMember) return <p className="text-sm text-muted-foreground">No organization members are available.</p>
  const memberPermissions = permissions.filter((permission) => permission.memberId === selectedMember.id)
  const effectiveUnitIds = getEffectiveUnitIds(units, permissions, selectedMember.id)
  const effectiveUnits = units.filter((unit) => effectiveUnitIds.includes(unit.id))
  const managedUnitIds = getManagedUnitIds(units, permissions, selectedMember.id)
  const managedUnits = units.filter((unit) => managedUnitIds.includes(unit.id))
  const unitOptions = flattenUnitOptions(units)

  async function addPermission() {
    await createPermission({ memberId: selectedMember.id, unitId: newUnitId, access: newAccess })
    setAddPermissionOpen(false)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Organization permissions"
        description="Assign organization-unit access while keeping visibility scoped to the user’s effective tree."
        actions={<Button type="button" variant="outline" asChild><Link to="/organization"><ChevronRight className="rotate-180" data-icon="inline-start" />Organization tree</Link></Button>}
      />

      <div className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-muted-foreground"><span className="font-medium text-foreground">Gateway-backed permission board.</span> Direct membership scopes are stored in the control plane and inherited through descendant units.</p>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading organization permissions…</p> : null}
      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}

      {focusedUnit ? <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
        <div className="min-w-0"><p className="font-medium">Permission focus</p><p className="truncate text-xs text-muted-foreground">{formatUnitPath(units, focusedUnit.id)} · new scopes default to this unit</p></div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{focusedUnit.name}</span>
      </div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Organization members</CardTitle>
            <CardDescription>Select a person to inspect their scope.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {members.map((member) => <MemberRow key={member.id} member={member} selected={member.id === selectedMember.id} onSelect={() => setSelectedMemberId(member.id)} />)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><UserRound className="size-4 text-muted-foreground" aria-hidden="true" />{selectedMember.name}</CardTitle>
                <CardDescription>{selectedMember.email} · {selectedMember.role}</CardDescription>
              </div>
              <span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{selectedMember.status}</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium">Home unit</p>
              <p className="mt-1 text-muted-foreground">{formatUnitPath(units, selectedMember.homeUnitId)}</p>
            </div>

            <div className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Management scope</p>
                  <p className="mt-1 text-xs text-muted-foreground">Managers can administer their assigned unit and propagated descendants, never sibling branches.</p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{managedUnits.length ? 'Can manage' : 'Read-only'}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {managedUnits.length ? managedUnits.map((unit) => <span key={unit.id} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{unit.name}</span>) : <span className="text-xs text-muted-foreground">No manager or administrator scope assigned.</span>}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Direct permissions</h2>
                <p className="text-xs text-muted-foreground">Each direct scope includes all descendant units.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setAddPermissionOpen((value) => !value)}><Plus data-icon="inline-start" />Add scope</Button>
              </div>

              {memberPermissions.length ? memberPermissions.map((permission) => <PermissionRow key={permission.id} permission={permission} units={units} onAccessChange={(access) => { void updatePermission(permission.id, access) }} onRemove={() => { void removePermission(permission.id) }} />) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No direct permissions assigned.</p>}
            </div>

            {addPermissionOpen ? <AddPermissionForm unitOptions={unitOptions} unitId={newUnitId} access={newAccess} onUnitChange={setNewUnitId} onAccessChange={setNewAccess} onCancel={() => setAddPermissionOpen(false)} onSubmit={() => { void addPermission() }} /> : null}

            <div className="flex flex-col gap-3 border-t pt-5">
              <div>
                <h2 className="text-sm font-semibold">Effective visibility</h2>
                <p className="text-xs text-muted-foreground">Preview of units visible after descendant propagation.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {effectiveUnits.map((unit) => <span key={unit.id} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"><Check className="size-3" aria-hidden="true" />{unit.name}</span>)}
              </div>
              <p className="text-xs text-muted-foreground">A manager can manage their assigned unit and descendants, but does not receive access to sibling branches.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MemberRow({ member, selected, onSelect }: { member: OrganizationMember; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent ${selected ? 'border-primary bg-primary/[0.04]' : ''}`}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{member.initials}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{member.name}</span><span className="block truncate text-xs text-muted-foreground">{member.role}</span></span>
      <span className="hidden text-xs text-muted-foreground sm:block">{member.status}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

function PermissionRow({ permission, units, onAccessChange, onRemove }: { permission: UnitPermission; units: OrganizationUnit[]; onAccessChange: (access: AccessLevel) => void; onRemove: () => void }) {
  const unit = getOrganizationUnit(units, permission.unitId)
  if (!unit) return null

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><LockKeyhole className="size-4 text-muted-foreground" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{unit.name}</p><p className="truncate text-xs text-muted-foreground">{formatUnitPath(units, unit.id)}</p></div>
      <select value={permission.access} onChange={(event) => onAccessChange(event.target.value as AccessLevel)} aria-label={`${unit.name} access level`} className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{accessLevels.map((level) => <option key={level} value={level}>{humanizeAccessLevel(level)}</option>)}</select>
      <span className="text-xs text-muted-foreground">Includes descendants</span>
      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${unit.name} permission`} onClick={onRemove}><X className="size-4" /></Button>
    </div>
  )
}

function AddPermissionForm({ unitOptions, unitId, access, onUnitChange, onAccessChange, onCancel, onSubmit }: { unitOptions: { unit: OrganizationUnit; depth: number }[]; unitId: string; access: AccessLevel; onUnitChange: (value: string) => void; onAccessChange: (value: AccessLevel) => void; onCancel: () => void; onSubmit: () => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="permission-unit">Organization unit<select id="permission-unit" value={unitId} onChange={(event) => onUnitChange(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{unitOptions.map(({ unit, depth }) => <option key={unit.id} value={unit.id}>{'— '.repeat(depth)}{unit.name}</option>)}</select></label>
        <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="permission-access">Access level<select id="permission-access" value={access} onChange={(event) => onAccessChange(event.target.value as AccessLevel)} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{accessLevels.map((level) => <option key={level} value={level}>{humanizeAccessLevel(level)}</option>)}</select></label>
      </div>
      <p className="text-xs text-muted-foreground">This direct scope includes descendants below the selected unit.</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button type="button" onClick={onSubmit}>Add permission</Button></div>
    </div>
  )
}

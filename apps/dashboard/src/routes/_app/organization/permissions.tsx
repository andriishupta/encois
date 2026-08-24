import { useEffect, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Check, ChevronRight, CircleAlert, LockKeyhole, Plus, ShieldCheck, UserRound, X } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { OrganizationUnitSelect } from '@/components/organization-unit-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import {
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
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'

export const Route = createFileRoute('/_app/organization/permissions')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.OrganizationManage)) throw redirect({ to: '/forbidden' })
  },
  component: OrganizationPermissionsPage,
})

const accessLevels: AccessLevel[] = ['viewer', 'contributor', 'manager', 'admin']

function OrganizationPermissionsPage() {
  const { units, members, permissions, createPermission, updatePermission, removePermission, currentUnitId, isLoading, error } = useOrganization()
  const focusedUnit = getOrganizationUnit(units, currentUnitId)
  const focusedManager = members.find((member) => member.name === focusedUnit?.manager)
  const actor = members.find((member) => member.id === getAuthSession()?.userId)
  const canAssignAdministrator = actor?.roleKey === 'organization_admin' || actor?.roleKey === 'admin'
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [addPermissionOpen, setAddPermissionOpen] = useState(false)
  const [newUnitId, setNewUnitId] = useState(currentUnitId)
  const [newAccess, setNewAccess] = useState<AccessLevel>('viewer')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  useEffect(() => {
    if (members.some((member) => member.id === selectedMemberId)) return
    setSelectedMemberId(focusedManager?.id ?? members[0]?.id ?? '')
  }, [focusedManager?.id, members, selectedMemberId])
  useEffect(() => {
    if (units.some((unit) => unit.id === newUnitId && unit.canManage)) return
    setNewUnitId(units.find((unit) => unit.canManage)?.id ?? '')
  }, [newUnitId, units])

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? members[0]
  if (!selectedMember) return <p className="text-sm text-muted-foreground">No organization members are available.</p>
  const memberPermissions = permissions.filter((permission) => permission.memberId === selectedMember.id)
  const effectiveUnitIds = getEffectiveUnitIds(units, permissions, selectedMember.id)
  const effectiveUnits = units.filter((unit) => effectiveUnitIds.includes(unit.id))
  const managedUnitIds = getManagedUnitIds(units, permissions, selectedMember.id)
  const managedUnits = units.filter((unit) => managedUnitIds.includes(unit.id))

  async function addPermission() {
    await createPermission({ memberId: selectedMember.id, unitId: newUnitId, access: newAccess })
    setAddPermissionOpen(false)
  }

  async function runMutation(action: string, mutation: () => Promise<void>): Promise<void> {
    setMutationError(null)
    setPendingAction(action)
    try {
      await mutation()
    } catch (mutationFailure) {
      setMutationError(mutationFailure instanceof Error ? mutationFailure.message : 'The permission change could not be saved.')
    } finally {
      setPendingAction(null)
    }
  }

  function handleAddPermission() {
    void runMutation(`add:${selectedMember.id}:${newUnitId}`, addPermission)
  }

  function handleRemovePermission(permissionId: string) {
    if (pendingRemovalId !== permissionId) {
      setPendingRemovalId(permissionId)
      setMutationError(null)
      return
    }
    setPendingRemovalId(null)
    void runMutation(`remove:${permissionId}`, async () => removePermission(permissionId))
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
        <p className="text-muted-foreground"><span className="font-medium text-foreground">Permission board.</span> Direct membership scopes are inherited through descendant units.</p>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading organization permissions…</p> : null}
      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}
      {mutationError ? <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{mutationError} No permission change was applied.</span></div> : null}

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
                {unitOptions.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={() => setAddPermissionOpen((value) => !value)}><Plus data-icon="inline-start" />Add scope</Button> : null}
              </div>

              {memberPermissions.length ? memberPermissions.map((permission) => <PermissionRow key={permission.id} permission={permission} units={units} canManage={getOrganizationUnit(units, permission.unitId)?.canManage === true} canAssignAdministrator={canAssignAdministrator} busy={pendingAction !== null} removalPending={pendingRemovalId === permission.id} onAccessChange={(access) => { void runMutation(`update:${permission.id}`, async () => { await updatePermission(permission.id, access) }) }} onRemove={() => handleRemovePermission(permission.id)} onCancelRemove={() => setPendingRemovalId(null)} />) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No direct permissions assigned.</p>}
            </div>

            {addPermissionOpen ? <AddPermissionForm units={units} accessLevels={canAssignAdministrator ? accessLevels : accessLevels.filter((level) => level !== 'admin')} unitId={newUnitId} access={newAccess} onUnitChange={setNewUnitId} onAccessChange={setNewAccess} onCancel={() => setAddPermissionOpen(false)} onSubmit={handleAddPermission} busy={pendingAction !== null} /> : null}

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

function PermissionRow({ permission, units, canManage, canAssignAdministrator, busy, removalPending, onAccessChange, onRemove, onCancelRemove }: { permission: UnitPermission; units: OrganizationUnit[]; canManage: boolean; canAssignAdministrator: boolean; busy: boolean; removalPending: boolean; onAccessChange: (access: AccessLevel) => void; onRemove: () => void; onCancelRemove: () => void }) {
  const unit = getOrganizationUnit(units, permission.unitId)
  if (!unit) return null

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><LockKeyhole className="size-4 text-muted-foreground" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{unit.name}</p><p className="truncate text-xs text-muted-foreground">{formatUnitPath(units, unit.id)}</p></div>
      <Select value={permission.access} disabled={busy || !canManage} onChange={(event) => onAccessChange(event.target.value as AccessLevel)} aria-label={`${unit.name} access level`} className="h-8 w-auto px-2 text-xs" options={accessLevels.map((level) => ({ value: level, label: `${humanizeAccessLevel(level)}${level === 'admin' && !canAssignAdministrator ? ' (administrator only)' : ''}`, disabled: level === 'admin' && !canAssignAdministrator }))} />
      <span className="text-xs text-muted-foreground">{canManage ? 'Includes descendants' : 'Read-only scope'}</span>
      {canManage && (removalPending ? <span className="flex shrink-0 items-center gap-2"><span className="text-xs text-destructive">Remove this scope?</span><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancelRemove}>Cancel</Button><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={onRemove}>Confirm</Button></span> : <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Remove ${unit.name} permission`} onClick={onRemove}><X className="size-4" /></Button>)}
    </div>
  )
}

function AddPermissionForm({ units, accessLevels: availableAccessLevels, unitId, access, onUnitChange, onAccessChange, onCancel, onSubmit, busy }: { units: OrganizationUnit[]; accessLevels: AccessLevel[]; unitId: string; access: AccessLevel; onUnitChange: (value: string) => void; onAccessChange: (value: AccessLevel) => void; onCancel: () => void; onSubmit: () => void; busy: boolean }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <OrganizationUnitSelect id="permission-unit" label="Organization unit" value={unitId} units={units} isDisabled={(unit) => !unit.canManage} onChange={onUnitChange} required />
        <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="permission-access">Access level<Select id="permission-access" value={availableAccessLevels.includes(access) ? access : availableAccessLevels[0]} onChange={(event) => onAccessChange(event.target.value as AccessLevel)} options={availableAccessLevels.map((level) => ({ value: level, label: humanizeAccessLevel(level) }))} /></label>
      </div>
      <p className="text-xs text-muted-foreground">This direct scope includes descendants below the selected unit.</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="button" disabled={busy} onClick={onSubmit}>{busy ? 'Saving…' : 'Add permission'}</Button></div>
    </div>
  )
}

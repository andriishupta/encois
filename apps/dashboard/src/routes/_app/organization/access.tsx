import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, Clock3, LockKeyhole, Send, ShieldCheck, Users, X } from 'lucide-react'
import type { OrganizationAccessRequestRecord } from '@encois/contracts'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { applyOrganizationAccessRequest, approveOrganizationAccessRequest, createOrganizationAccessRequest, listOrganizationAccessRequests, rejectOrganizationAccessRequest } from '@/lib/api'
import { getAuthIdentity, getAuthSession, hasPermission } from '@/lib/auth'
import { formatDate, humanizeKey } from '@/lib/formatters'
import { formatUnitPath, getEffectiveUnitIds, getOrganizationUnit, humanizeAccessLevel } from '@/lib/organization'
import { useOrganization } from '@/lib/organization-context'
import { usePermissions } from '@/lib/permissions'
import { queryKeys } from '@/lib/query-keys'
import { Permission } from '@encois/contracts'

export const Route = createFileRoute('/_app/organization/access')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.OrganizationRead)) throw redirect({ to: '/forbidden' })
  },
  component: AccessSettingsPage,
})

function AccessSettingsPage() {
  const queryClient = useQueryClient()
  const { units, members, permissions, isLoading, isLoaded, error } = useOrganization()
  const { permissions: capabilities, can } = usePermissions()
  const session = getAuthSession()
  const identity = getAuthIdentity()
  const currentMember = members.find((member) => member.id === session?.userId || (identity.email && member.email.toLowerCase() === identity.email.toLowerCase()))
  const currentScopes = permissions.filter((permission) => permission.memberId === currentMember?.id || permission.memberId === session?.userId)
  const requestableUnitIds = new Set(getEffectiveUnitIds(units, currentScopes, currentMember?.id ?? session?.userId ?? ''))
  const requestableUnits = units.filter((unit) => requestableUnitIds.has(unit.id))
  const isOrganizationAdministrator = currentMember?.roleKey === 'organization_admin'
  const accessRequests = useQuery({ queryKey: queryKeys.organizationAccessRequests(), queryFn: listOrganizationAccessRequests, enabled: isLoaded && can(Permission.OrganizationRead), refetchInterval: 15_000 })
  const [requestUnitId, setRequestUnitId] = useState('')
  const [requestAccess, setRequestAccess] = useState<'viewer' | 'contributor' | 'manager'>('contributor')
  const [requestReason, setRequestReason] = useState('')

  useEffect(() => {
    if (!requestUnitId && requestableUnits[0]) setRequestUnitId(requestableUnits[0].id)
    if (requestUnitId && !requestableUnits.some((unit) => unit.id === requestUnitId)) setRequestUnitId(requestableUnits[0]?.id ?? '')
  }, [requestUnitId, requestableUnits])

  const createRequest = useMutation({
    mutationFn: createOrganizationAccessRequest,
    onSuccess: async () => {
      setRequestReason('')
      await queryClient.invalidateQueries({ queryKey: queryKeys.organizationAccessRequests() })
    },
  })
  const reviewRequest = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'approve' | 'reject' | 'apply' }) => {
      if (action === 'approve') return approveOrganizationAccessRequest(id)
      if (action === 'reject') return rejectOrganizationAccessRequest(id)
      return applyOrganizationAccessRequest(id)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.organizationAccessRequests() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.organization() }),
      ])
    },
  })

  function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!requestUnitId || !requestReason.trim()) return
    createRequest.mutate({ unitId: requestUnitId, access: requestAccess, reason: requestReason })
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Organization access" description="Live organization membership and information boundaries." actions={can(Permission.OrganizationManage) ? <Button type="button" variant="outline" asChild><Link to="/organization/permissions"><LockKeyhole data-icon="inline-start" />Open permission board</Link></Button> : null} />

      {error ? <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Organization access could not be loaded: {error}</span></div> : null}
      {isLoading ? <p className="text-sm text-muted-foreground">Loading live access state…</p> : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="min-w-0">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />Your access</CardTitle><CardDescription>Resolved from the current organization membership and permission session.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {currentMember ? <div className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{currentMember.initials}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{currentMember.name}</p><p className="truncate text-xs text-muted-foreground">{currentMember.email}</p></div><span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{currentMember.role}</span></div> : <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Your organization membership is not visible in the current scope.</div>}
            <div className="grid gap-2 text-sm"><DetailRow label="Identity" value={identity.email ?? 'Identity provider account'} /><DetailRow label="Membership" value={currentMember?.status ?? 'Not reported'} /><DetailRow label="Direct scopes" value={currentScopes.length ? String(currentScopes.length) : 'None reported'} /></div>
            {currentScopes.length ? <div className="flex flex-col gap-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Effective scope roots</p>{currentScopes.map((permission) => <div key={permission.id} className="rounded-md border px-3 py-2 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-medium">{formatUnitPath(units, permission.unitId) || getOrganizationUnit(units, permission.unitId)?.name || 'Organization unit'}</span><span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{humanizeKey(permission.access)}</span></div><p className="mt-1 text-xs text-muted-foreground">Includes descendant units</p></div>)}</div> : null}
            {!can(Permission.OrganizationManage) ? <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">Need a wider scope or a different access level? Contact an organization administrator; the dashboard does not grant access from the browser.</p> : null}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader><CardTitle>Capabilities</CardTitle><CardDescription>Product capabilities granted by the active organization role.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-2">{capabilities.length ? capabilities.map((permission) => <div key={permission} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm"><span className="flex size-6 items-center justify-center rounded-full bg-muted"><Check className="size-3.5 text-muted-foreground" aria-hidden="true" /></span><span>{humanizeKey(permission)}</span></div>) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No capabilities are available in this session.</p>}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" aria-hidden="true" />Visible organization members</CardTitle><CardDescription>Only members permitted by the current organization scope are shown.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">{members.length ? members.map((member) => <MemberRow key={member.id} member={member} />) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No organization members are visible in the current scope.</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Send className="size-4 text-muted-foreground" aria-hidden="true" />Access requests</CardTitle><CardDescription>{isOrganizationAdministrator ? 'Review requests without changing roles. Approval and scope application are separate audited steps.' : 'Request a higher level on a scope you can currently see. An organization administrator must approve and apply it.'}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-5">
          {accessRequests.error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Access requests could not be loaded: {accessRequests.error.message}</div> : null}
          {isLoaded && can(Permission.OrganizationRead) && requestableUnits.length ? <form className="grid min-w-0 gap-3 rounded-lg border bg-muted/10 p-4" onSubmit={submitRequest}>
            <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
              <label className="flex min-w-0 flex-col gap-2 text-sm font-medium" htmlFor="access-request-unit">Organization unit<select id="access-request-unit" value={requestUnitId} onChange={(event) => setRequestUnitId(event.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{requestableUnits.map((unit) => <option key={unit.id} value={unit.id}>{formatUnitPath(units, unit.id)}</option>)}</select></label>
              <label className="flex min-w-0 flex-col gap-2 text-sm font-medium" htmlFor="access-request-level">Requested access<select id="access-request-level" value={requestAccess} onChange={(event) => setRequestAccess(event.target.value as typeof requestAccess)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{(['viewer', 'contributor', 'manager'] as const).map((level) => <option key={level} value={level}>{humanizeAccessLevel(level)}</option>)}</select></label>
            </div>
            <label className="flex min-w-0 flex-col gap-2 text-sm font-medium" htmlFor="access-request-reason">Why is this access needed?<textarea id="access-request-reason" value={requestReason} onChange={(event) => setRequestReason(event.target.value)} minLength={5} maxLength={2000} rows={3} placeholder="Describe the investigation or workflow you need to support." className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" required /></label>
            {createRequest.error ? <p role="alert" className="text-sm text-destructive">Could not submit the request: {createRequest.error.message}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 flex-1 text-xs text-muted-foreground">Administrator access is never requestable from this form.</p><Button type="submit" className="shrink-0" disabled={createRequest.isPending || !requestReason.trim()}><Send data-icon="inline-start" />{createRequest.isPending ? 'Submitting…' : 'Submit request'}</Button></div>
          </form> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{!isLoaded ? 'Organization access state is still loading.' : !can(Permission.OrganizationRead) ? 'Organization access request visibility is restricted by the current session.' : 'No requestable scope is visible. Contact an organization administrator for a unit outside your current scope.'}</p>}
          {accessRequests.isLoading ? <p className="text-sm text-muted-foreground">Loading access requests…</p> : null}
          {isLoaded && !accessRequests.isLoading && !accessRequests.error && !accessRequests.data?.length ? <p className="text-sm text-muted-foreground">No access requests in the current organization scope.</p> : null}
          {accessRequests.data?.map((request) => <AccessRequestRow key={request.id} request={request} canDecide={Boolean(isOrganizationAdministrator && request.requestedByUserId !== currentMember?.id)} busy={reviewRequest.isPending} onAction={(action) => reviewRequest.mutate({ id: request.id, action })} />)}
          {reviewRequest.error ? <p role="alert" className="text-sm text-destructive">Could not update the access request: {reviewRequest.error.message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Information boundaries</CardTitle><CardDescription>How access is enforced across the product.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3"><BoundaryRow label="Organization scope enforced" /><BoundaryRow label="Read-only provider access by default" /><BoundaryRow label="Evidence stays linked to source and timestamp" /><div className="mt-2 flex items-start gap-3 rounded-lg border bg-muted/20 p-3 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="text-muted-foreground">Provider credentials, writes, and permission changes stay behind the Gateway approval boundaries.</span></div></CardContent>
      </Card>
    </div>
  )
}

function AccessRequestRow({ request, canDecide, busy, onAction }: { request: OrganizationAccessRequestRecord; canDecide: boolean; busy: boolean; onAction: (action: 'approve' | 'reject' | 'apply') => void }) {
  return <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Clock3 className="size-4 text-muted-foreground" aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{request.requesterName} · {request.unitName}</p><span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{humanizeAccessLevel(request.access)}</span><span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{request.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{request.reason} · {formatDate(request.updatedAt)}</p>{request.rejectionReason ? <p className="mt-2 text-xs text-destructive">{request.rejectionReason}</p> : null}</div>{canDecide && request.status === 'proposed' ? <div className="flex shrink-0 gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction('reject')}><X data-icon="inline-start" />Reject</Button><Button type="button" size="sm" disabled={busy} onClick={() => onAction('approve')}>Approve</Button></div> : null}{canDecide && request.status === 'approved' ? <Button type="button" size="sm" disabled={busy} onClick={() => onAction('apply')}><Check data-icon="inline-start" />Apply scope</Button> : null}{!canDecide && request.requestedByUserId === getAuthSession()?.userId && request.status === 'proposed' ? <span className="text-xs text-muted-foreground">Awaiting another administrator</span> : null}</div>
}

type OrganizationMember = ReturnType<typeof useOrganization>['members'][number]

function MemberRow({ member }: { member: OrganizationMember }) {
  return <div className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{member.initials}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.name}</p><p className="truncate text-xs text-muted-foreground">{member.email}</p></div><span className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">{member.role}</span><span className="hidden text-xs text-muted-foreground sm:block">{member.status}</span></div>
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 border-b py-2 last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>
}

function BoundaryRow({ label }: { label: string }) {
  return <div className="flex items-center gap-3 rounded-lg border px-3 py-3 text-sm"><span className="flex size-6 items-center justify-center rounded-full bg-muted"><Check className="size-3.5 text-muted-foreground" aria-hidden="true" /></span>{label}</div>
}

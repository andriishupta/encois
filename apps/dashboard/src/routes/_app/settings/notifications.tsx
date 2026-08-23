import { useEffect, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CircleAlert, Mail, Smartphone } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'
import { getNotificationPreferences, isApiError, listNotifications, markNotificationRead, updateNotificationPreferences } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { formatDate } from '@/lib/formatters'

export const Route = createFileRoute('/_app/settings/notifications')({
  beforeLoad: () => {
    const session = getAuthSession()
    if (!hasPermission(session, Permission.SettingsRead) && !hasPermission(session, Permission.WorkflowsRead) && !hasPermission(session, Permission.KnowledgeRead)) throw redirect({ to: '/forbidden' })
  },
  component: NotificationsSettingsPage,
})

function NotificationsSettingsPage() {
  const queryClient = useQueryClient()
  const canManage = hasPermission(getAuthSession(), Permission.SettingsManage)
  const preferences = useQuery({ queryKey: queryKeys.notificationPreferences(), queryFn: getNotificationPreferences })
  const notifications = useQuery({ queryKey: queryKeys.notifications(), queryFn: listNotifications })
  const [draft, setDraft] = useState({ emailEnabled: false, pushEnabled: false, workflowUpdates: true, evidenceReady: true, weeklyDigest: false })
  useEffect(() => { if (preferences.data) setDraft({ emailEnabled: preferences.data.emailEnabled, pushEnabled: preferences.data.pushEnabled, workflowUpdates: preferences.data.workflowUpdates, evidenceReady: preferences.data.evidenceReady, weeklyDigest: preferences.data.weeklyDigest }) }, [preferences.data])
  const save = useMutation({ mutationFn: () => updateNotificationPreferences(draft), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences() }) } })
  const read = useMutation({ mutationFn: (id: string) => markNotificationRead(id), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }) } })
  const toggle = (key: keyof typeof draft) => setDraft((value) => ({ ...value, [key]: !value[key] }))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Notifications" description="Choose how Encois should surface workflow and evidence updates." actions={<Button type="button" onClick={() => save.mutate()} disabled={!canManage || save.isPending || preferences.isLoading}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>} />
      {preferences.isError ? <Card className="border-destructive/30 bg-destructive/5"><CardContent className="pt-6"><div className="flex items-start gap-3 text-sm"><CircleAlert className="mt-0.5 size-4 text-destructive" /><p role="alert" className="text-destructive">Notification settings are unavailable: {isApiError(preferences.error) ? preferences.error.message : 'Encois did not return preferences.'}</p></div></CardContent></Card> : null}
      {save.isError ? <p role="alert" className="text-sm text-destructive">Could not save notification preferences: {save.error.message}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="size-4 text-muted-foreground" aria-hidden="true" />Delivery channels</CardTitle><CardDescription>Saved per user and organization. External delivery adapters remain disabled until configured.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <NotificationToggle icon={Mail} title="Email notifications" description="Unavailable until an email delivery adapter is configured." enabled={draft.emailEnabled} onToggle={() => toggle('emailEnabled')} available={false} disabled={!canManage} />
            <NotificationToggle icon={Smartphone} title="Push notifications" description="Unavailable until a browser push delivery adapter is configured." enabled={draft.pushEnabled} onToggle={() => toggle('pushEnabled')} available={false} disabled={!canManage} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>What should be surfaced</CardTitle><CardDescription>Choose the events that need your attention.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <NotificationToggle title="Workflow updates" description="Status changes, retries, and waiting states." enabled={draft.workflowUpdates} onToggle={() => toggle('workflowUpdates')} disabled={!canManage} />
            <NotificationToggle title="Evidence ready" description="New context is available for an investigation." enabled={draft.evidenceReady} onToggle={() => toggle('evidenceReady')} disabled={!canManage} />
            <NotificationToggle title="Weekly digest" description="Unavailable until a digest delivery adapter is configured." enabled={draft.weeklyDigest} onToggle={() => toggle('weeklyDigest')} available={false} disabled={!canManage} />
          </CardContent>
        </Card>
      </div>
      <Card><CardHeader><CardTitle>In-product notifications</CardTitle><CardDescription>Operational attention generated from the current scoped workflow, Source, and Integration state.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{notifications.isError ? <p role="alert" className="text-sm text-destructive">Could not load notifications: {notifications.error.message}</p> : null}{read.isError ? <p role="alert" className="text-sm text-destructive">Could not mark notification as read: {read.error.message}</p> : null}{notifications.isLoading ? <p className="text-sm text-muted-foreground">Loading notifications…</p> : null}{!notifications.isLoading && !notifications.isError && !notifications.data?.length ? <p className="text-sm text-muted-foreground">No operational notifications in the current scope.</p> : null}{notifications.data?.map((item) => <button type="button" key={item.id} onClick={() => item.readAt ? undefined : read.mutate(item.id)} className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent ${item.readAt ? 'opacity-60' : ''}`}><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.message}</span><span className="mt-2 block text-[11px] text-muted-foreground">{formatDate(item.createdAt)} · {item.readAt ? 'Read' : 'Mark read'}</span></span></button>)}</CardContent></Card>
    </div>
  )
}

function NotificationToggle({ icon: Icon, title, description, enabled, onToggle, available = true, disabled = false }: { icon?: typeof Bell; title: string; description: string; enabled: boolean; onToggle: () => void; available?: boolean; disabled?: boolean }) {
  const stateLabel = available ? enabled ? 'On' : 'Off' : 'Unavailable'
  return <button type="button" aria-pressed={available ? enabled : undefined} onClick={onToggle} disabled={disabled || !available} className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{Icon ? <Icon className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{description}</span></span><span className={available && enabled ? 'rounded-full bg-primary px-2 py-1 text-xs text-primary-foreground' : 'rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground'}>{stateLabel}</span></button>
}

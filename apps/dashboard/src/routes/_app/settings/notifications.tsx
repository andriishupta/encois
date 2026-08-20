import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Bell, Check, Mail, Smartphone } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/settings/notifications')({
  component: NotificationsSettingsPage,
})

function NotificationsSettingsPage() {
  const [email, setEmail] = useState(true)
  const [push, setPush] = useState(false)
  const [workflowUpdates, setWorkflowUpdates] = useState(true)
  const [evidenceReady, setEvidenceReady] = useState(true)
  const [weeklyDigest, setWeeklyDigest] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Notifications" description="Choose how Encois should surface workflow and evidence updates." actions={<Button type="button" disabled>Save changes</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="size-4 text-muted-foreground" aria-hidden="true" />Delivery channels</CardTitle><CardDescription>Channel preferences are local UI state for now.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <NotificationToggle icon={Mail} title="Email notifications" description="Send updates to your workspace email." enabled={email} onToggle={() => setEmail((value) => !value)} />
            <NotificationToggle icon={Smartphone} title="Push notifications" description="Show important updates in the browser." enabled={push} onToggle={() => setPush((value) => !value)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>What should be surfaced</CardTitle><CardDescription>Choose the events that need your attention.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <NotificationToggle title="Workflow updates" description="Status changes, retries, and waiting states." enabled={workflowUpdates} onToggle={() => setWorkflowUpdates((value) => !value)} />
            <NotificationToggle title="Evidence ready" description="New context is available for an investigation." enabled={evidenceReady} onToggle={() => setEvidenceReady((value) => !value)} />
            <NotificationToggle title="Weekly digest" description="A summary of signals and unresolved work." enabled={weeklyDigest} onToggle={() => setWeeklyDigest((value) => !value)} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function NotificationToggle({ icon: Icon, title, description, enabled, onToggle }: { icon?: typeof Bell; title: string; description: string; enabled: boolean; onToggle: () => void }) {
  return <button type="button" aria-pressed={enabled} onClick={onToggle} className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{Icon ? <Icon className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{description}</span></span><span className={enabled ? 'rounded-full bg-primary px-2 py-1 text-xs text-primary-foreground' : 'rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground'}>{enabled ? 'On' : 'Off'}</span></button>
}


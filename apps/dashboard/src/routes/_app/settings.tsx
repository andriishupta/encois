import { createFileRoute } from '@tanstack/react-router'
import { Bell, LockKeyhole, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Settings" description="Workspace preferences and access controls." />
      <div className="grid gap-4 lg:grid-cols-3">
        <SettingsCard icon={SlidersHorizontal} title="Workspace" description="Name, scope, and default investigation preferences." />
        <SettingsCard icon={Bell} title="Notifications" description="Choose how workflow and evidence updates are surfaced." />
        <SettingsCard icon={LockKeyhole} title="Access" description="Organization membership and permission boundaries." />
      </div>
      <p className="text-sm text-muted-foreground">Settings controls will become active when the control plane is connected.</p>
    </div>
  )
}

function SettingsCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof SlidersHorizontal
  title: string
  description: string
}) {
  return (
    <Card>
      <CardHeader>
        <Icon className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-2 w-16 rounded-full bg-muted" aria-hidden="true" />
      </CardContent>
    </Card>
  )
}

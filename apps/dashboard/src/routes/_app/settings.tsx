import { Outlet, createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Bell, ChevronRight, LockKeyhole, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthSession, hasPermission } from '@/lib/auth'
import { Permission } from '@encois/contracts'

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.SettingsRead)) throw redirect({ to: '/forbidden' })
  },
  component: () => <Outlet />,
})

export function SettingsOverviewPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Settings" description="Workspace preferences and access controls." />
      <div className="grid gap-4 lg:grid-cols-3">
        <SettingsCard to="/settings/workspace" icon={SlidersHorizontal} title="Workspace" description="Name, scope, and default investigation preferences." />
        <SettingsCard to="/settings/notifications" icon={Bell} title="Notifications" description="Choose how workflow and evidence updates are surfaced." />
        <SettingsCard to="/settings/access" icon={LockKeyhole} title="Access" description="Organization membership and permission boundaries." />
      </div>
    </div>
  )
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  to,
}: {
  icon: typeof SlidersHorizontal
  title: string
  description: string
  to: '/settings/workspace' | '/settings/notifications' | '/settings/access'
}) {
  return (
    <Link to={to} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardHeader>
          <Icon className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Open settings</span>
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </CardContent>
      </Card>
    </Link>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { SettingsOverviewPage } from '@/routes/_app/settings'

export const Route = createFileRoute('/_app/settings/')({
  component: SettingsOverviewPage,
})

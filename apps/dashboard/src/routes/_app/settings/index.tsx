import { createFileRoute } from '@tanstack/react-router'
import { SettingsOverviewPage } from '../settings'

export const Route = createFileRoute('/_app/settings/')({
  component: SettingsOverviewPage,
})


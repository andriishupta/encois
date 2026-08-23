import { createFileRoute, redirect } from '@tanstack/react-router'
import { StatusPage } from '@/components/status-page'
import { getAuthSession } from '@/lib/auth'

export const Route = createFileRoute('/forbidden')({
  beforeLoad: () => {
    if (!getAuthSession()) throw redirect({ to: '/login' })
  },
  component: () => <StatusPage code={403} />,
})

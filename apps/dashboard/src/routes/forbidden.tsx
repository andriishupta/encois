import { createFileRoute, redirect } from '@tanstack/react-router'
import { PermissionDenied } from '@/components/permission-denied'
import { getAuthSession } from '@/lib/auth'

export const Route = createFileRoute('/forbidden')({
  beforeLoad: () => {
    if (!getAuthSession()) throw redirect({ to: '/login' })
  },
  component: () => <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4"><PermissionDenied /></div>,
})

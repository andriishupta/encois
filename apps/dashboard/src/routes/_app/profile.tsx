import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { clearAuthSession, getAuthSession } from '@/lib/auth'
import { getAccountSummary } from '@/lib/account'
import { useOrganization } from '@/lib/organization-context'

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const navigate = useNavigate()
  const session = getAuthSession()
  const { members } = useOrganization()
  const account = getAccountSummary(members)

  function signOut() {
    clearAuthSession()
    void navigate({ to: '/login' })
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Account" description="Your identity and current session controls." />
      <div className="grid gap-4 xl:grid-cols-[1fr_0.75fr]">
        <Card>
          <CardHeader><div className="flex items-center gap-4"><div className="flex size-14 items-center justify-center rounded-full bg-primary text-lg font-medium text-primary-foreground">{account.initials}</div><div><CardTitle>Account profile</CardTitle><CardDescription>Identity details come from the signed-in provider or organization membership.</CardDescription></div></div></CardHeader>
          <CardContent className="flex flex-col gap-5"><DetailRow label="Name" value={account.name} /><DetailRow label="Email" value={account.email} /><DetailRow label="Organization" value={session?.organizationId ? 'Current organization' : 'Not selected'} /><div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="text-muted-foreground">Profile editing and avatar storage are not exposed by the current control-plane contract, so this screen does not pretend to save local-only changes.</span></div></CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="size-4 text-muted-foreground" aria-hidden="true" />Identity boundary</CardTitle><CardDescription>The browser keeps only the session needed to call the Gateway.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><BoundaryRow label="Provider token is acquired by the identity SDK" /><BoundaryRow label="Gateway recomputes organization permissions" /><BoundaryRow label="Provider credentials never appear here" /></CardContent></Card>
          <Card><CardHeader><CardTitle>Session</CardTitle><CardDescription>End this browser session and return to sign in.</CardDescription></CardHeader><CardContent><Button type="button" variant="outline" onClick={signOut}><LogOut data-icon="inline-start" />Log out</Button></CardContent></Card>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 border-b py-2 last:border-0"><span className="text-sm text-muted-foreground">{label}</span><span className="max-w-[70%] truncate text-right text-sm font-medium" title={value}>{value}</span></div>
}

function BoundaryRow({ label }: { label: string }) {
  return <div className="flex items-start gap-3 rounded-lg border px-3 py-3 text-sm"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted"><Check className="size-3.5 text-muted-foreground" aria-hidden="true" /></span><span>{label}</span></div>
}

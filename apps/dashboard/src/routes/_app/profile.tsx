import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Camera, Check, LogOut, Save } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const [name, setName] = useState('Alex Morgan')
  const [email, setEmail] = useState('alex@acme.com')
  const [saved, setSaved] = useState(false)

  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Profile" description="Your Encois account and session controls." />
      <form className="grid gap-4 xl:grid-cols-[1fr_0.75fr]" onSubmit={saveProfile}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary text-lg font-medium text-primary-foreground">AM</div>
            <div><CardTitle>Account profile</CardTitle><CardDescription>Basic account information used across the workspace.</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="profile-name">Name<input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} className={inputClassName} /></label>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="profile-email">Email<input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClassName} /></label>
          <div className="flex justify-end"><Button type="submit">{saved ? <><Check data-icon="inline-start" />Saved</> : <><Save data-icon="inline-start" />Save changes</>}</Button></div>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        <Card><CardHeader><CardTitle>Profile image</CardTitle><CardDescription>Use an image to make account activity easier to recognize.</CardDescription></CardHeader><CardContent><label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 text-sm transition-colors hover:bg-accent"><Camera className="size-4 text-muted-foreground" aria-hidden="true" />Choose image<input type="file" accept="image/*" className="sr-only" /></label></CardContent></Card>
        <Card><CardHeader><CardTitle>Session</CardTitle><CardDescription>Sign out from this browser session.</CardDescription></CardHeader><CardContent><Button variant="outline" asChild><Link to="/login"><LogOut data-icon="inline-start" />Log out</Link></Button></CardContent></Card>
      </div>
      </form>
    </div>
  )
}

const inputClassName = 'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50'

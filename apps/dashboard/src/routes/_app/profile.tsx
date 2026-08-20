import { createFileRoute, Link } from '@tanstack/react-router'
import { LogOut, UserRound } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Profile" description="Your Encois account and session controls." />
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <CardTitle>Account profile</CardTitle>
          <CardDescription>Authentication and profile data will be connected to the Gateway API later.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link to="/login">
              <LogOut data-icon="inline-start" />
              Log out
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

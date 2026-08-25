import { Permission } from "@encois/contracts";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ChevronRight, UserRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { useOrganization } from "@/lib/organization-context";

export const Route = createFileRoute("/_app/management/members")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.OrganizationRead))
      throw redirect({ to: "/forbidden" });
  },
  component: OrganizationMembersPage,
});

function OrganizationMembersPage() {
  const { members, isLoading, error } = useOrganization();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Organization members"
        description="View members in this organization. Permission scopes are managed separately."
        actions={
          <Button variant="outline" asChild>
            <Link to="/management/permissions">Manage permissions</Link>
          </Button>
        }
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading members…</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load organization members: {error}
        </p>
      ) : null}
      {!isLoading && !error ? (
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Select a member to manage their organization-unit permissions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {members.length ? (
              members.map((member) => (
                <Link
                  key={member.id}
                  to="/management/permissions"
                  search={{ memberId: member.id }}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {member.initials || <UserRound className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {member.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {member.email} · {member.role}
                    </span>
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {member.status}
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No organization members are available.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

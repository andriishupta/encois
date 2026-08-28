import {
  type OrganizationMembershipStatus,
  Permission,
} from "@encois/contracts/browser";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import { LinkCardIndicator } from "@/components/link-card";
import {
  ListCollection,
  ListFilter,
  ListResultsHeader,
  ListSearch,
  ListSort,
  ListToolbar,
  type ListViewMode,
} from "@/components/list-controls";
import { PageHeader } from "@/components/page-header";
import { DescriptionPill, StatusPill } from "@/components/pill";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { humanizeKey } from "@/lib/formatters";
import { useOrganization } from "@/lib/organization-context";

type MemberStatusFilter = OrganizationMembershipStatus | "all";
type MemberSort = "email-asc" | "email-desc";

const memberStatuses: readonly {
  value: MemberStatusFilter;
  label: string;
}[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
];

const memberSorts: readonly { value: MemberSort; label: string }[] = [
  { value: "email-asc", label: "Email A–Z" },
  { value: "email-desc", label: "Email Z–A" },
];

export const Route = createFileRoute("/_app/management/members")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status: memberStatuses.some((option) => option.value === search.status)
      ? (search.status as MemberStatusFilter)
      : ("all" as const),
    sort:
      search.sort === "email-desc"
        ? ("email-desc" as const)
        : ("email-asc" as const),
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.OrganizationRead))
      throw redirect({ to: "/forbidden" });
  },
  component: OrganizationMembersPage,
});

function OrganizationMembersPage() {
  const navigate = useNavigate();
  const { members, isLoading, error } = useOrganization();
  const { q, status, sort } = Route.useSearch();
  const [view, setView] = useState<ListViewMode>("grid");

  const visibleMembers = useMemo(() => {
    const query = q?.trim().toLowerCase() ?? "";
    return [...members]
      .filter((member) => {
        const matchesStatus =
          status === "all" || member.status.toLowerCase() === status;
        const matchesQuery =
          !query ||
          [member.name, member.email, member.role].some((value) =>
            value.toLowerCase().includes(query),
          );
        return matchesStatus && matchesQuery;
      })
      .sort((left, right) => {
        const result = left.email.localeCompare(right.email);
        return sort === "email-desc" ? -result : result;
      });
  }, [members, q, sort, status]);

  function updateSearch(value: string) {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (current) => ({ ...current, q: value || undefined }),
    });
  }

  function updateStatus(value: string) {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (current) => ({
        ...current,
        status: value === "all" ? undefined : (value as MemberStatusFilter),
      }),
    });
  }

  function updateSort(value: string) {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (current) => ({ ...current, sort: value as MemberSort }),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Organization members"
        description="View members in this organization and manage each member’s permission scopes."
      />
      <ListToolbar>
        <ListSearch
          value={q ?? ""}
          onChange={updateSearch}
          placeholder="Search members by name, email, or role…"
          label="Search organization members"
        />
        <ListFilter
          value={status}
          onChange={updateStatus}
          options={memberStatuses}
          label="Filter members by status"
        />
        <ListSort
          value={sort}
          onChange={updateSort}
          options={memberSorts}
          label="Sort members by email"
        />
      </ListToolbar>
      <ListResultsHeader
        count={visibleMembers.length}
        total={members.length}
        label="visible members"
        view={view}
        onViewChange={setView}
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading members…</p>
      ) : null}
      {error ? (
        <InlineError title="Organization members unavailable" message={error} />
      ) : null}
      {!isLoading && !error && visibleMembers.length ? (
        <ListCollection
          items={visibleMembers}
          view={view}
          getKey={(member) => member.id}
          renderItem={(member) => <MemberCard member={member} />}
        />
      ) : null}
      {!isLoading && !error && !visibleMembers.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={UserRound}
              title={
                q || status !== "all" ? "No members match" : "No members yet"
              }
              description={
                q || status !== "all"
                  ? "Change the search or status filter."
                  : "No organization members are available."
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MemberCard({
  member,
}: {
  member: ReturnType<typeof useOrganization>["members"][number];
}) {
  return (
    <Link
      to="/management/members/$memberId"
      params={{ memberId: member.id }}
      className="group block h-full"
    >
      <Card className="relative flex h-full min-h-[150px] flex-col transition-colors group-hover:border-foreground/30">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {member.initials || <UserRound className="size-4" />}
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate">{member.name}</CardTitle>
              <CardDescription className="mt-1 truncate">
                {member.email}
              </CardDescription>
            </div>
          </div>
          <StatusPill
            status={member.status}
            label={humanizeKey(member.status)}
            className="font-medium"
          />
        </CardHeader>
        <CardContent className="flex flex-1 items-end pr-14 text-xs text-muted-foreground">
          <DescriptionPill>{member.role}</DescriptionPill>
        </CardContent>
        <LinkCardIndicator />
      </Card>
    </Link>
  );
}

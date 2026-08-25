import { Permission } from "@encois/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { InvestigationsPage } from "@/routes/_app/management/investigations";

export const Route = createFileRoute("/_app/organization/investigations")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  beforeLoad: () => {
    const session = getAuthSession();
    if (
      !hasPermission(session, Permission.OrganizationManage) &&
      !hasPermission(session, Permission.WorkflowsRead) &&
      !hasPermission(session, Permission.KnowledgeRead) &&
      !hasPermission(session, Permission.ContextRead) &&
      !hasPermission(session, Permission.MemoryRead)
    )
      throw redirect({ to: "/forbidden" });
  },
  component: OrganizationInvestigationsPage,
});

function OrganizationInvestigationsPage() {
  const navigate = Route.useNavigate();
  const { q } = Route.useSearch();

  return (
    <InvestigationsPage
      q={q}
      onSearch={(value) =>
        void navigate({
          replace: true,
          resetScroll: false,
          search: { q: value || undefined },
        })
      }
      detailPath="/organization/investigations/$investigationId"
      newPath="/organization/investigations/new"
    />
  );
}

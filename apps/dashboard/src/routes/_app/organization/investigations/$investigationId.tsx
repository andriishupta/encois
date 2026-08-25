import { Permission } from "@encois/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { OrganizationInvestigationDetail } from "@/components/investigation-detail";
import { getAuthSession, hasPermission } from "@/lib/auth";

export const Route = createFileRoute(
  "/_app/organization/investigations/$investigationId",
)({
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
  component: OrganizationInvestigationDetailPage,
});

function OrganizationInvestigationDetailPage() {
  const { investigationId } = Route.useParams();

  return <OrganizationInvestigationDetail investigationId={investigationId} />;
}

import { Permission } from "@encois/contracts/browser";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { OrganizationPermissionsPage } from "../permissions";

export const Route = createFileRoute("/_app/management/members/$memberId")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.OrganizationRead))
      throw redirect({ to: "/forbidden" });
  },
  component: MemberDetailPage,
});

function MemberDetailPage() {
  const { memberId } = Route.useParams();

  return <OrganizationPermissionsPage memberId={memberId} />;
}

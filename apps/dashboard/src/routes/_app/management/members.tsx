import { Permission } from "@encois/contracts/browser";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAuthSession, hasPermission } from "@/lib/auth";

export const Route = createFileRoute("/_app/management/members")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.OrganizationRead))
      throw redirect({ to: "/forbidden" });
  },
  component: () => <Outlet />,
});

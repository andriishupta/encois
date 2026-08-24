import { Permission } from "@encois/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { WorkflowRunList } from "@/components/workflow-run-list";
import { getAuthSession, hasPermission } from "@/lib/auth";

export const Route = createFileRoute("/_app/workflows/runs")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.WorkflowsRead))
      throw redirect({ to: "/forbidden" });
  },
  component: () => <WorkflowRunList />,
});

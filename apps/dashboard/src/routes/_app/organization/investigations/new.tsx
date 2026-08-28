import { Permission } from "@encois/contracts/browser";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { InvestigationForm } from "@/components/investigation-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getAuthSession, hasPermission } from "@/lib/auth";

export const Route = createFileRoute("/_app/organization/investigations/new")({
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
  component: NewInvestigationPage,
});

function NewInvestigationPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="New Investigation"
        description="Create a repeatable, scope-bound investigation against organization context."
        actions={
          <Button variant="outline" asChild>
            <Link to="/organization/investigations" search={{ q: undefined }}>
              <ArrowLeft data-icon="inline-start" />
              Back to Investigations
            </Link>
          </Button>
        }
      />
      <InvestigationForm />
    </div>
  );
}

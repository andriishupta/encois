import { Permission } from "@encois/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Bookmark, CircleAlert, Trash2 } from "lucide-react";
import { EmptyPanel } from "@/components/empty-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { deleteSavedInvestigation, listSavedInvestigations } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { formatDate } from "@/lib/formatters";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/organization/investigations")({
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
  component: InvestigationsPage,
});

function InvestigationsPage() {
  const queryClient = useQueryClient();
  const investigations = useQuery({
    queryKey: queryKeys.savedInvestigations(),
    queryFn: listSavedInvestigations,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSavedInvestigation(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.savedInvestigations(),
      });
    },
  });
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Saved investigations"
        description="Repeatable, scope-bound entry points into organization context, memory, and workflow review."
        actions={
          <Button asChild variant="outline">
            <Link to="/organization/memory" search={{ savedId: undefined }}>
              Open organization memory
            </Link>
          </Button>
        }
      />
      {investigations.isError ? (
        <Card>
          <CardContent className="pt-6">
            <p
              role="alert"
              className="flex items-start gap-3 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4" />
              Could not load saved investigations:{" "}
              {investigations.error.message}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {remove.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not delete the saved investigation: {remove.error.message}
        </p>
      ) : null}
      {investigations.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading saved investigations…
        </p>
      ) : null}
      {!investigations.isLoading &&
      !investigations.isError &&
      !investigations.data?.length ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyPanel
              icon={Bookmark}
              title="No saved investigations"
              description="Save a bounded query from organization context to make it available here."
              action={
                <Button asChild>
                  <Link
                    to="/organization/memory"
                    search={{ savedId: undefined }}
                  >
                    Explore organization memory
                  </Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {investigations.data?.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span className="truncate">{item.name}</span>
                <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-normal">
                  {item.kind}
                </span>
              </CardTitle>
              <CardDescription>
                {item.query} · updated {formatDate(item.updatedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                Scope: {item.scope.ids.join(", ")}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {item.kind === "graph" ? (
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link
                      to="/organization/memory"
                      search={{ savedId: item.id }}
                    >
                      Open
                    </Link>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${item.name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete saved investigation “${item.name}”? This cannot be undone.`,
                      )
                    )
                      remove.mutate(item.id);
                  }}
                  disabled={remove.isPending}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

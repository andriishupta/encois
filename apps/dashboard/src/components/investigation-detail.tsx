import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CircleAlert, Trash2 } from "lucide-react";
import { EmptyPanel } from "@/components/empty-panel";
import { InlineError } from "@/components/inline-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteSavedInvestigation, getSavedInvestigation } from "@/lib/api";
import { formatDate, humanizeKey } from "@/lib/formatters";
import { formatUnitPath } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";
import { queryKeys } from "@/lib/query-keys";

export function OrganizationInvestigationDetail({
  investigationId,
}: {
  investigationId: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { units } = useOrganization();
  const investigation = useQuery({
    queryKey: queryKeys.savedInvestigation(investigationId),
    queryFn: () => getSavedInvestigation(investigationId),
  });
  const remove = useMutation({
    mutationFn: () => deleteSavedInvestigation(investigationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.savedInvestigationPages(),
      });
      await navigate({
        to: "/organization/investigations",
        search: { q: undefined },
      });
    },
  });

  if (investigation.isLoading)
    return (
      <p className="text-sm text-muted-foreground">Loading investigation…</p>
    );

  if (investigation.isError)
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyPanel
            icon={CircleAlert}
            title="Investigation unavailable"
            description={investigation.error.message}
            action={
              <Button asChild variant="outline">
                <Link
                  to="/organization/investigations"
                  search={{ q: undefined }}
                >
                  <ArrowLeft data-icon="inline-start" />
                  Back to investigations
                </Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );

  const item = investigation.data;
  if (!item) return null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={item.name}
        description="Saved investigation definition and its organization context."
        actions={
          <Button asChild variant="outline">
            <Link to="/organization/investigations" search={{ q: undefined }}>
              <ArrowLeft data-icon="inline-start" />
              Investigations
            </Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Investigation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <DetailRow label="Query" value={humanizeKey(item.query)} />
          <DetailRow label="Type" value={humanizeKey(item.kind)} />
          <DetailRow
            label="Context"
            value={item.scope.ids
              .map((id) => formatUnitPath(units, id) || id)
              .join(", ")}
          />
          <DetailRow label="Created" value={formatDate(item.createdAt)} />
          <DetailRow label="Updated" value={formatDate(item.updatedAt)} />
        </CardContent>
      </Card>
      {Object.keys(item.params).length ? (
        <Card>
          <CardHeader>
            <CardTitle>Query parameters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {Object.entries(item.params).map(([key, value]) => (
              <DetailRow
                key={key}
                label={humanizeKey(key)}
                value={String(value)}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Delete saved investigation “${item.name}”? This cannot be undone.`,
              )
            )
              remove.mutate();
          }}
        >
          <Trash2 data-icon="inline-start" />
          Delete investigation
        </Button>
      </div>
      {remove.isError ? (
        <InlineError
          title="Could not delete the investigation"
          message={remove.error.message}
        />
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b pb-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium" title={value}>
        {value}
      </span>
    </div>
  );
}

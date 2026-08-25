import { Permission } from "@encois/contracts";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Building2, Plus } from "lucide-react";
import { OrganizationCanvas } from "@/components/organization-canvas";
import { PageHeader } from "@/components/page-header";
import { ProductTerm } from "@/components/product-term";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthSession, hasPermission } from "@/lib/auth";
import {
  formatUnitPath,
  getOrganizationUnit,
  getUnitPath,
  humanizeUnitType,
} from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";

export const Route = createFileRoute("/_app/organization/")({
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.OrganizationRead))
      throw redirect({ to: "/forbidden" });
  },
  component: OrganizationPage,
});

function OrganizationPage() {
  const { units, currentUnitId, setCurrentUnitId, isLoading, error } =
    useOrganization();

  const selectedUnit = getOrganizationUnit(units, currentUnitId)?.canView
    ? getOrganizationUnit(units, currentUnitId)
    : units.find((unit) => unit.canView);
  const canManageAnyUnit = units.some((unit) => unit.canManage);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Organization"
        description={
          <>
            Explore the organization-owned visibility tree and manage{" "}
            <ProductTerm term="organizationUnit" plural /> within your{" "}
            <ProductTerm term="scope" />.
          </>
        }
        actions={
          canManageAnyUnit ? (
            <Button asChild>
              <Link to="/organization/units/new">
                <Plus data-icon="inline-start" />
                Add unit
              </Link>
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading organization scope…
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              {selectedUnit?.name ?? "Organization scope"}
            </CardTitle>
            <CardDescription>
              {selectedUnit
                ? formatUnitPath(units, selectedUnit.id)
                : "Organization structure is not available yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {selectedUnit ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {selectedUnit.description}
                </p>
                <div className="grid gap-2 text-sm">
                  <DetailRow
                    label="Unit type"
                    value={humanizeUnitType(selectedUnit.type)}
                  />
                  <DetailRow
                    label="Manager"
                    value={selectedUnit.manager ?? "Restricted"}
                  />
                  <DetailRow
                    label="Members"
                    value={
                      selectedUnit.memberCount === undefined
                        ? "Restricted"
                        : String(selectedUnit.memberCount)
                    }
                  />
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {selectedUnit ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <ProductTerm term="scope" /> inheritance
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <DetailRow
                label="Parent units"
                value={String(
                  Math.max(0, getUnitPath(units, selectedUnit.id).length - 1),
                )}
              />
              <DetailRow
                label="Child units"
                value={String(
                  units.filter((unit) => unit.parentId === selectedUnit.id)
                    .length,
                )}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <ProductTerm term="organizationUnit" plural />
          </CardTitle>
          <CardDescription>
            Parent and child relationships are shown from top to bottom. Select
            a unit to inspect its <ProductTerm term="scope" />.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationCanvas
            units={units}
            selectedUnitId={currentUnitId}
            onSelectUnit={setCurrentUnitId}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

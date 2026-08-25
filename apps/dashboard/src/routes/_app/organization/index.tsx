import { Permission } from "@encois/contracts";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Building2, Plus, ShieldCheck, Users } from "lucide-react";
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

      <div className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">
            Organization structure.
          </span>{" "}
          The complete hierarchy is visible, while unit details and management
          actions follow your effective scope.
        </p>
      </div>
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

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            {selectedUnit
              ? formatUnitPath(units, selectedUnit.id)
              : "Organization structure is not available yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Building2
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              {selectedUnit?.name ?? "Organization scope"}
            </p>
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
          </div>
          {selectedUnit ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="font-medium">
                <ProductTerm term="scope" /> inheritance
              </p>
              <p className="text-xs text-muted-foreground">
                Membership roots include descendants; restrictions narrow the
                effective <ProductTerm term="scope" />.
              </p>
              <ScopeRow
                label="Parent units"
                value={String(
                  Math.max(0, getUnitPath(units, selectedUnit.id).length - 1),
                )}
              />
              <ScopeRow
                label="Child units"
                value={String(
                  units.filter((unit) => unit.parentId === selectedUnit.id)
                    .length,
                )}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Actions</p>
            {selectedUnit?.canManage ? (
              <Button variant="outline" asChild>
                <Link
                  to="/organization/units/new"
                  search={{ parentId: selectedUnit.id }}
                >
                  <Plus data-icon="inline-start" />
                  Add related unit
                </Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Management is restricted for this unit.
              </p>
            )}
            {selectedUnit?.canManage ? (
              <Button variant="outline" asChild>
                <Link to="/management/permissions">
                  <Users data-icon="inline-start" />
                  Manage permissions
                </Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

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

function ScopeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium">{value}</span>
    </div>
  );
}

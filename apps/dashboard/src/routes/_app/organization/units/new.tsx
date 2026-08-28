import {
  type OrganizationUnitType,
  Permission,
} from "@encois/contracts/browser";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft, LoaderCircle, Plus } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { OrganizationUnitSelect } from "@/components/organization-unit-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { isApiError } from "@/lib/api";
import { getAuthSession, hasPermission } from "@/lib/auth";
import { humanizeUnitType } from "@/lib/organization";
import { useOrganization } from "@/lib/organization-context";

export const Route = createFileRoute("/_app/organization/units/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    parentId: typeof search.parentId === "string" ? search.parentId : undefined,
  }),
  beforeLoad: () => {
    if (!hasPermission(getAuthSession(), Permission.OrganizationRead))
      throw redirect({ to: "/forbidden" });
  },
  component: AddOrganizationUnitPage,
});

const unitTypes: readonly OrganizationUnitType[] = [
  "department",
  "team",
  "project",
  "service",
  "custom",
];

function AddOrganizationUnitPage() {
  const navigate = useNavigate();
  const { parentId } = Route.useSearch();
  const { units, currentUnitId, createUnit, setCurrentUnitId } =
    useOrganization();
  const manageableUnits = useMemo(
    () => units.filter((unit) => unit.canManage),
    [units],
  );
  const [name, setName] = useState("");
  const [type, setType] = useState<OrganizationUnitType>(unitTypes[0]);
  const [selectedParentId, setSelectedParentId] = useState(
    parentId ?? currentUnitId ?? "organization",
  );
  const [relation, setRelation] = useState<"child" | "sibling">("child");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (parentId && manageableUnits.some((unit) => unit.id === parentId))
      setSelectedParentId(parentId);
    else if (!manageableUnits.some((unit) => unit.id === selectedParentId))
      setSelectedParentId(manageableUnits[0]?.id ?? "organization");
  }, [manageableUnits, parentId, selectedParentId]);

  const selectedParent = units.find((unit) => unit.id === selectedParentId);
  const siblingAllowed = Boolean(
    selectedParent?.parentId &&
      units.some(
        (unit) => unit.id === selectedParent.parentId && unit.canManage,
      ),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !selectedParent?.canManage) return;
    const siblingParent = selectedParent.parentId
      ? units.find((unit) => unit.id === selectedParent.parentId)
      : undefined;
    if (relation === "sibling" && !siblingParent?.canManage) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createUnit({
        name: trimmedName,
        type,
        parentId:
          relation === "sibling" ? selectedParent.parentId : selectedParent.id,
      });
      setCurrentUnitId(created.id);
      await navigate({ to: "/organization" });
    } catch (cause) {
      setError(
        isApiError(cause)
          ? cause.message
          : "The organization unit could not be created.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Add organization unit"
        description="Create a child or sibling unit inside the part of the organization you manage."
        actions={
          <Button variant="outline" asChild>
            <Link to="/organization">
              <ArrowLeft data-icon="inline-start" />
              Back to Organization
            </Link>
          </Button>
        }
      />
      <form className="w-full" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Unit configuration</CardTitle>
            <CardDescription>
              The selected relationship and your organization permissions are
              enforced when the unit is created.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <label
              className="flex flex-col gap-2 text-sm font-medium"
              htmlFor="organization-unit-name"
            >
              Unit name
              <Input
                id="organization-unit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Platform"
                maxLength={120}
                required
              />
            </label>
            <div className="grid gap-5 sm:grid-cols-2">
              <label
                className="flex flex-col gap-2 text-sm font-medium"
                htmlFor="organization-unit-type"
              >
                Unit type
                <Select
                  id="organization-unit-type"
                  value={type}
                  onChange={(event) =>
                    setType(event.target.value as OrganizationUnitType)
                  }
                  options={unitTypes.map((value) => ({
                    value,
                    label: humanizeUnitType(value),
                  }))}
                />
              </label>
              <OrganizationUnitSelect
                id="organization-unit-parent"
                label="Relative to"
                value={selectedParentId}
                units={units}
                isDisabled={(unit) => !unit.canManage}
                onChange={setSelectedParentId}
                required
              />
            </div>
            <label
              className="flex flex-col gap-2 text-sm font-medium"
              htmlFor="organization-unit-relation"
            >
              Placement
              <Select
                id="organization-unit-relation"
                value={relation}
                onChange={(event) =>
                  setRelation(event.target.value as "child" | "sibling")
                }
                options={[
                  { value: "child", label: "Child of selected unit" },
                  {
                    value: "sibling",
                    label: "Parallel to selected unit",
                    disabled: !siblingAllowed,
                  },
                ]}
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
              <Button variant="ghost" asChild>
                <Link to="/organization">Cancel</Link>
              </Button>
              <Button
                type="submit"
                disabled={saving || !name.trim() || !selectedParent?.canManage}
              >
                {saving ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Plus data-icon="inline-start" />
                )}
                {saving ? "Creating…" : "Create unit"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

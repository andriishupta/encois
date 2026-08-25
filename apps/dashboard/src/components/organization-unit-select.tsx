import { Select } from "@/components/ui/select";
import { flattenUnitOptions, type OrganizationUnit } from "@/lib/organization";

type OrganizationUnitSelectProps = {
  id: string;
  label?: string;
  value: string;
  units: readonly OrganizationUnit[];
  onChange: (value: string) => void;
  filter?: (unit: OrganizationUnit) => boolean;
  isDisabled?: (unit: OrganizationUnit) => boolean;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  testId?: string;
};

/** Shared hierarchy-aware selector for every unit-scoped form. */
export function OrganizationUnitSelect({
  id,
  label,
  value,
  units,
  onChange,
  filter = () => true,
  isDisabled = () => false,
  description,
  required,
  disabled,
  testId,
}: OrganizationUnitSelectProps) {
  const options = flattenUnitOptions(units)
    .filter(({ unit }) => filter(unit))
    .map(({ unit, depth }) => ({
      value: unit.id,
      label: `${"— ".repeat(depth)}${unit.name}`,
      disabled: isDisabled(unit),
    }));

  const field = (
    <>
      <Select
        id={id}
        aria-label={label || "Organization unit"}
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled || options.length === 0}
        options={[
          { value: "", label: "Select an organization unit", disabled: true },
          ...options,
        ]}
      />
      {description ? (
        <span className="text-xs font-normal text-muted-foreground">
          {description}
        </span>
      ) : null}
    </>
  );

  return label ? (
    <label className="flex flex-col gap-2 text-sm font-medium" htmlFor={id}>
      {label}
      {field}
    </label>
  ) : (
    <div className="min-w-0">{field}</div>
  );
}

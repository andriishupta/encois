import { flattenUnitOptions, type OrganizationUnit } from '@/lib/organization'

type OrganizationUnitSelectProps = {
  id: string
  label: string
  value: string
  units: readonly OrganizationUnit[]
  onChange: (value: string) => void
  filter?: (unit: OrganizationUnit) => boolean
  isDisabled?: (unit: OrganizationUnit) => boolean
  description?: string
  required?: boolean
  disabled?: boolean
}

/** Shared hierarchy-aware selector for every unit-scoped form. */
export function OrganizationUnitSelect({ id, label, value, units, onChange, filter = () => true, isDisabled = () => false, description, required, disabled }: OrganizationUnitSelectProps) {
  const options = flattenUnitOptions(units).filter(({ unit }) => filter(unit))

  return (
    <label className="flex flex-col gap-2 text-sm font-medium" htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled || options.length === 0} className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60">
        <option value="" disabled>Select an organization unit</option>
        {options.map(({ unit, depth }) => <option key={unit.id} value={unit.id} disabled={isDisabled(unit)}>{`${'— '.repeat(depth)}${unit.name}`}</option>)}
      </select>
      {description ? <span className="text-xs font-normal text-muted-foreground">{description}</span> : null}
    </label>
  )
}

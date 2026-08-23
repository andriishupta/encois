export type OrganizationUnitType = 'organization' | 'department' | 'team' | 'project' | 'service' | 'custom'
export type AccessLevel = 'viewer' | 'contributor' | 'manager' | 'admin'

export type OrganizationUnit = {
  id: string
  parentId: string | null
  type: OrganizationUnitType
  name: string
  description: string
  canView: boolean
  canManage: boolean
  manager?: string
  memberCount?: number
}

export type OrganizationMember = {
  id: string
  initials: string
  name: string
  email: string
  role: string
  roleKey?: string
  homeUnitId: string
  status: string
}

export type UnitPermission = {
  id: string
  memberId: string
  unitId: string
  access: AccessLevel
  propagateToChildren: boolean
}

export function getOrganizationUnit(units: readonly OrganizationUnit[], unitId: string): OrganizationUnit | undefined {
  return units.find((unit) => unit.id === unitId)
}

export function getUnitPath(units: readonly OrganizationUnit[], unitId: string): OrganizationUnit[] {
  const path: OrganizationUnit[] = []
  const visited = new Set<string>()
  let current = getOrganizationUnit(units, unitId)

  while (current && !visited.has(current.id)) {
    path.unshift(current)
    visited.add(current.id)
    current = current.parentId ? getOrganizationUnit(units, current.parentId) : undefined
  }

  return path
}

export function getChildUnits(units: readonly OrganizationUnit[], parentId: string | null): OrganizationUnit[] {
  return units.filter((unit) => unit.parentId === parentId)
}

export function getDescendantUnitIds(units: readonly OrganizationUnit[], unitId: string): string[] {
  const descendants: string[] = []
  const queue = [unitId]

  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index]
    for (const child of getChildUnits(units, currentId)) {
      descendants.push(child.id)
      queue.push(child.id)
    }
  }

  return descendants
}

export function flattenUnitOptions(units: readonly OrganizationUnit[], parentId: string | null = null, depth = 0): { unit: OrganizationUnit; depth: number }[] {
  return getChildUnits(units, parentId).flatMap((unit) => [
    { unit, depth },
    ...flattenUnitOptions(units, unit.id, depth + 1),
  ])
}

export function formatUnitPath(units: readonly OrganizationUnit[], unitId: string): string {
  return getUnitPath(units, unitId).map((unit) => unit.name).join(' / ')
}

export function formatUnitParentPath(units: readonly OrganizationUnit[], unitId: string): string {
  return getUnitPath(units, unitId)
    .filter((unit) => unit.id !== unitId && unit.type !== 'organization')
    .reverse()
    .map((unit) => unit.name)
    .join(' / ')
}

export function getEffectiveUnitIds(units: readonly OrganizationUnit[], permissions: readonly UnitPermission[], memberId: string): string[] {
  const visible = new Set<string>()

  for (const permission of permissions.filter((item) => item.memberId === memberId)) {
    visible.add(permission.unitId)
    if (permission.propagateToChildren) {
      for (const childId of getDescendantUnitIds(units, permission.unitId)) visible.add(childId)
    }
  }

  return units.filter((unit) => visible.has(unit.id)).map((unit) => unit.id)
}

export function getManagedUnitIds(units: readonly OrganizationUnit[], permissions: readonly UnitPermission[], memberId: string): string[] {
  const manageable = new Set<string>()

  for (const permission of permissions.filter((item) => item.memberId === memberId && (item.access === 'manager' || item.access === 'admin'))) {
    manageable.add(permission.unitId)
    if (permission.propagateToChildren) {
      for (const childId of getDescendantUnitIds(units, permission.unitId)) manageable.add(childId)
    }
  }

  return units.filter((unit) => manageable.has(unit.id)).map((unit) => unit.id)
}

export function humanizeUnitType(type: OrganizationUnitType): string {
  return type === 'organization' ? 'Organization' : type.charAt(0).toUpperCase() + type.slice(1)
}

export function humanizeAccessLevel(access: AccessLevel): string {
  return access.charAt(0).toUpperCase() + access.slice(1)
}

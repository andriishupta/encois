export type OrganizationUnitType = 'organization' | 'department' | 'team' | 'project' | 'service' | 'custom'
export type AccessLevel = 'viewer' | 'contributor' | 'manager' | 'admin'

export type OrganizationUnit = {
  id: string
  parentId: string | null
  type: OrganizationUnitType
  name: string
  description: string
  manager: string
  memberCount: number
}

export type OrganizationMember = {
  id: string
  initials: string
  name: string
  email: string
  role: string
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

export const initialOrganizationUnits: readonly OrganizationUnit[] = [
  {
    id: 'organization',
    parentId: null,
    type: 'organization',
    name: 'Acme organization',
    description: 'The top-level organization boundary.',
    manager: 'Alex Morgan',
    memberCount: 18,
  },
  {
    id: 'engineering',
    parentId: 'organization',
    type: 'department',
    name: 'Engineering',
    description: 'Product engineering and delivery teams.',
    manager: 'Jamie Davis',
    memberCount: 9,
  },
  {
    id: 'operations',
    parentId: 'organization',
    type: 'department',
    name: 'Operations',
    description: 'Business operations and customer workflows.',
    manager: 'Alex Morgan',
    memberCount: 6,
  },
  {
    id: 'payments',
    parentId: 'engineering',
    type: 'team',
    name: 'Payments',
    description: 'Payment processing and financial reliability.',
    manager: 'Jamie Davis',
    memberCount: 4,
  },
  {
    id: 'checkout',
    parentId: 'engineering',
    type: 'team',
    name: 'Checkout',
    description: 'Checkout experience and conversion signals.',
    manager: 'Priya Shah',
    memberCount: 5,
  },
  {
    id: 'customer-success',
    parentId: 'operations',
    type: 'team',
    name: 'Customer success',
    description: 'Customer health and response coordination.',
    manager: 'Morgan Lee',
    memberCount: 3,
  },
]

export const organizationMembers: readonly OrganizationMember[] = [
  {
    id: 'alex-morgan',
    initials: 'AM',
    name: 'Alex Morgan',
    email: 'alex@acme.com',
    role: 'Organization administrator',
    homeUnitId: 'organization',
    status: 'Active',
  },
  {
    id: 'jamie-davis',
    initials: 'JD',
    name: 'Jamie Davis',
    email: 'jamie@acme.com',
    role: 'Manager',
    homeUnitId: 'engineering',
    status: 'Active',
  },
  {
    id: 'priya-shah',
    initials: 'PS',
    name: 'Priya Shah',
    email: 'priya@acme.com',
    role: 'Member',
    homeUnitId: 'checkout',
    status: 'Active',
  },
  {
    id: 'morgan-lee',
    initials: 'ML',
    name: 'Morgan Lee',
    email: 'morgan@acme.com',
    role: 'Member',
    homeUnitId: 'customer-success',
    status: 'Invited',
  },
]

export const initialUnitPermissions: readonly UnitPermission[] = [
  { id: 'permission-alex-root', memberId: 'alex-morgan', unitId: 'organization', access: 'admin', propagateToChildren: true },
  { id: 'permission-jamie-engineering', memberId: 'jamie-davis', unitId: 'engineering', access: 'manager', propagateToChildren: true },
  { id: 'permission-priya-checkout', memberId: 'priya-shah', unitId: 'checkout', access: 'contributor', propagateToChildren: true },
  { id: 'permission-priya-payments', memberId: 'priya-shah', unitId: 'payments', access: 'viewer', propagateToChildren: true },
  { id: 'permission-morgan-success', memberId: 'morgan-lee', unitId: 'customer-success', access: 'viewer', propagateToChildren: true },
]

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

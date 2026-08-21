import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { OrganizationProjection, OrganizationUnitCreateRequest } from '@encois/contracts'
import { createOrganizationPermission, createOrganizationUnit, deleteOrganizationPermission, getOrganization, isApiError, updateOrganizationPermission } from '@/lib/api'
import { isDashboardMockMode } from '@/lib/auth'
import {
  initialOrganizationUnits,
  initialUnitPermissions,
  organizationMembers,
  type AccessLevel,
  type OrganizationMember,
  type OrganizationUnit,
  type UnitPermission,
} from '@/lib/organization'
import { queryKeys } from '@/lib/query-keys'

type OrganizationContextValue = {
  units: OrganizationUnit[]
  setUnits: Dispatch<SetStateAction<OrganizationUnit[]>>
  members: OrganizationMember[]
  permissions: UnitPermission[]
  setPermissions: Dispatch<SetStateAction<UnitPermission[]>>
  currentUnitId: string
  setCurrentUnitId: Dispatch<SetStateAction<string>>
  isLoading: boolean
  isUsingApi: boolean
  error: string | null
  createUnit: (input: OrganizationUnitCreateRequest) => Promise<OrganizationUnit>
  createPermission: (input: { memberId: string; unitId: string; access: AccessLevel }) => Promise<UnitPermission>
  updatePermission: (permissionId: string, access: AccessLevel) => Promise<UnitPermission>
  removePermission: (permissionId: string) => Promise<void>
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null)

function toUnit(unit: OrganizationProjection['units'][number]): OrganizationUnit {
  return {
    id: unit.id,
    parentId: unit.parentId,
    type: unit.type,
    name: unit.name,
    description: unit.description,
    manager: unit.manager,
    memberCount: unit.memberCount,
  }
}

function toMember(member: OrganizationProjection['members'][number]): OrganizationMember {
  return {
    id: member.id,
    initials: member.initials,
    name: member.name,
    email: member.email ?? 'No email available',
    role: member.role,
    homeUnitId: member.homeUnitId ?? '',
    status: member.status.charAt(0).toUpperCase() + member.status.slice(1),
  }
}

function toPermission(permission: OrganizationProjection['permissions'][number]): UnitPermission {
  return {
    id: permission.id,
    memberId: permission.memberId,
    unitId: permission.unitId,
    access: permission.access,
    propagateToChildren: true,
  }
}

function isSoftApiError(error: unknown): boolean {
  return isApiError(error) && (error.status === 0 || error.status === 503)
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const mockMode = isDashboardMockMode()
  const query = useQuery<OrganizationProjection | null>({
    queryKey: queryKeys.organization(),
    queryFn: async () => {
      try {
        return await getOrganization()
      } catch (error) {
        if (mockMode && isSoftApiError(error)) return null
        throw error
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const [units, setUnits] = useState<OrganizationUnit[]>(() => mockMode ? [...initialOrganizationUnits] : [])
  const [members, setMembers] = useState<OrganizationMember[]>(() => mockMode ? [...organizationMembers] : [])
  const [permissions, setPermissions] = useState<UnitPermission[]>(() => mockMode ? [...initialUnitPermissions] : [])
  const [currentUnitId, setCurrentUnitId] = useState('organization')

  useEffect(() => {
    if (!query.data) return
    setUnits(query.data.units.map(toUnit))
    setMembers(query.data.members.map(toMember))
    setPermissions(query.data.permissions.map(toPermission))
  }, [query.data])

  useEffect(() => {
    if (!query.data || units.some((unit) => unit.id === currentUnitId)) return
    setCurrentUnitId(units.find((unit) => unit.parentId === null)?.id ?? units[0]?.id ?? '')
  }, [currentUnitId, query.data, units])

  const value = useMemo<OrganizationContextValue>(() => {
    const usingApi = query.data !== null && query.data !== undefined
    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.organization() })

    return {
      units,
      setUnits,
      members,
      permissions,
      setPermissions,
      currentUnitId,
      setCurrentUnitId,
      isLoading: query.isLoading,
      isUsingApi: usingApi,
      error: query.error instanceof Error ? query.error.message : null,
      async createUnit(input) {
        if (!usingApi) {
          if (!mockMode) throw new Error('Organization API is unavailable.')
          const id = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unit'}-${units.length}`
          const unit: OrganizationUnit = { id, parentId: input.parentId ?? null, type: input.type, name: input.name, description: 'A new organizational scope.', manager: 'Not assigned', memberCount: 0 }
          setUnits((current) => [...current, unit])
          return unit
        }
        const created = toUnit(await createOrganizationUnit(input))
        setUnits((current) => [...current, created])
        await refresh()
        return created
      },
      async createPermission(input) {
        if (!usingApi) {
          if (!mockMode) throw new Error('Organization API is unavailable.')
          const existing = permissions.find((permission) => permission.memberId === input.memberId && permission.unitId === input.unitId)
          if (existing) {
            const next = { ...existing, access: input.access, propagateToChildren: true }
            setPermissions((current) => current.map((permission) => permission.id === existing.id ? next : permission))
            return next
          }
          const permission: UnitPermission = { id: `permission-${input.memberId}-${input.unitId}-${permissions.length}`, ...input, propagateToChildren: true }
          setPermissions((current) => [...current, permission])
          return permission
        }
        const saved = toPermission(await createOrganizationPermission(input))
        setPermissions((current) => {
          const existing = current.find((permission) => permission.id === saved.id || (permission.memberId === saved.memberId && permission.unitId === saved.unitId))
          return existing ? current.map((permission) => permission.id === existing.id ? saved : permission) : [...current, saved]
        })
        await refresh()
        return saved
      },
      async updatePermission(permissionId, access) {
        if (!usingApi) {
          if (!mockMode) throw new Error('Organization API is unavailable.')
          let updated: UnitPermission | undefined
          setPermissions((current) => current.map((permission) => {
            if (permission.id !== permissionId) return permission
            updated = { ...permission, access }
            return updated
          }))
          if (!updated) throw new Error('Permission not found.')
          return updated
        }
        const updated = toPermission(await updateOrganizationPermission(permissionId, { access }))
        setPermissions((current) => current.map((permission) => permission.id === permissionId ? updated : permission))
        await refresh()
        return updated
      },
      async removePermission(permissionId) {
        if (!usingApi) {
          if (!mockMode) throw new Error('Organization API is unavailable.')
          setPermissions((current) => current.filter((permission) => permission.id !== permissionId))
          return
        }
        await deleteOrganizationPermission(permissionId)
        setPermissions((current) => current.filter((permission) => permission.id !== permissionId))
        await refresh()
      },
    }
  }, [currentUnitId, members, mockMode, permissions, query.data, query.error, query.isLoading, queryClient, units])

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}

export function useOrganization(): OrganizationContextValue {
  const value = useContext(OrganizationContext)
  if (!value) throw new Error('useOrganization must be used within OrganizationProvider')
  return value
}

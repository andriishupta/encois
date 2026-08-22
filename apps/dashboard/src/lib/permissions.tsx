import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { permissionIncludes, type PermissionKey } from '@encois/contracts'
import { authSessionEventName, getAuthSession } from '@/lib/auth'

type PermissionContextValue = {
  permissions: readonly PermissionKey[]
  can: (permission: PermissionKey) => boolean
}

const PermissionContext = createContext<PermissionContextValue | null>(null)

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<readonly PermissionKey[]>(() => getAuthSession()?.permissions ?? [])

  useEffect(() => {
    const update = () => setPermissions(getAuthSession()?.permissions ?? [])
    const eventName = authSessionEventName()
    window.addEventListener(eventName, update)
    return () => window.removeEventListener(eventName, update)
  }, [])

  const value = {
    permissions,
    can: (permission: PermissionKey) => permissionIncludes(permissions, permission),
  }

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>
}

export function usePermissions() {
  const context = useContext(PermissionContext)
  if (!context) throw new Error('usePermissions must be used inside PermissionProvider')
  return context
}

export function useCan(permission: PermissionKey): boolean {
  return usePermissions().can(permission)
}

export function Can({ permission, children, fallback = null }: { permission: PermissionKey; children: ReactNode; fallback?: ReactNode }) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>
}

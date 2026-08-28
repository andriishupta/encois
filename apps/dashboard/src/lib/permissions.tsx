import {
  type PermissionKey,
  permissionIncludes,
} from "@encois/contracts/browser";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { authSessionEventName, getAuthSession } from "@/lib/auth";

const permissionDescriptions: Readonly<Record<PermissionKey, string>> = {
  "onboarding:manage": "Set up the initial workspace foundation and defaults.",
  "workflows:read": "View workflow definitions, plans, and execution history.",
  "workflows:run": "Start an approved workflow within your authorized scope.",
  "workflows:manage": "Create, configure, approve, and manage workflows.",
  "integrations:read": "View organization integrations and their availability.",
  "integrations:manage":
    "Register, configure, and manage provider integrations.",
  "knowledge:read": "View Sources and the knowledge available to your scope.",
  "knowledge:manage": "Create and manage Sources and their revisions.",
  "context:read":
    "Inspect organization context and graph-backed relationships.",
  "memory:read":
    "View workflow and organization memory available to your scope.",
  "memory:manage": "Create and manage memory changes and investigations.",
  "organization:read":
    "View the organization structure, members, and access state.",
  "organization:manage": "Manage organization units, members, and permissions.",
  "settings:read": "View workspace settings and product documentation.",
  "settings:manage": "Update workspace and notification settings.",
};

export function describePermission(permission: PermissionKey): string {
  return permissionDescriptions[permission];
}

type PermissionContextValue = {
  permissions: readonly PermissionKey[];
  can: (permission: PermissionKey) => boolean;
};

const PermissionContext = createContext<PermissionContextValue | null>(null);

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<readonly PermissionKey[]>(
    () => getAuthSession()?.permissions ?? [],
  );

  useEffect(() => {
    const update = () => setPermissions(getAuthSession()?.permissions ?? []);
    const eventName = authSessionEventName();
    window.addEventListener(eventName, update);
    return () => window.removeEventListener(eventName, update);
  }, []);

  const value = {
    permissions,
    can: (permission: PermissionKey) =>
      permissionIncludes(permissions, permission),
  };

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (!context)
    throw new Error("usePermissions must be used inside PermissionProvider");
  return context;
}

export function useCan(permission: PermissionKey): boolean {
  return usePermissions().can(permission);
}

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(permission) ? children : fallback;
}

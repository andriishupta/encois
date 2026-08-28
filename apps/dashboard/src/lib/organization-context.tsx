import type {
  OrganizationProjection,
  OrganizationUnitCreateRequest,
} from "@encois/contracts/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createOrganizationPermission,
  createOrganizationUnit,
  deleteOrganizationPermission,
  getOrganization,
  isApiError,
  updateOrganizationPermission,
} from "@/lib/api";
import type {
  AccessLevel,
  OrganizationMember,
  OrganizationUnit,
  UnitPermission,
} from "@/lib/organization";
import { queryKeys } from "@/lib/query-keys";

type OrganizationContextValue = {
  organizationName: string | null;
  onboarding: OrganizationProjection["onboarding"] | null;
  units: OrganizationUnit[];
  setUnits: Dispatch<SetStateAction<OrganizationUnit[]>>;
  members: OrganizationMember[];
  permissions: UnitPermission[];
  setPermissions: Dispatch<SetStateAction<UnitPermission[]>>;
  currentUnitId: string;
  setCurrentUnitId: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
  errorCode: string | null;
  createUnit: (
    input: OrganizationUnitCreateRequest,
  ) => Promise<OrganizationUnit>;
  createPermission: (input: {
    memberId: string;
    unitId: string;
    access: AccessLevel;
  }) => Promise<UnitPermission>;
  updatePermission: (
    permissionId: string,
    access: AccessLevel,
  ) => Promise<UnitPermission>;
  removePermission: (permissionId: string) => Promise<void>;
};

const OrganizationContext = createContext<OrganizationContextValue | null>(
  null,
);

const currentUnitStorageKeyPrefix = "encois:v1:organization-unit:";

function currentUnitStorageKey(organizationId: string): string {
  return `${currentUnitStorageKeyPrefix}${organizationId}`;
}

function readStoredUnitId(organizationId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(
      currentUnitStorageKey(organizationId),
    );
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function writeStoredUnitId(organizationId: string, unitId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(currentUnitStorageKey(organizationId), unitId);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function clearStoredUnitId(organizationId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(currentUnitStorageKey(organizationId));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function toUnit(
  unit: OrganizationProjection["units"][number],
): OrganizationUnit {
  return {
    id: unit.id,
    parentId: unit.parentId,
    type: unit.type,
    name: unit.name,
    description: unit.description,
    canView: unit.canView,
    canManage: unit.canManage,
    manager: unit.manager,
    directMemberCount: unit.directMemberCount,
    inheritedMemberCount: unit.inheritedMemberCount,
  };
}

function toMember(
  member: OrganizationProjection["members"][number],
): OrganizationMember {
  return {
    id: member.id,
    initials: member.initials,
    name: member.name,
    email: member.email ?? "No email available",
    role: member.role,
    roleKey: member.roleKey,
    homeUnitId: member.homeUnitId ?? "",
    status: member.status.charAt(0).toUpperCase() + member.status.slice(1),
  };
}

function toPermission(
  permission: OrganizationProjection["permissions"][number],
): UnitPermission {
  return {
    id: permission.id,
    memberId: permission.memberId,
    unitId: permission.unitId,
    access: permission.access,
    propagateToChildren: true,
  };
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery<OrganizationProjection | null>({
    queryKey: queryKeys.organization(),
    queryFn: getOrganization,
    refetchInterval: (currentQuery) =>
      currentQuery.state.data?.onboarding.status === "initializing"
        ? 5_000
        : false,
  });
  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [permissions, setPermissions] = useState<UnitPermission[]>([]);
  const [currentUnitId, setCurrentUnitId] = useState("organization");
  const lastObservedUnitId = useRef<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const nextUnits = query.data.units.map(toUnit);
    setUnits(nextUnits);
    setMembers(query.data.members.map(toMember));
    setPermissions(query.data.permissions.map(toPermission));

    const organizationId = query.data.organization.id;
    const storedUnitId = readStoredUnitId(organizationId);
    const storedUnit = storedUnitId
      ? nextUnits.find((unit) => unit.id === storedUnitId && unit.canView)
      : undefined;
    const fallbackUnit = nextUnits.find((unit) => unit.canView);
    const nextUnitId = storedUnit?.id ?? fallbackUnit?.id ?? "";

    if (storedUnitId && storedUnitId !== nextUnitId) {
      clearStoredUnitId(organizationId);
    }
    setCurrentUnitId((current) =>
      current === nextUnitId ? current : nextUnitId,
    );
  }, [query.data]);

  useEffect(() => {
    if (
      !currentUnitId ||
      !units.some((unit) => unit.id === currentUnitId && unit.canView)
    )
      return;
    if (lastObservedUnitId.current === null) {
      lastObservedUnitId.current = currentUnitId;
      return;
    }
    if (lastObservedUnitId.current === currentUnitId) return;
    lastObservedUnitId.current = currentUnitId;

    // Some queries encode the unit in their key; others are organization-wide
    // but still depend on the selected scope in their rendered result. Refresh
    // the complete cache so a unit switch cannot leave a mixed view behind.
    void queryClient.invalidateQueries();
  }, [currentUnitId, queryClient, units]);

  useEffect(() => {
    const organizationId = query.data?.organization.id;
    const currentUnit = query.data?.units.find(
      (unit) => unit.id === currentUnitId && unit.canView,
    );
    if (!organizationId || !currentUnit?.canView) return;
    writeStoredUnitId(organizationId, currentUnit.id);
  }, [currentUnitId, query.data]);

  const value = useMemo<OrganizationContextValue>(() => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organization() });

    return {
      organizationName: query.data?.organization.name ?? null,
      onboarding: query.data?.onboarding ?? null,
      units,
      setUnits,
      members,
      permissions,
      setPermissions,
      currentUnitId,
      setCurrentUnitId,
      isLoading: query.isLoading,
      isLoaded: query.isSuccess,
      error: query.error instanceof Error ? query.error.message : null,
      errorCode: isApiError(query.error) ? (query.error.code ?? null) : null,
      async createUnit(input) {
        const created = toUnit(await createOrganizationUnit(input));
        setUnits((current) => [...current, created]);
        await refresh();
        return created;
      },
      async createPermission(input) {
        const saved = toPermission(await createOrganizationPermission(input));
        setPermissions((current) => {
          const existing = current.find(
            (permission) =>
              permission.id === saved.id ||
              (permission.memberId === saved.memberId &&
                permission.unitId === saved.unitId),
          );
          return existing
            ? current.map((permission) =>
                permission.id === existing.id ? saved : permission,
              )
            : [...current, saved];
        });
        await refresh();
        return saved;
      },
      async updatePermission(permissionId, access) {
        const updated = toPermission(
          await updateOrganizationPermission(permissionId, { access }),
        );
        setPermissions((current) =>
          current.map((permission) =>
            permission.id === permissionId ? updated : permission,
          ),
        );
        await refresh();
        return updated;
      },
      async removePermission(permissionId) {
        await deleteOrganizationPermission(permissionId);
        setPermissions((current) =>
          current.filter((permission) => permission.id !== permissionId),
        );
        await refresh();
      },
    };
  }, [
    currentUnitId,
    members,
    permissions,
    query.data,
    query.error,
    query.isLoading,
    query.isSuccess,
    queryClient,
    units,
  ]);

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextValue {
  const value = useContext(OrganizationContext);
  if (!value)
    throw new Error("useOrganization must be used within OrganizationProvider");
  return value;
}

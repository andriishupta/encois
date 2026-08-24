import type {
  OrganizationProjection,
  OrganizationUnitCreateRequest,
} from "@encois/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
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
    memberCount: unit.memberCount,
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
  });
  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [permissions, setPermissions] = useState<UnitPermission[]>([]);
  const [currentUnitId, setCurrentUnitId] = useState("organization");

  useEffect(() => {
    if (!query.data) return;
    setUnits(query.data.units.map(toUnit));
    setMembers(query.data.members.map(toMember));
    setPermissions(query.data.permissions.map(toPermission));
  }, [query.data]);

  useEffect(() => {
    if (!query.data || units.some((unit) => unit.id === currentUnitId)) return;
    setCurrentUnitId(
      units.find((unit) => unit.id === currentUnitId && unit.canView)?.id ??
        units.find((unit) => unit.canView)?.id ??
        "",
    );
  }, [currentUnitId, query.data, units]);

  useEffect(() => {
    const currentUnit = units.find((unit) => unit.id === currentUnitId);
    if (currentUnit?.canView) return;
    setCurrentUnitId(units.find((unit) => unit.canView)?.id ?? "");
  }, [currentUnitId, units]);

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

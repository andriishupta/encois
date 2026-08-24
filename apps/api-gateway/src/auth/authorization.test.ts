import { Permission, permissionIncludes } from "@encois/contracts";
import { describe, expect, it } from "vitest";
import type { AosPrincipal } from "../middleware/aos.js";
import {
  hasAnyPermission,
  hasPermissions,
  isOrganizationAdministrator,
  isOrganizationAdministratorRole,
} from "./authorization.js";

const principal: AosPrincipal = {
  actorId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  scope: ["engineering"],
};

function roleDatabase(roleKey: string) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [{ roleKey }],
          }),
        }),
      }),
    }),
  } as never;
}

function permissionsDatabase(permissions: readonly Permission[]) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => permissions.map((permission) => ({ permission })),
        }),
      }),
    }),
  } as never;
}

describe("authorization boundaries", () => {
  it("does not treat organization:manage as a tenant-wide bypass", () => {
    expect(
      permissionIncludes(
        [Permission.OrganizationManage],
        Permission.IntegrationsManage,
      ),
    ).toBe(false);
    expect(
      permissionIncludes(
        [Permission.OrganizationManage],
        Permission.KnowledgeManage,
      ),
    ).toBe(false);
  });

  it("keeps workflow preview and integration-backed source access separate", () => {
    expect(
      permissionIncludes(
        [Permission.WorkflowsRead],
        Permission.IntegrationsRead,
      ),
    ).toBe(false);
    expect(
      permissionIncludes(
        [Permission.KnowledgeManage],
        Permission.IntegrationsRead,
      ),
    ).toBe(false);
  });

  it("keeps manager role access scoped even when it has organization management permission", async () => {
    await expect(
      isOrganizationAdministrator(roleDatabase("manager"), principal),
    ).resolves.toBe(false);
  });

  it("recognizes only organization administrator roles as tenant-wide administrators", async () => {
    expect(isOrganizationAdministratorRole("manager")).toBe(false);
    expect(isOrganizationAdministratorRole("organization_admin")).toBe(true);
    await expect(
      isOrganizationAdministrator(
        roleDatabase("organization_admin"),
        principal,
      ),
    ).resolves.toBe(true);
    await expect(
      isOrganizationAdministrator(roleDatabase("admin"), principal),
    ).resolves.toBe(true);
  });

  it("evaluates multiple required permissions from one granted permission set", async () => {
    const db = permissionsDatabase([Permission.WorkflowsManage]);

    await expect(
      hasPermissions(db, principal, [Permission.WorkflowsRead]),
    ).resolves.toBe(true);
    await expect(
      hasPermissions(db, principal, [
        Permission.WorkflowsRead,
        Permission.IntegrationsRead,
      ]),
    ).resolves.toBe(false);
  });

  it("evaluates any-permission checks without weakening permission implications", async () => {
    const db = permissionsDatabase([Permission.KnowledgeManage]);

    await expect(
      hasAnyPermission(db, principal, [
        Permission.IntegrationsRead,
        Permission.KnowledgeRead,
      ]),
    ).resolves.toBe(true);
    await expect(
      hasAnyPermission(db, principal, [
        Permission.IntegrationsRead,
        Permission.WorkflowsRead,
      ]),
    ).resolves.toBe(false);
  });
});

import { Permission, permissionIncludes } from "@encois/contracts";
import { describe, expect, it } from "vitest";
import type { AosPrincipal } from "../middleware/aos.js";
import { isOrganizationAdministrator, isOrganizationAdministratorRole } from "./authorization.js";

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

describe("authorization boundaries", () => {
  it("does not treat organization:manage as a tenant-wide bypass", () => {
    expect(permissionIncludes([Permission.OrganizationManage], Permission.IntegrationsManage)).toBe(false);
    expect(permissionIncludes([Permission.OrganizationManage], Permission.KnowledgeManage)).toBe(false);
  });

  it("keeps workflow preview and integration-backed source access separate", () => {
    expect(permissionIncludes([Permission.WorkflowsRead], Permission.IntegrationsRead)).toBe(false);
    expect(permissionIncludes([Permission.KnowledgeManage], Permission.IntegrationsRead)).toBe(false);
  });

  it("keeps manager role access scoped even when it has organization management permission", async () => {
    await expect(isOrganizationAdministrator(roleDatabase("manager"), principal)).resolves.toBe(false);
  });

  it("recognizes only organization administrator roles as tenant-wide administrators", async () => {
    expect(isOrganizationAdministratorRole("manager")).toBe(false);
    expect(isOrganizationAdministratorRole("organization_admin")).toBe(true);
    await expect(isOrganizationAdministrator(roleDatabase("organization_admin"), principal)).resolves.toBe(true);
    await expect(isOrganizationAdministrator(roleDatabase("admin"), principal)).resolves.toBe(true);
  });
});

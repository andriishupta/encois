import { Hono } from "hono";
import type { Context } from "hono";
import {
  AccessLevel,
  OrganizationUnitType,
  type OrganizationPermissionCreateRequest,
  type OrganizationPermissionUpdateRequest,
  type OrganizationUnitCreateRequest,
} from "@encois/contracts";
import type { GatewayEnv } from "../middleware/aos.js";
import {
  createOrganizationPermissionForPrincipal,
  createOrganizationUnitForPrincipal,
  deleteOrganizationPermissionForPrincipal,
  getOrganizationForPrincipal,
  isOrganizationServiceError,
  listOrganizationMembersForPrincipal,
  listOrganizationPermissionsForPrincipal,
  listOrganizationUnitsForPrincipal,
  updateOrganizationPermissionForPrincipal,
} from "./services/organization.service.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value.trim() : null;
}

function parseUnitCreate(value: unknown): OrganizationUnitCreateRequest | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.type !== "string") return null;
  if (!Object.values(OrganizationUnitType).includes(value.type as OrganizationUnitType)) return null;
  const parentId = optionalString(value.parentId);
  const slug = optionalString(value.slug);
  if (parentId === null || slug === null) return null;
  return {
    name: value.name,
    type: value.type as OrganizationUnitType,
    ...(parentId === undefined ? {} : { parentId: parentId || null }),
    ...(slug === undefined ? {} : { slug }),
  };
}

function parsePermissionCreate(value: unknown): OrganizationPermissionCreateRequest | null {
  if (!isRecord(value) || typeof value.memberId !== "string" || typeof value.unitId !== "string" || typeof value.access !== "string") return null;
  if (!Object.values(AccessLevel).includes(value.access as AccessLevel)) return null;
  return { memberId: value.memberId.trim(), unitId: value.unitId.trim(), access: value.access as AccessLevel };
}

function parsePermissionUpdate(value: unknown): OrganizationPermissionUpdateRequest | null {
  if (!isRecord(value) || typeof value.access !== "string" || !Object.values(AccessLevel).includes(value.access as AccessLevel)) return null;
  return { access: value.access as AccessLevel };
}

function statusForError(code: string): 400 | 403 | 404 | 409 | 503 {
  if (code === "PERSISTENCE_UNAVAILABLE") return 503;
  if (code === "FORBIDDEN") return 403;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code === "DUPLICATE_ORGANIZATION_UNIT") return 409;
  return 400;
}

function errorResponse(context: Context<GatewayEnv>, error: unknown) {
  if (!isOrganizationServiceError(error)) throw error;
  return context.json({ error: { code: error.code, message: error.message } }, statusForError(error.code));
}

export function createOrganizationRouter(): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();

  router.get("/", async (context) => {
    try {
      return context.json({ data: await getOrganizationForPrincipal(context.get("principal")) });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.get("/units", async (context) => {
    try {
      return context.json({ data: await listOrganizationUnitsForPrincipal(context.get("principal")) });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.post("/units", async (context) => {
    const request = parseUnitCreate(await context.req.json().catch(() => null));
    if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid organization unit is required." } }, 400);
    try {
      return context.json({ data: await createOrganizationUnitForPrincipal(context.get("principal"), request) }, 201);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.get("/members", async (context) => {
    try {
      return context.json({ data: await listOrganizationMembersForPrincipal(context.get("principal")) });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.get("/permissions", async (context) => {
    try {
      return context.json({ data: await listOrganizationPermissionsForPrincipal(context.get("principal")) });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.post("/permissions", async (context) => {
    const request = parsePermissionCreate(await context.req.json().catch(() => null));
    if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid organization permission is required." } }, 400);
    try {
      return context.json({ data: await createOrganizationPermissionForPrincipal(context.get("principal"), request) }, 201);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.patch("/permissions/:permissionId", async (context) => {
    const request = parsePermissionUpdate(await context.req.json().catch(() => null));
    if (!request) return context.json({ error: { code: "INVALID_REQUEST", message: "A valid permission access level is required." } }, 400);
    try {
      return context.json({ data: await updateOrganizationPermissionForPrincipal(context.get("principal"), context.req.param("permissionId"), request) });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.delete("/permissions/:permissionId", async (context) => {
    try {
      await deleteOrganizationPermissionForPrincipal(context.get("principal"), context.req.param("permissionId"));
      return context.json({ data: { deleted: true } });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  return router;
}

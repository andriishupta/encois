import {
  AccessLevel,
  CoordinationMode,
  isJsonObject,
  type OrganizationAccessRequestCreateRequest,
  type OrganizationOnboardingUpdateRequest,
  type OrganizationPermissionCreateRequest,
  type OrganizationPermissionUpdateRequest,
  type OrganizationUnitCreateRequest,
  OrganizationUnitType,
} from "@encois/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import {
  applyOrganizationAccessRequestForPrincipal,
  createOrganizationAccessRequestForPrincipal,
  createOrganizationPermissionForPrincipal,
  createOrganizationUnitForPrincipal,
  decideOrganizationAccessRequestForPrincipal,
  deleteOrganizationPermissionForPrincipal,
  getOrganizationForPrincipal,
  isOrganizationServiceError,
  listOrganizationAccessRequestsForPrincipal,
  listOrganizationMembersForPrincipal,
  listOrganizationPermissionsForPrincipal,
  listOrganizationUnitsForPrincipal,
  type OrganizationOnboardingServiceOptions,
  startOrganizationOnboardingForPrincipal,
  updateOrganizationOnboardingForPrincipal,
  updateOrganizationPermissionForPrincipal,
} from "./services/organization.service.js";

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value.trim() : null;
}

function parseUnitCreate(value: unknown): OrganizationUnitCreateRequest | null {
  if (
    !isJsonObject(value) ||
    typeof value.name !== "string" ||
    typeof value.type !== "string"
  )
    return null;
  if (
    !Object.values(OrganizationUnitType).includes(
      value.type as OrganizationUnitType,
    )
  )
    return null;
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

function parsePermissionCreate(
  value: unknown,
): OrganizationPermissionCreateRequest | null {
  if (
    !isJsonObject(value) ||
    typeof value.memberId !== "string" ||
    typeof value.unitId !== "string" ||
    typeof value.access !== "string"
  )
    return null;
  if (!Object.values(AccessLevel).includes(value.access as AccessLevel))
    return null;
  return {
    memberId: value.memberId.trim(),
    unitId: value.unitId.trim(),
    access: value.access as AccessLevel,
  };
}

function parsePermissionUpdate(
  value: unknown,
): OrganizationPermissionUpdateRequest | null {
  if (
    !isJsonObject(value) ||
    typeof value.access !== "string" ||
    !Object.values(AccessLevel).includes(value.access as AccessLevel)
  )
    return null;
  return { access: value.access as AccessLevel };
}

function parseAccessRequestCreate(
  value: unknown,
): OrganizationAccessRequestCreateRequest | null {
  if (
    !isJsonObject(value) ||
    typeof value.unitId !== "string" ||
    typeof value.access !== "string" ||
    typeof value.reason !== "string"
  )
    return null;
  if (
    !Object.values(AccessLevel).includes(value.access as AccessLevel) ||
    value.access === AccessLevel.Admin
  )
    return null;
  return {
    unitId: value.unitId.trim(),
    access: value.access as Exclude<AccessLevel, "admin">,
    reason: value.reason,
  };
}

function parseOnboardingUpdate(
  value: unknown,
): OrganizationOnboardingUpdateRequest | null {
  if (!isJsonObject(value)) return null;
  const hasCoordinationMode = value.coordinationMode !== undefined;
  const hasSelectedWorkflows = value.selectedWorkflows !== undefined;
  if (!hasCoordinationMode && !hasSelectedWorkflows) return null;
  if (
    value.coordinationMode !== undefined &&
    (typeof value.coordinationMode !== "string" ||
      !Object.values(CoordinationMode).includes(
        value.coordinationMode as CoordinationMode,
      ))
  )
    return null;
  if (
    value.selectedWorkflows !== undefined &&
    (!Array.isArray(value.selectedWorkflows) ||
      value.selectedWorkflows.some((item) => typeof item !== "string"))
  )
    return null;
  return {
    ...(typeof value.coordinationMode === "string"
      ? { coordinationMode: value.coordinationMode as CoordinationMode }
      : {}),
    ...(Array.isArray(value.selectedWorkflows)
      ? { selectedWorkflows: value.selectedWorkflows }
      : {}),
  };
}

function statusForError(code: string): 400 | 403 | 404 | 409 | 503 {
  if (code === "PERSISTENCE_UNAVAILABLE") return 503;
  if (code === "ORGANIZATION_ONBOARDING_NOT_FOUND") return 503;
  if (code === "FORBIDDEN") return 403;
  if (code === "ONBOARDING_START_FAILED") return 503;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (
    code.endsWith("_CONFLICT") ||
    code.endsWith("_NOT_DECIDABLE") ||
    code.endsWith("_NOT_APPLICABLE") ||
    code === "DUPLICATE_ORGANIZATION_UNIT"
  )
    return 409;
  return 400;
}

function errorResponse(context: Context<GatewayEnv>, error: unknown) {
  if (!isOrganizationServiceError(error)) throw error;
  return context.json(
    { error: { code: error.code, message: error.message } },
    statusForError(error.code),
  );
}

export function createOrganizationRouter(
  options?: OrganizationOnboardingServiceOptions,
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();

  router.get("/", async (context) => {
    try {
      return context.json({
        data: await getOrganizationForPrincipal(
          context.get("principal"),
          options,
        ),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.patch("/onboarding", async (context) => {
    const request = parseOnboardingUpdate(
      await context.req.json().catch(() => null),
    );
    if (!request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A valid onboarding configuration is required.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await updateOrganizationOnboardingForPrincipal(
          context.get("principal"),
          request,
        ),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.post("/onboarding/start", async (context) => {
    if (!options)
      return context.json(
        {
          error: {
            code: "PERSISTENCE_UNAVAILABLE",
            message: "Coordinator onboarding is not configured.",
          },
        },
        503,
      );
    try {
      return context.json({
        data: await startOrganizationOnboardingForPrincipal(
          context.get("principal"),
          context.get("requestId"),
          options,
        ),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.get("/units", async (context) => {
    try {
      return context.json({
        data: await listOrganizationUnitsForPrincipal(context.get("principal")),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.post("/units", async (context) => {
    const request = parseUnitCreate(await context.req.json().catch(() => null));
    if (!request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A valid organization unit is required.",
          },
        },
        400,
      );
    try {
      return context.json(
        {
          data: await createOrganizationUnitForPrincipal(
            context.get("principal"),
            request,
          ),
        },
        201,
      );
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.get("/members", async (context) => {
    try {
      return context.json({
        data: await listOrganizationMembersForPrincipal(
          context.get("principal"),
        ),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.get("/permissions", async (context) => {
    try {
      return context.json({
        data: await listOrganizationPermissionsForPrincipal(
          context.get("principal"),
        ),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.post("/permissions", async (context) => {
    const request = parsePermissionCreate(
      await context.req.json().catch(() => null),
    );
    if (!request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A valid organization permission is required.",
          },
        },
        400,
      );
    try {
      return context.json(
        {
          data: await createOrganizationPermissionForPrincipal(
            context.get("principal"),
            request,
          ),
        },
        201,
      );
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.patch("/permissions/:permissionId", async (context) => {
    const request = parsePermissionUpdate(
      await context.req.json().catch(() => null),
    );
    if (!request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A valid permission access level is required.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await updateOrganizationPermissionForPrincipal(
          context.get("principal"),
          context.req.param("permissionId"),
          request,
        ),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.delete("/permissions/:permissionId", async (context) => {
    try {
      await deleteOrganizationPermissionForPrincipal(
        context.get("principal"),
        context.req.param("permissionId"),
      );
      return context.json({ data: { deleted: true } });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.get("/access-requests", async (context) => {
    try {
      return context.json({
        data: await listOrganizationAccessRequestsForPrincipal(
          context.get("principal"),
        ),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  router.post("/access-requests", async (context) => {
    const request = parseAccessRequestCreate(
      await context.req.json().catch(() => null),
    );
    if (!request)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message:
              "A visible organization unit, non-admin access level, and reason are required.",
          },
        },
        400,
      );
    try {
      return context.json(
        {
          data: await createOrganizationAccessRequestForPrincipal(
            context.get("principal"),
            request,
          ),
        },
        201,
      );
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  for (const decision of ["approve", "reject"] as const) {
    router.post(`/access-requests/:requestId/${decision}`, async (context) => {
      const requestId = context.req.param("requestId")?.trim();
      if (!requestId)
        return context.json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: "Access request id is required.",
            },
          },
          400,
        );
      try {
        return context.json({
          data: await decideOrganizationAccessRequestForPrincipal(
            context.get("principal"),
            requestId,
            decision === "approve" ? "approved" : "rejected",
          ),
        });
      } catch (error) {
        return errorResponse(context, error);
      }
    });
  }

  router.post("/access-requests/:requestId/apply", async (context) => {
    const requestId = context.req.param("requestId")?.trim();
    if (!requestId)
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Access request id is required.",
          },
        },
        400,
      );
    try {
      return context.json({
        data: await applyOrganizationAccessRequestForPrincipal(
          context.get("principal"),
          requestId,
        ),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  return router;
}

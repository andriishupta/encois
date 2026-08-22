import { and, desc, eq, inArray } from "drizzle-orm";
import { Permission, isJsonObject, type ExecutionScope, type JsonObject, type SavedInvestigation, type SavedInvestigationCreateRequest } from "@encois/contracts";
import { savedInvestigations, withOrganizationContext } from "@encois/persistence";
import { database } from "../database.js";
import type { AosPrincipal } from "../middleware/aos.js";
import { hasPermission } from "../auth/authorization.js";

export type InvestigationServiceError = Error & { code: string };

function error(code: string, message: string): InvestigationServiceError {
  const value = new Error(message) as InvestigationServiceError;
  value.code = code;
  return value;
}

export function isInvestigationServiceError(value: unknown): value is InvestigationServiceError {
  return value instanceof Error && typeof (value as Partial<InvestigationServiceError>).code === "string";
}

function userId(principal: AosPrincipal): string {
  const value = principal.userId ?? principal.actorId;
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw error("IDENTITY_NOT_RESOLVED", "The identity is not linked to a local user.");
  return value;
}

function scope(value: unknown): ExecutionScope | null {
  if (!isJsonObject(value) || !Array.isArray(value.ids) || value.ids.length === 0 || value.ids.some((id) => typeof id !== "string" || id.length === 0)) return null;
  return { ids: [...new Set(value.ids as string[])] };
}

function scopeWithinPrincipal(value: ExecutionScope, principal: AosPrincipal): boolean {
  return principal.scope.includes("*") || value.ids.every((id) => principal.scope.includes(id));
}

function toSavedInvestigation(row: typeof savedInvestigations.$inferSelect): SavedInvestigation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    kind: row.kind as SavedInvestigation["kind"],
    query: row.query,
    params: isJsonObject(row.params) ? row.params : {},
    scope: scope(row.scope) ?? { ids: [] },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSavedInvestigations(principal: AosPrincipal): Promise<readonly SavedInvestigation[]> {
  if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  const ownerUserId = userId(principal);
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.WorkflowsRead)) && !(await hasPermission(db, principal, Permission.KnowledgeRead)) && !(await hasPermission(db, principal, Permission.OrganizationManage)) && !(await hasPermission(db, principal, Permission.ContextRead)) && !(await hasPermission(db, principal, Permission.MemoryRead))) {
      throw error("FORBIDDEN", "The user cannot read saved investigations.");
    }
    const rows = await db.select().from(savedInvestigations).where(and(eq(savedInvestigations.organizationId, principal.organizationId), eq(savedInvestigations.ownerUserId, ownerUserId))).orderBy(desc(savedInvestigations.updatedAt));
    return rows.filter((row) => {
      const savedScope = scope(row.scope);
      return savedScope ? scopeWithinPrincipal(savedScope, principal) : false;
    }).map(toSavedInvestigation);
  });
}

export async function createSavedInvestigation(principal: AosPrincipal, request: SavedInvestigationCreateRequest): Promise<SavedInvestigation> {
  if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  const ownerUserId = userId(principal);
  if (!request.name.trim() || request.name.trim().length > 120) throw error("INVALID_INVESTIGATION_NAME", "A saved investigation name is required and must be at most 120 characters.");
  if (!new Set(["graph", "memory", "workflow"]).has(request.kind)) throw error("INVALID_INVESTIGATION_KIND", "The saved investigation kind is not supported.");
  if (!request.query.trim() || request.query.length > 500) throw error("INVALID_INVESTIGATION_QUERY", "A saved investigation query is required and must be at most 500 characters.");
  if (request.params !== undefined && !isJsonObject(request.params)) throw error("INVALID_INVESTIGATION_PARAMS", "Investigation parameters must be an object.");
  const savedScope = scope(request.scope);
  if (!savedScope || !scopeWithinPrincipal(savedScope, principal)) throw error("SCOPE_DENIED", "A saved investigation scope cannot exceed the caller's scope.");

  return withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.WorkflowsRead)) && !(await hasPermission(db, principal, Permission.KnowledgeRead)) && !(await hasPermission(db, principal, Permission.OrganizationManage)) && !(await hasPermission(db, principal, Permission.ContextRead)) && !(await hasPermission(db, principal, Permission.MemoryRead))) {
      throw error("FORBIDDEN", "The user cannot create saved investigations.");
    }
    const [row] = await db.insert(savedInvestigations).values({
      organizationId: principal.organizationId,
      ownerUserId,
      name: request.name.trim(),
      kind: request.kind,
      query: request.query.trim(),
      params: request.params ?? {},
      scope: savedScope,
    }).returning();
    if (!row) throw error("INVESTIGATION_CREATE_FAILED", "The saved investigation could not be created.");
    return toSavedInvestigation(row);
  });
}

export async function deleteSavedInvestigation(principal: AosPrincipal, investigationId: string): Promise<boolean> {
  if (!database) throw error("PERSISTENCE_UNAVAILABLE", "Database access is not configured.");
  const ownerUserId = userId(principal);
  return withOrganizationContext(database, principal.organizationId, async (db) => {
    if (!(await hasPermission(db, principal, Permission.WorkflowsRead)) && !(await hasPermission(db, principal, Permission.KnowledgeRead)) && !(await hasPermission(db, principal, Permission.OrganizationManage)) && !(await hasPermission(db, principal, Permission.ContextRead)) && !(await hasPermission(db, principal, Permission.MemoryRead))) throw error("FORBIDDEN", "The user cannot delete saved investigations.");
    const result = await db.delete(savedInvestigations).where(and(eq(savedInvestigations.id, investigationId), eq(savedInvestigations.organizationId, principal.organizationId), eq(savedInvestigations.ownerUserId, ownerUserId))).returning({ id: savedInvestigations.id });
    return result.length > 0;
  });
}

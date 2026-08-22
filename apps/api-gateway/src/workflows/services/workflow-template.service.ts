import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  workflowTemplateVersions,
  workflowTemplates,
  withOrganizationContext,
  type WorkflowTemplate,
} from "@encois/persistence";
import type { AosPrincipal } from "../../middleware/aos.js";
import { database } from "../../database.js";

export const WORKFLOW_TEMPLATE_MAX_LIMIT = 10;

export type WorkflowTemplateQuery = {
  query?: string;
  category?: string;
  limit?: number;
};

export type WorkflowTemplateProjection = {
  id: string;
  key: string;
  category: string;
  title: string;
  description: string;
  keywords: readonly string[];
  requiredCapabilities: readonly string[];
  version: string;
  schemaVersion: string;
  template: WorkflowTemplate;
};

export type WorkflowTemplateServiceError = Error & { code: "PERSISTENCE_UNAVAILABLE" };

export function isWorkflowTemplateServiceError(error: unknown): error is WorkflowTemplateServiceError {
  return error instanceof Error && error.message === "PERSISTENCE_UNAVAILABLE";
}

export function parseWorkflowTemplateQuery(input: WorkflowTemplateQuery): {
  terms: readonly string[];
  category?: string;
  limit: number;
} {
  const terms = (input.query ?? "")
    .trim()
    .split(/[\s,]+/u)
    .map((term) => term.trim().toLowerCase().slice(0, 64))
    .filter((term) => term.length > 0)
    .slice(0, 8);

  return {
    terms,
    ...(input.category?.trim() ? { category: input.category.trim().toLowerCase().slice(0, 64) } : {}),
    limit: Math.min(Math.max(input.limit ?? WORKFLOW_TEMPLATE_MAX_LIMIT, 1), WORKFLOW_TEMPLATE_MAX_LIMIT),
  };
}

function escapedSearchPattern(term: string): string {
  const escaped = term.replace(/[\\%_]/gu, (character) => `\\${character}`);
  return `%${escaped}%`;
}

function searchCondition(terms: readonly string[]) {
  if (terms.length === 0) return undefined;

  return or(
    ...terms.flatMap((term) => {
      const pattern = escapedSearchPattern(term);
      return [
        eq(workflowTemplates.key, term),
        ilike(workflowTemplates.title, pattern),
        ilike(workflowTemplates.description, pattern),
        sql<boolean>`array_to_string(${workflowTemplates.keywords}, ' ') ILIKE ${pattern} ESCAPE '\\'`,
        sql<boolean>`array_to_string(${workflowTemplates.requiredCapabilities}, ' ') ILIKE ${pattern} ESCAPE '\\'`,
      ];
    }),
  );
}

export async function listWorkflowTemplatesForPrincipal(
  principal: AosPrincipal,
  input: WorkflowTemplateQuery = {},
): Promise<readonly WorkflowTemplateProjection[]> {
  if (!database) throw new Error("PERSISTENCE_UNAVAILABLE");

  const query = parseWorkflowTemplateQuery(input);
  const conditions = [
    eq(workflowTemplates.status, "published" as const),
    eq(workflowTemplateVersions.status, "published" as const),
    eq(workflowTemplateVersions.version, workflowTemplates.publishedVersion),
    or(
      and(isNull(workflowTemplateVersions.organizationId), isNull(workflowTemplates.organizationId)),
      eq(workflowTemplateVersions.organizationId, workflowTemplates.organizationId),
    ),
    ...(query.category ? [eq(workflowTemplates.category, query.category)] : []),
  ];
  const search = searchCondition(query.terms);
  if (search) conditions.push(search);

  const rows = await withOrganizationContext(database, principal.organizationId, async (db) =>
    db
      .select({
        id: workflowTemplates.id,
        key: workflowTemplates.key,
        category: workflowTemplates.category,
        title: workflowTemplates.title,
        description: workflowTemplates.description,
        keywords: workflowTemplates.keywords,
        requiredCapabilities: workflowTemplates.requiredCapabilities,
        version: workflowTemplateVersions.version,
        schemaVersion: workflowTemplateVersions.schemaVersion,
        template: workflowTemplateVersions.template,
      })
      .from(workflowTemplates)
      .innerJoin(
        workflowTemplateVersions,
        eq(workflowTemplateVersions.workflowTemplateId, workflowTemplates.id),
      )
      .where(and(...conditions))
      .orderBy(desc(workflowTemplates.updatedAt), desc(workflowTemplates.key))
      .limit(query.limit),
  );

  return rows;
}

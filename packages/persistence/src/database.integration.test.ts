import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  integrationBindings,
  integrations,
  knowledgeSources,
  organizations,
  organizationUnits,
  type PersistenceDatabase,
  type PersistenceTransaction,
  withOrganizationContext,
  workflowBlueprints,
  workflowDefinitions,
} from "./index.js";

const runtimeUrl = process.env.DATABASE_TEST_URL;
const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;

const tenantTables = [
  "organizations",
  "organization_units",
  "roles",
  "role_permissions",
  "organization_memberships",
  "membership_scopes",
  "integrations",
  "integration_bindings",
  "webhook_endpoints",
  "webhook_deliveries",
  "workflow_definitions",
  "workflow_runs",
  "workflow_events",
  "idempotency_keys",
  "audit_events",
  "workflow_change_plans",
  "workflow_blueprints",
  "coordinator_event_outbox",
  "workflow_command_receipts",
  "workflow_templates",
  "workflow_template_versions",
  "knowledge_sources",
  "source_revisions",
  "source_ingestion_runs",
  "saved_investigations",
  "notification_preferences",
  "notifications",
  "integration_authorization_states",
  "memory_change_requests",
  "organization_access_requests",
  "coordinator_recommendations",
  "workflow_planner_versions",
  "organization_onboarding",
] as const;

const integrationTest = runtimeUrl && adminUrl ? describe : describe.skip;

type Fixture = {
  organizationA: string;
  organizationB: string;
  unitA: string;
  unitB: string;
  integrationA: string;
  integrationB: string;
};

let database: ReturnType<typeof createDatabase> | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let fixture: Fixture;

function requireDatabase(): { db: PersistenceDatabase } {
  if (!database)
    throw new Error("Persistence integration database is not initialized.");
  return database;
}

function requireAdmin(): ReturnType<typeof postgres> {
  if (!adminClient)
    throw new Error(
      "Persistence integration admin database is not initialized.",
    );
  return adminClient;
}

async function expectPostgresError(
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const databaseError = error as { code?: string; cause?: { code?: string } };
    expect(databaseError.code ?? databaseError.cause?.code).toBe(code);
    return;
  }

  throw new Error(`Expected PostgreSQL error ${code}.`);
}

function inOrganization<T>(
  organizationId: string,
  callback: (transaction: PersistenceTransaction) => Promise<T>,
): Promise<T> {
  return withOrganizationContext(
    requireDatabase().db,
    organizationId,
    callback,
  );
}

integrationTest("PostgreSQL persistence boundaries", () => {
  beforeAll(async () => {
    if (!runtimeUrl || !adminUrl) {
      throw new Error(
        "DATABASE_TEST_URL and DATABASE_TEST_ADMIN_URL are required for persistence integration tests.",
      );
    }
    database = createDatabase({ url: runtimeUrl, maxConnections: 3 });
    adminClient = postgres(adminUrl, { max: 2, prepare: false });

    const admin = requireAdmin();
    await admin`SELECT 1`;

    const migrationFiles = readdirSync(
      fileURLToPath(new URL("../drizzle/", import.meta.url)),
    ).filter((file) => file.endsWith(".sql"));
    const [migrationState] = await admin<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM "__drizzle_migrations"
    `;
    expect(Number(migrationState?.count ?? 0)).toBeGreaterThanOrEqual(
      migrationFiles.length,
    );

    const [runtimeRole] = await database.client<
      { rolbypassrls: boolean; rolsuper: boolean }[]
    >`
      SELECT rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(runtimeRole?.rolsuper).toBe(false);
    expect(runtimeRole?.rolbypassrls).toBe(false);

    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const unitA = randomUUID();
    const unitB = randomUUID();
    const integrationA = randomUUID();
    const integrationB = randomUUID();
    fixture = {
      organizationA,
      organizationB,
      unitA,
      unitB,
      integrationA,
      integrationB,
    };

    await inOrganization(organizationA, (tx) =>
      tx.insert(organizations).values({
        id: organizationA,
        slug: `persistence-test-${organizationA}`,
        name: "Persistence Test A",
      }),
    );
    await inOrganization(organizationB, (tx) =>
      tx.insert(organizations).values({
        id: organizationB,
        slug: `persistence-test-${organizationB}`,
        name: "Persistence Test B",
      }),
    );

    await inOrganization(organizationA, async (tx) => {
      await tx.insert(organizationUnits).values({
        id: unitA,
        organizationId: organizationA,
        type: "department",
        slug: "engineering",
        name: "Engineering",
      });
      await tx.insert(integrations).values({
        id: integrationA,
        organizationId: organizationA,
        provider: "github",
        displayName: "GitHub A",
      });
      await tx.insert(knowledgeSources).values({
        organizationId: organizationA,
        name: "Shared source name",
        kind: "manual",
        readScope: { ids: [unitA] },
        visibilityScope: { ids: [unitA] },
      });
    });
    await inOrganization(organizationB, async (tx) => {
      await tx.insert(organizationUnits).values({
        id: unitB,
        organizationId: organizationB,
        type: "department",
        slug: "engineering",
        name: "Engineering",
      });
      await tx.insert(integrations).values({
        id: integrationB,
        organizationId: organizationB,
        provider: "github",
        displayName: "GitHub B",
      });
      await tx.insert(knowledgeSources).values({
        organizationId: organizationB,
        name: "Shared source name",
        kind: "manual",
        readScope: { ids: [unitB] },
        visibilityScope: { ids: [unitB] },
      });
    });
  });

  afterAll(async () => {
    if (fixture && adminClient) {
      await adminClient`
        DELETE FROM "organizations"
        WHERE id IN (${fixture.organizationA}, ${fixture.organizationB})
      `;
    }
    await database?.client.end({ timeout: 5 });
    await adminClient?.end({ timeout: 5 });
  });

  it("applies tenant RLS policies to every control-plane tenant table", async () => {
    const rows = await requireAdmin()<
      Array<{ tableName: string; rowSecurity: boolean; hasPolicy: boolean }>
    >`
      SELECT
        c.relname AS "tableName",
        c.relrowsecurity AS "rowSecurity",
        EXISTS (
          SELECT 1
          FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename = c.relname
            AND p.policyname = c.relname || '_tenant_isolation'
        ) AS "hasPolicy"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = ANY(${tenantTables})
    `;

    expect(rows.map((row) => row.tableName).sort()).toEqual(
      [...tenantTables].sort(),
    );
    for (const row of rows) {
      expect(row.rowSecurity, `${row.tableName} must enable RLS`).toBe(true);
      expect(
        row.hasPolicy,
        `${row.tableName} must define tenant isolation policy`,
      ).toBe(true);
    }
  });

  it("keeps organization rows isolated and resets SET LOCAL after the transaction", async () => {
    const visibleToA = await inOrganization(fixture.organizationA, (tx) =>
      tx.select({ id: organizations.id }).from(organizations),
    );
    const visibleToB = await inOrganization(fixture.organizationB, (tx) =>
      tx.select({ id: organizations.id }).from(organizations),
    );
    const visibleWithoutContext = await requireDatabase()
      .db.select({ id: organizations.id })
      .from(organizations);

    expect(visibleToA).toEqual([{ id: fixture.organizationA }]);
    expect(visibleToB).toEqual([{ id: fixture.organizationB }]);
    expect(visibleWithoutContext).toEqual([]);
  });

  it("rejects writes for another organization even when the caller supplies its ID", async () => {
    await expectPostgresError(
      () =>
        inOrganization(fixture.organizationA, (tx) =>
          tx.insert(organizations).values({
            id: fixture.organizationB,
            slug: `cross-tenant-${randomUUID()}`,
            name: "Must not be visible",
          }),
        ),
      "42501",
    );
  });

  it("keeps workflow definitions tenant-isolated and rejects cross-tenant workflow writes", async () => {
    const definitionA = randomUUID();
    const definitionB = randomUUID();

    await inOrganization(fixture.organizationA, (tx) =>
      tx.insert(workflowDefinitions).values({
        id: definitionA,
        organizationId: fixture.organizationA,
        key: `persistence-test-a-${definitionA}`,
        version: "1.0.0",
        status: "approved",
      }),
    );
    await inOrganization(fixture.organizationB, (tx) =>
      tx.insert(workflowDefinitions).values({
        id: definitionB,
        organizationId: fixture.organizationB,
        key: `persistence-test-b-${definitionB}`,
        version: "1.0.0",
        status: "approved",
      }),
    );

    await expectPostgresError(
      () =>
        inOrganization(fixture.organizationA, (tx) =>
          tx.insert(workflowDefinitions).values({
            organizationId: fixture.organizationB,
            key: `cross-tenant-definition-${randomUUID()}`,
            version: "1.0.0",
            status: "approved",
          }),
        ),
      "42501",
    );

    const visibleToA = await inOrganization(fixture.organizationA, (tx) =>
      tx
        .select({ organizationId: workflowDefinitions.organizationId })
        .from(workflowDefinitions),
    );
    const visibleToB = await inOrganization(fixture.organizationB, (tx) =>
      tx
        .select({ organizationId: workflowDefinitions.organizationId })
        .from(workflowDefinitions),
    );

    expect(visibleToA).toEqual([{ organizationId: fixture.organizationA }]);
    expect(visibleToB).toEqual([{ organizationId: fixture.organizationB }]);
  });

  it("enforces composite foreign keys for organization-scoped resources", async () => {
    await expectPostgresError(
      () =>
        inOrganization(fixture.organizationA, (tx) =>
          tx.insert(integrationBindings).values({
            organizationId: fixture.organizationA,
            integrationId: fixture.integrationB,
            organizationUnitId: fixture.unitA,
            grantedScopes: [],
          }),
        ),
      "23503",
    );

    await expectPostgresError(
      () =>
        inOrganization(fixture.organizationA, (tx) =>
          tx.insert(integrationBindings).values({
            organizationId: fixture.organizationA,
            integrationId: fixture.integrationA,
            organizationUnitId: fixture.unitB,
            grantedScopes: [],
          }),
        ),
      "23503",
    );
  });

  it("keeps uniqueness tenant-scoped and rejects duplicates inside one tenant", async () => {
    const rows = await inOrganization(fixture.organizationA, (tx) =>
      tx
        .select({ id: knowledgeSources.id })
        .from(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.organizationId, fixture.organizationA),
            eq(knowledgeSources.name, "Shared source name"),
          ),
        ),
    );
    expect(rows).toHaveLength(1);

    await expectPostgresError(
      () =>
        inOrganization(fixture.organizationA, (tx) =>
          tx.insert(knowledgeSources).values({
            organizationId: fixture.organizationA,
            name: "Shared source name",
            kind: "manual",
            readScope: { ids: [fixture.unitA] },
            visibilityScope: { ids: [fixture.unitA] },
          }),
        ),
      "23505",
    );
  });

  it("enforces check constraints at the database boundary", async () => {
    await expectPostgresError(
      () =>
        inOrganization(fixture.organizationA, (tx) =>
          tx.insert(workflowBlueprints).values({
            organizationId: fixture.organizationA,
            blueprintId: `invalid-${randomUUID()}`,
            version: "1.0.0",
            workflowType: "encois.test.v1",
            name: "Invalid current blueprint",
            blueprint: {},
            status: "draft",
            isCurrent: true,
          }),
        ),
      "23514",
    );
  });
});

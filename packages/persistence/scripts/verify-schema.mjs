import postgres from "postgres";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is required");

const sql = postgres(url, { max: 4, prepare: false });

try {
  const [table] = await sql`
    SELECT c.relrowsecurity AS row_security
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'workflow_command_receipts'
  `;
  if (!table) throw new Error("workflow_command_receipts table is missing");
  if (!table.row_security) throw new Error("workflow_command_receipts RLS is not enabled");

  const [policy] = await sql`
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workflow_command_receipts'
      AND policyname = 'workflow_command_receipts_tenant_isolation'
  `;
  if (!policy) throw new Error("workflow_command_receipts tenant policy is missing");

  const [scopeIndex] = await sql`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'workflow_command_receipts'
      AND indexname = 'workflow_command_receipts_scope_key_idx'
  `;
  const indexDefinition = String(scopeIndex?.indexdef ?? "");
  for (const column of ["organization_id", "temporal_workflow_id", "command_type", "command_id"]) {
    if (!indexDefinition.includes(column)) {
      throw new Error(`workflow command uniqueness index is missing ${column}`);
    }
  }

  const [privileges] = await sql`
    SELECT
      has_table_privilege('api_gateway', 'public.workflow_command_receipts', 'SELECT') AS can_select,
      has_table_privilege('api_gateway', 'public.workflow_command_receipts', 'INSERT') AS can_insert,
      has_table_privilege('api_gateway', 'public.workflow_command_receipts', 'UPDATE') AS can_update,
      has_table_privilege('api_gateway', 'public.workflow_command_receipts', 'DELETE') AS can_delete
  `;
  if (!privileges?.can_select || !privileges?.can_insert || !privileges?.can_update || privileges.can_delete) {
    throw new Error(`workflow command receipt privileges are unsafe: ${JSON.stringify(privileges)}`);
  }

  const organizationId = randomUUID();
  const definitionId = randomUUID();
  const workflowRunId = randomUUID();
  const workflowId = `workflow:receipt-verification:${randomUUID()}`;
  try {
    await sql`INSERT INTO organizations (id, slug, name) VALUES (${organizationId}, ${`receipt-${organizationId}`}, 'Receipt verification')`;
    await sql`
      INSERT INTO workflow_definitions (id, organization_id, key, version, status)
      VALUES (${definitionId}, ${organizationId}, 'receipt-verification', '1.0.0', 'approved')
    `;
    await sql`
      INSERT INTO workflow_runs (id, organization_id, definition_id, temporal_workflow_id, status, scope)
      VALUES (${workflowRunId}, ${organizationId}, ${definitionId}, ${workflowId}, 'waiting', '{"ids":["verification"]}'::jsonb)
    `;

    const receiptInsert = () => sql`
      INSERT INTO workflow_command_receipts
        (organization_id, workflow_run_id, temporal_workflow_id, command_type, command_id, request_hash)
      VALUES
        (${organizationId}, ${workflowRunId}, ${workflowId}, 'update', 'concurrent-command-1', 'hash-1')
    `;
    const attempts = await Promise.allSettled([receiptInsert(), receiptInsert()]);
    const successful = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    if (successful.length !== 1 || rejected.length !== 1 || rejected[0].reason?.code !== "23505") {
      throw new Error(`command receipt uniqueness race was not enforced: ${JSON.stringify(attempts)}`);
    }
  } finally {
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
  }

  console.log("persistence schema and command receipt race verification ok");
} finally {
  await sql.end({ timeout: 5 });
}

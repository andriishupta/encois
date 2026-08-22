import postgres from "postgres";

const databaseUrl = process.env.DATABASE_RETENTION_URL;
const organizationId = process.env.RETENTION_ORGANIZATION_ID?.trim();
const batchSize = Number(process.env.RETENTION_CLEANUP_BATCH_SIZE ?? "500");
const dryRun = process.env.RETENTION_DRY_RUN === "true";

if (!databaseUrl) throw new Error("DATABASE_RETENTION_URL is required");
if (!organizationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(organizationId)) {
  throw new Error("RETENTION_ORGANIZATION_ID must be a valid organization UUID");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
  throw new Error("RETENTION_CLEANUP_BATCH_SIZE must be an integer between 1 and 5000");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const result = await sql.begin(async (transaction) => {
    await transaction`select set_config('app.organization_id', ${organizationId}, true)`;

    const candidates = await transaction`
      SELECT id, temporal_workflow_id, retention_until
      FROM workflow_runs
      WHERE organization_id = ${organizationId}::uuid
        AND retention_until IS NOT NULL
        AND retention_until <= now()
        AND status IN ('completed', 'failed', 'partial', 'cancelled')
      ORDER BY retention_until ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;

    if (dryRun || candidates.length === 0) {
      return { organizationId, dryRun, candidates: candidates.length, deletedReceipts: 0, deletedEvents: 0, deletedRuns: 0 };
    }

    const runIds = candidates.map((candidate) => candidate.id);
    const deletedReceipts = await transaction`
      DELETE FROM workflow_command_receipts
      WHERE organization_id = ${organizationId}::uuid
        AND workflow_run_id = ANY(${sql.array(runIds, "uuid")})
      RETURNING id
    `;
    const deletedEvents = await transaction`
      DELETE FROM workflow_events
      WHERE organization_id = ${organizationId}::uuid
        AND workflow_run_id = ANY(${sql.array(runIds, "uuid")})
      RETURNING id
    `;
    const deletedRuns = await transaction`
      DELETE FROM workflow_runs
      WHERE organization_id = ${organizationId}::uuid
        AND id = ANY(${sql.array(runIds, "uuid")})
      RETURNING id
    `;

    await transaction`
      INSERT INTO audit_events (organization_id, action, outcome, resource_type, resource_id, scope, metadata)
      VALUES (
        ${organizationId}::uuid,
        'retention_cleanup_completed',
        'accepted',
        'workflow_run',
        ${organizationId},
        ${JSON.stringify({ organizationId })}::jsonb,
        ${JSON.stringify({
          candidates: candidates.length,
          deletedRuns: deletedRuns.length,
          deletedEvents: deletedEvents.length,
          deletedReceipts: deletedReceipts.length,
          retentionBoundary: "workflow_run.retention_until",
        })}::jsonb
      )
    `;

    return {
      organizationId,
      dryRun,
      candidates: candidates.length,
      deletedReceipts: deletedReceipts.length,
      deletedEvents: deletedEvents.length,
      deletedRuns: deletedRuns.length,
    };
  });

  console.log(JSON.stringify(result));
} finally {
  await sql.end({ timeout: 5 });
}

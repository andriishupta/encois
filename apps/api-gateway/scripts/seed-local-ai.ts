import { createHash } from "node:crypto";
import { SourceIngestionTrigger } from "@encois/contracts";
import {
  createDatabase,
  knowledgeSources,
  organizations,
} from "@encois/database";
import { asc, eq } from "drizzle-orm";
import { loadConfig } from "../src/config.js";
import { createSourceArtifactStore } from "../src/sources/artifact-store.js";
import {
  createSourceRevision,
  startSourceIngestion,
} from "../src/sources/services/source.service.js";
import { createWorkflowClient } from "../src/workflows/temporal-client.js";

const organizationSlug =
  process.env.SEED_ORGANIZATION_SLUG?.trim() || "organization-sun";
const revisionKey = process.env.LOCAL_AI_SEED_REVISION?.trim() || "ai-demo-v1";
const sourceLimit = positiveInteger(process.env.LOCAL_AI_SEED_SOURCE_LIMIT, 5);
const waitTimeoutMs = positiveInteger(
  process.env.LOCAL_AI_SEED_WAIT_TIMEOUT_MS,
  15 * 60 * 1000,
);
const pollIntervalMs = positiveInteger(
  process.env.LOCAL_AI_SEED_POLL_INTERVAL_MS,
  2_000,
);
const readinessTimeoutMs = positiveInteger(
  process.env.LOCAL_AI_SEED_READINESS_TIMEOUT_MS,
  2 * 60 * 1000,
);
const seedDatabaseUrl = process.env.DATABASE_SEED_URL?.trim();
const runtimeDatabaseUrl = process.env.DATABASE_RUNTIME_URL?.trim();
const capabilitySecret =
  process.env.AGENT_GATEWAY_CAPABILITY_SECRET?.trim() || undefined;
const controlPlaneServiceUserId =
  process.env.CONTROL_PLANE_SERVICE_USER_ID?.trim() ||
  "00000000-0000-4000-8000-000000000010";

type SeedSource = {
  id: string;
  name: string;
  kind: string;
  provider: string | null;
  status: string;
  readScope: { ids: readonly string[] };
};

if (!seedDatabaseUrl)
  throw new Error("DATABASE_SEED_URL is required for the AI demo seed.");
if (!runtimeDatabaseUrl)
  throw new Error("DATABASE_RUNTIME_URL is required for the AI demo seed.");
if (!capabilitySecret)
  throw new Error(
    "AGENT_GATEWAY_CAPABILITY_SECRET is required for the AI demo seed.",
  );
if (!/^[a-zA-Z0-9._-]+$/.test(revisionKey))
  throw new Error(
    "LOCAL_AI_SEED_REVISION may contain only letters, numbers, dots, underscores, and hyphens.",
  );

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitForAgentGateway(baseUrl: string): Promise<void> {
  const readinessUrl = `${baseUrl.replace(/\/$/u, "")}/health/ready`;
  const deadline = Date.now() + readinessTimeoutMs;
  let lastFailure = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(readinessUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `Agent Gateway did not become ready at ${readinessUrl}: ${lastFailure}`,
  );
}

function sourceUnitId(source: SeedSource): string {
  return (
    source.readScope.ids.find((id) => id !== "*" && id.length > 0) ??
    "organization"
  );
}

function fixtureContent(
  organization: { slug: string; name: string },
  source: SeedSource,
): Uint8Array {
  const provider = source.provider ?? source.kind;
  const lines = [
    `Encois AI demo source: ${source.name}`,
    `Organization: ${organization.name} (${organization.slug})`,
    `Provider: ${provider}`,
    `Source status: ${source.status}`,
    "Release readiness signal: the current delivery stream contains synthetic evidence for demonstration.",
    "Operational signal: one service has a recent regression and requires investigation.",
    "Ownership signal: the scoped team has an active follow-up and a documented next step.",
  ];
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

async function waitForWorkflow(
  workflowClient: ReturnType<typeof createWorkflowClient>,
  workflowId: string,
  organizationId: string,
  namespace: string,
): Promise<string> {
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    const projection = await workflowClient.get(
      workflowId,
      organizationId,
      namespace,
    );
    if (projection) {
      if (
        projection.status === "completed" ||
        projection.status === "failed" ||
        projection.status === "cancelled" ||
        projection.status === "partial"
      ) {
        return projection.status;
      }
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `Timed out waiting for source ingestion workflow ${workflowId}.`,
  );
}

async function seedAiSources(): Promise<void> {
  const config = loadConfig();
  if (!config.agentGatewayUrl)
    throw new Error("AGENT_GATEWAY_URL is required for the AI demo seed.");
  await waitForAgentGateway(config.agentGatewayUrl);
  const workflowClient = createWorkflowClient(config);
  const artifactStore = createSourceArtifactStore({
    bucketName: config.sourceArtifactBucket,
    nodeEnv: config.nodeEnv,
    projectId: config.identityPlatformProjectId,
  });
  if (!artifactStore)
    throw new Error(
      "A configured source artifact store is required for the AI demo seed.",
    );

  const seedDatabase = createDatabase({ url: seedDatabaseUrl });
  try {
    const [organization] = await seedDatabase.db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
      })
      .from(organizations)
      .where(eq(organizations.slug, organizationSlug))
      .limit(1);
    if (!organization)
      throw new Error(
        `Seed organization ${organizationSlug} was not found. Run the base seed first.`,
      );

    const sources = await seedDatabase.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.organizationId, organization.id))
      .orderBy(asc(knowledgeSources.createdAt))
      .limit(sourceLimit);
    if (sources.length === 0)
      throw new Error(
        `Seed organization ${organizationSlug} has no sources to ingest.`,
      );

    const principal = {
      actorId: "demo-ai-seed",
      userId: controlPlaneServiceUserId,
      organizationId: organization.id,
      scope: ["*"],
    } as const;
    const options = {
      workflowClient,
      artifactStore,
      namespace: config.temporalNamespace,
      taskQueue: config.temporalTaskQueue,
      policyVersion: config.agentGatewayPolicyVersion,
      capabilitySecret,
      capabilityTtlMs: config.executionCapabilityTtlMs,
      system: true,
    } as const;

    const launches = [] as Array<{
      source: SeedSource;
      workflowId: string;
    }>;
    for (const source of sources) {
      const bytes = fixtureContent(organization, source);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const reference = artifactStore.reference({
        organizationId: organization.id,
        unitId: sourceUnitId(source),
        sourceId: source.id,
        revision: revisionKey,
      });
      await artifactStore.write({
        artifactRef: reference.artifactRef,
        objectKey: reference.objectKey,
        organizationId: organization.id,
        sourceId: source.id,
        revision: revisionKey,
        fileName: `${source.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "source"}.txt`,
        contentType: "text/plain",
        bytes,
      });

      const revision = await createSourceRevision(
        principal,
        source.id,
        {
          revision: revisionKey,
          artifactRef: reference.artifactRef,
          sourceObjectId: reference.objectKey,
          contentType: "text/plain",
          checksum,
          observedAt: new Date().toISOString(),
          metadata: {
            fixture: true,
            aiSeed: true,
            seedRevision: revisionKey,
          },
        },
        { system: true },
      );
      if (!revision)
        throw new Error(`AI seed revision was not created for ${source.name}.`);
      if (
        revision.artifactRef !== reference.artifactRef ||
        revision.sourceObjectId !== reference.objectKey
      ) {
        throw new Error(
          `Existing revision ${revisionKey} for ${source.name} has different artifact metadata. Use a new LOCAL_AI_SEED_REVISION.`,
        );
      }

      const launch = await startSourceIngestion(
        principal,
        source.id,
        revision.id,
        SourceIngestionTrigger.Manual,
        `demo-ai-seed:${organization.id}:${source.id}:${revisionKey}`,
        `demo-ai-seed:${organization.id}:${source.id}:${revisionKey}`,
        options,
      );
      launches.push({ source, workflowId: launch.workflow.workflowId });
      console.log(
        JSON.stringify({
          event: "local_ai_seed.source_started",
          source: source.name,
          workflowId: launch.workflow.workflowId,
          reused: launch.workflow.reused === true,
        }),
      );
    }

    const results = await Promise.all(
      launches.map(async ({ source, workflowId }) => ({
        source: source.name,
        workflowId,
        status: await waitForWorkflow(
          workflowClient,
          workflowId,
          organization.id,
          config.temporalNamespace,
        ),
      })),
    );
    console.log(
      JSON.stringify({ event: "local_ai_seed.completed", results }, null, 2),
    );
    if (results.some((result) => result.status !== "completed"))
      throw new Error(
        "One or more AI source ingestion workflows did not complete.",
      );
  } finally {
    await seedDatabase.client.end({ timeout: 5 });
    await workflowClient.close?.();
  }
}

await seedAiSources();

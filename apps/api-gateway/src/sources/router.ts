import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import {
  createKnowledgeSourceRoute,
  createSourceRevisionRoute,
  getKnowledgeSourceRoute,
  getSourceRevisionRawRoute,
  listKnowledgeSourcesRoute,
  startSourceIngestionRoute,
  uploadPdfKnowledgeSourceRoute,
} from "./routes/index.js";
import type {
  SourceArtifactStore,
  SourceServiceOptions,
} from "./services/source.service.js";

export function createSourcesRouter(
  options: SourceServiceOptions & { artifactStore?: SourceArtifactStore },
): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.get("/", listKnowledgeSourcesRoute);
  router.post("/", createKnowledgeSourceRoute);
  router.post("/uploads", uploadPdfKnowledgeSourceRoute(options.artifactStore));
  router.get("/:sourceId", getKnowledgeSourceRoute(options));
  router.post("/:sourceId/revisions", createSourceRevisionRoute);
  router.get(
    "/:sourceId/revisions/:revisionId/raw",
    getSourceRevisionRawRoute(options),
  );
  router.post(
    "/:sourceId/revisions/:revisionId/ingest",
    startSourceIngestionRoute(options),
  );
  return router;
}

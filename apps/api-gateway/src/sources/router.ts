import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import {
  createKnowledgeSourceRoute,
  createSourceRevisionRoute,
  getKnowledgeSourceRoute,
  listKnowledgeSourcesRoute,
  startSourceIngestionRoute,
} from "./routes/index.js";
import type { SourceServiceOptions } from "./services/source.service.js";

export function createSourcesRouter(options: SourceServiceOptions): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.get("/", listKnowledgeSourcesRoute);
  router.post("/", createKnowledgeSourceRoute);
  router.get("/:sourceId", getKnowledgeSourceRoute);
  router.post("/:sourceId/revisions", createSourceRevisionRoute);
  router.post("/:sourceId/revisions/:revisionId/ingest", startSourceIngestionRoute(options));
  return router;
}

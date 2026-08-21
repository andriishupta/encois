import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import { submitWaitlistRoute } from "./waitlist.route.js";

export function createPublicRouter(): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();
  router.post("/waitlist", submitWaitlistRoute);
  return router;
}

import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";

export const healthRouter = new Hono<GatewayEnv>();

healthRouter.get("/live", (context) =>
  context.json({
    data: {
      status: "ok",
    },
  }),
);

healthRouter.get("/ready", (context) =>
  context.json({
    data: {
      checks: {},
      status: "ok",
    },
  }),
);

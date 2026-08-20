import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/aos.js";
import { receiveWebhookRoute } from "./routes/index.js";

export const webhooksRouter = new Hono<GatewayEnv>();

webhooksRouter.post("/", receiveWebhookRoute);

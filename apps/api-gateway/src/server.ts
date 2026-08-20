import { serve } from "@hono/node-server";
import { createDatabase } from "@encois/persistence";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const database = process.env.DATABASE_RUNTIME_URL || process.env.DATABASE_URL ? createDatabase().db : undefined;
const app = createApp({ config, database });

console.info(
  JSON.stringify({
    event: "api_gateway.starting",
    host: config.host,
    port: config.port,
  }),
);

serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
});

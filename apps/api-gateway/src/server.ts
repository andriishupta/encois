import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp({ config });

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

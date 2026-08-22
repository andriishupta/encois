import { describe, expect, it } from "vitest";
import { createWebhookSecretWriter } from "./secret-manager.js";
import { createWebhookSecretResolver } from "../webhooks/secret-resolver.js";

describe("webhook Secret Manager adapter", () => {
  it("keeps local provisioned secrets resolvable without exposing them in a read projection", async () => {
    const localSecrets = new Map<string, string>();
    const writer = createWebhookSecretWriter({ nodeEnv: "test", localSecrets });
    expect(writer).toBeDefined();
    if (!writer) throw new Error("expected local writer");

    const reference = await writer.write({ organizationId: "org-1", endpointId: "endpoint-1", endpointKey: "github-events", secret: "whsec-local-secret" });
    const resolver = createWebhookSecretResolver({ nodeEnv: "test", localSecrets });
    await expect(resolver(reference)).resolves.toBe("whsec-local-secret");
  });

  it("creates a Secret Manager secret and adds a version using workload identity", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const writer = createWebhookSecretWriter({
      nodeEnv: "production",
      projectId: "encois-demo",
      fetchImpl: async (input, init) => {
        const url = String(input);
        requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
        if (url.includes("metadata.google.internal")) return new Response(JSON.stringify({ access_token: "workload-token" }), { status: 200 });
        if (init?.method === undefined) return new Response("missing", { status: 404 });
        if (url.includes(":addVersion")) return new Response(JSON.stringify({ name: "projects/encois-demo/secrets/encois-webhook-org-1-endpoint-1/versions/7" }), { status: 200 });
        return new Response("{}", { status: 200 });
      },
    });
    expect(writer).toBeDefined();
    if (!writer) throw new Error("expected Google writer");

    const reference = await writer.write({ organizationId: "org-1", endpointId: "endpoint-1", endpointKey: "github-events", secret: "whsec-production-secret" });

    expect(reference).toBe("secretmanager://projects/encois-demo/secrets/encois-webhook-org-1-endpoint-1/versions/7");
    expect(requests).toHaveLength(4);
    expect(requests[0]?.url).toContain("metadata.google.internal");
    expect(requests[2]?.url).toContain("secretId=encois-webhook-org-1-endpoint-1");
    expect(requests[3]?.url).toContain(":addVersion");
    expect(requests[3]?.body).toContain("d2hzZWMtcHJvZHVjdGlvbi1zZWNyZXQ=");
  });

  it("resolves a pinned Secret Manager version instead of silently reading latest", async () => {
    const urls: string[] = [];
    const resolver = createWebhookSecretResolver({
      nodeEnv: "production",
      projectId: "encois-demo",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("metadata.google.internal")) return new Response(JSON.stringify({ access_token: "workload-token" }), { status: 200 });
        return new Response(JSON.stringify({ payload: { data: Buffer.from("whsec-pinned-secret", "utf8").toString("base64") } }), { status: 200 });
      },
    });

    await expect(resolver("secretmanager://projects/encois-demo/secrets/webhook/versions/7")).resolves.toBe("whsec-pinned-secret");
    expect(urls[1]).toContain("/versions/7:access");
  });
});

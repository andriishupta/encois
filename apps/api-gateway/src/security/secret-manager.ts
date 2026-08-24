import { randomUUID } from "node:crypto";
import { fetchGoogleAccessToken } from "./google-access-token.js";

export type WebhookSecretWriter = {
  write: (input: {
    organizationId: string;
    endpointId: string;
    endpointKey: string;
    secret: string;
  }) => Promise<string>;
};

type SecretManagerWriterOptions = {
  nodeEnv: string;
  projectId?: string;
  fetchImpl?: typeof fetch;
  localSecrets?: Map<string, string>;
};

function safeSecretId(organizationId: string, endpointId: string): string {
  return `encois-webhook-${organizationId}-${endpointId}`
    .replace(/[^a-zA-Z0-9-_]/gu, "-")
    .slice(0, 255);
}

function createGoogleWebhookSecretWriter(
  projectId: string,
  fetchImpl: typeof fetch,
): WebhookSecretWriter {
  const base = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`;
  return {
    async write(input) {
      let token: string;
      try {
        token = await fetchGoogleAccessToken(fetchImpl);
      } catch {
        throw new Error("WEBHOOK_SECRET_STORE_UNAVAILABLE");
      }
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const id = safeSecretId(input.organizationId, input.endpointId);
      const resourceUrl = `${base}/secrets/${encodeURIComponent(id)}`;
      const existing = await fetchImpl(resourceUrl, { headers });
      if (existing.status === 404) {
        const created = await fetchImpl(
          `${base}/secrets?secretId=${encodeURIComponent(id)}`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ replication: { automatic: {} } }),
          },
        );
        if (!created.ok && created.status !== 409)
          throw new Error("WEBHOOK_SECRET_STORE_UNAVAILABLE");
      } else if (!existing.ok) {
        throw new Error("WEBHOOK_SECRET_STORE_UNAVAILABLE");
      }
      const version = await fetchImpl(`${resourceUrl}:addVersion`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          payload: {
            data: Buffer.from(input.secret, "utf8").toString("base64"),
          },
        }),
      });
      if (!version.ok) throw new Error("WEBHOOK_SECRET_STORE_UNAVAILABLE");
      const versionBody: unknown = await version.json().catch(() => null);
      const versionName =
        versionBody &&
        typeof versionBody === "object" &&
        !Array.isArray(versionBody) &&
        typeof (versionBody as { name?: unknown }).name === "string"
          ? (versionBody as { name: string }).name
          : undefined;
      const versionId = versionName?.match(/\/versions\/([^/]+)$/u)?.[1];
      return `secretmanager://projects/${projectId}/secrets/${id}${versionId ? `/versions/${encodeURIComponent(versionId)}` : ""}`;
    },
  };
}

/** Local fixtures use the same deterministic reference understood by the local resolver. */
export function createWebhookSecretWriter(
  options: SecretManagerWriterOptions,
): WebhookSecretWriter | undefined {
  if (options.projectId)
    return createGoogleWebhookSecretWriter(
      options.projectId,
      options.fetchImpl ?? fetch,
    );
  if (options.nodeEnv === "development" || options.nodeEnv === "test") {
    return {
      async write(input) {
        const reference = `local://mock/${input.organizationId}/${input.endpointId}/${randomUUID()}`;
        options.localSecrets?.set(reference, input.secret);
        return reference;
      },
    };
  }
  return undefined;
}

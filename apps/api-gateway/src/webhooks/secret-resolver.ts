import { fetchGoogleAccessToken } from "../security/google-access-token.js";

export type WebhookSecretResolver = (
  secretRef: string,
) => Promise<string | undefined>;

type WebhookSecretResolverOptions = {
  nodeEnv: string;
  projectId?: string;
  fetchImpl?: typeof fetch;
  localSecrets?: Map<string, string>;
};

function localSecret(secretRef: string): string | undefined {
  const prefix = "local://mock/";
  if (!secretRef.startsWith(prefix)) return undefined;
  const endpointKey = secretRef.slice(prefix.length);
  return endpointKey ? `local-webhook-${endpointKey}` : undefined;
}

function parseSecretRef(
  secretRef: string,
): { projectId: string; secretId: string; version?: string } | undefined {
  const match =
    /^secretmanager:\/\/projects\/([^/]+)\/secrets\/([^/]+)(?:\/versions\/([^/]+))?$/u.exec(
      secretRef,
    );
  return match
    ? {
        projectId: decodeURIComponent(match[1]!),
        secretId: decodeURIComponent(match[2]!),
        ...(match[3] ? { version: decodeURIComponent(match[3]) } : {}),
      }
    : undefined;
}

export function createWebhookSecretResolver(
  options: WebhookSecretResolverOptions,
): WebhookSecretResolver {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (secretRef) => {
    if (options.nodeEnv !== "production") {
      const provisioned = options.localSecrets?.get(secretRef);
      if (provisioned) return provisioned;
      const local = localSecret(secretRef);
      if (local) return local;
    }
    const parsed = parseSecretRef(secretRef);
    if (
      !parsed ||
      (options.projectId && parsed.projectId !== options.projectId)
    )
      return undefined;
    const token = await fetchGoogleAccessToken(fetchImpl);
    const response = await fetchImpl(
      `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(parsed.projectId)}/secrets/${encodeURIComponent(parsed.secretId)}/versions/${encodeURIComponent(parsed.version ?? "latest")}:access`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body: unknown = await response.json().catch(() => null);
    if (
      !response.ok ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    )
      return undefined;
    const payload = (body as { payload?: unknown }).payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof (payload as { data?: unknown }).data !== "string"
    )
      return undefined;
    const value = Buffer.from(
      (payload as { data: string }).data,
      "base64",
    ).toString("utf8");
    return value.trim().length > 0 ? value : undefined;
  };
}

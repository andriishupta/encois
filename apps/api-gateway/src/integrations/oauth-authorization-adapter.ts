import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { fetchGoogleAccessToken } from "../security/google-access-token.js";
import type {
  IntegrationAuthorizationAdapter,
  IntegrationAuthorizationAdapterRequest,
  IntegrationAuthorizationCompleteRequest,
  IntegrationAuthorizationCompleteResult,
  IntegrationAuthorizationState,
} from "./authorization-adapter.js";

type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: readonly string[];
  tokenAuthMethod?: "basic" | "post";
};

type OAuthConfigMap = Readonly<Record<string, OAuthProviderConfig>>;
type OAuthState = {
  version: "encois-oauth-state.v1";
  integrationId: string;
  organizationId: string;
  actorId: string;
  userId?: string;
  provider: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

type OAuthTokenResponse = Readonly<Record<string, unknown>>;

export type OAuthSecretWriteRequest = {
  organizationId: string;
  integrationId: string;
  provider: string;
  tokenSet: OAuthTokenResponse;
};

export type OAuthSecretWriter = {
  write: (request: OAuthSecretWriteRequest) => Promise<string>;
};

export type OAuthAuthorizationAdapterOptions = {
  configJson: string;
  callbackUrl: string;
  stateSecret: string;
  projectId?: string;
  accessorServiceAccount?: string;
  fetchImpl?: typeof fetch;
  secretWriter?: OAuthSecretWriter;
  stateTtlMs?: number;
};

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`invalid OAuth provider configuration: ${label}`);
  return value.trim();
}

function httpsUrl(value: string, label: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:")
    throw new Error(
      `invalid OAuth provider configuration: ${label} must use HTTPS`,
    );
  return parsed.toString();
}

function parseConfig(raw: string): OAuthConfigMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid OAuth provider configuration JSON");
  }
  if (!isRecord(parsed))
    throw new Error("invalid OAuth provider configuration JSON");
  const result: Record<string, OAuthProviderConfig> = {};
  for (const [providerKey, candidate] of Object.entries(parsed)) {
    if (!isRecord(candidate))
      throw new Error(
        `invalid OAuth provider configuration for ${providerKey}`,
      );
    const scopes = candidate.scopes;
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      scopes.some(
        (scope) => typeof scope !== "string" || scope.trim().length === 0,
      )
    ) {
      throw new Error(`invalid OAuth provider scopes for ${providerKey}`);
    }
    const tokenAuthMethod =
      candidate.tokenAuthMethod === undefined
        ? "basic"
        : candidate.tokenAuthMethod;
    if (tokenAuthMethod !== "basic" && tokenAuthMethod !== "post")
      throw new Error(`invalid OAuth tokenAuthMethod for ${providerKey}`);
    const provider = providerKey.trim().toLowerCase();
    if (!provider) throw new Error("OAuth provider name cannot be empty");
    result[provider] = {
      clientId: requiredString(candidate.clientId, `${providerKey}.clientId`),
      clientSecret: requiredString(
        candidate.clientSecret,
        `${providerKey}.clientSecret`,
      ),
      authorizationEndpoint: httpsUrl(
        requiredString(
          candidate.authorizationEndpoint,
          `${providerKey}.authorizationEndpoint`,
        ),
        `${providerKey}.authorizationEndpoint`,
      ),
      tokenEndpoint: httpsUrl(
        requiredString(candidate.tokenEndpoint, `${providerKey}.tokenEndpoint`),
        `${providerKey}.tokenEndpoint`,
      ),
      scopes: scopes.map((scope) => scope.trim()),
      tokenAuthMethod,
    };
  }
  return result;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function stateHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function encodeState(state: OAuthState, secret: string): string {
  const payload = base64Url(JSON.stringify(state));
  return `${payload}.${sign(payload, secret)}`;
}

function decodeState(raw: string, secret: string): OAuthState {
  const [payload, suppliedSignature, ...rest] = raw.split(".");
  if (!payload || !suppliedSignature || rest.length > 0)
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  const expectedSignature = sign(payload, secret);
  const supplied = Buffer.from(suppliedSignature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== "encois-oauth-state.v1" ||
    typeof parsed.integrationId !== "string" ||
    typeof parsed.organizationId !== "string" ||
    typeof parsed.actorId !== "string" ||
    typeof parsed.provider !== "string" ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number" ||
    typeof parsed.nonce !== "string"
  ) {
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  }
  if (
    parsed.expiresAt <= Math.floor(Date.now() / 1000) ||
    parsed.issuedAt > Math.floor(Date.now() / 1000) + 30
  ) {
    throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  }
  return {
    version: "encois-oauth-state.v1",
    integrationId: parsed.integrationId,
    organizationId: parsed.organizationId,
    actorId: parsed.actorId,
    ...(typeof parsed.userId === "string" ? { userId: parsed.userId } : {}),
    provider: parsed.provider,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
    nonce: parsed.nonce,
  };
}

function secretId(request: OAuthSecretWriteRequest): string {
  return `encois-integration-${request.organizationId}-${request.integrationId}`
    .replace(/[^a-zA-Z0-9-_]/gu, "-")
    .slice(0, 255);
}

async function grantSecretAccessor(
  resourceUrl: string,
  token: string,
  serviceAccount: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const current = await fetchImpl(`${resourceUrl}:getIamPolicy`, { headers });
  const currentBody: unknown = await current.json().catch(() => null);
  if (!current.ok || !isRecord(currentBody))
    throw new Error("OAUTH_SECRET_STORE_UNAVAILABLE");
  const bindings = Array.isArray(currentBody.bindings)
    ? currentBody.bindings
        .filter(isRecord)
        .map((binding) => ({
          role: typeof binding.role === "string" ? binding.role : "",
          members: Array.isArray(binding.members)
            ? binding.members.filter(
                (member): member is string => typeof member === "string",
              )
            : [],
        }))
        .filter((binding) => binding.role && binding.members.length > 0)
    : [];
  const accessor = `serviceAccount:${serviceAccount}`;
  const existing = bindings.find(
    (binding) => binding.role === "roles/secretmanager.secretAccessor",
  );
  if (existing && existing.members.includes(accessor)) return;
  if (existing) existing.members.push(accessor);
  else
    bindings.push({
      role: "roles/secretmanager.secretAccessor",
      members: [accessor],
    });
  const policy = {
    ...(typeof currentBody.etag === "string" ? { etag: currentBody.etag } : {}),
    bindings,
  };
  const updated = await fetchImpl(`${resourceUrl}:setIamPolicy`, {
    method: "POST",
    headers,
    body: JSON.stringify({ policy }),
  });
  if (!updated.ok) throw new Error("OAUTH_SECRET_STORE_UNAVAILABLE");
}

function createGoogleSecretWriter(
  projectId: string,
  fetchImpl: typeof fetch,
  accessorServiceAccount?: string,
): OAuthSecretWriter {
  const base = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`;
  return {
    async write(request) {
      let token: string;
      try {
        token = await fetchGoogleAccessToken(fetchImpl);
      } catch {
        throw new Error("OAUTH_SECRET_STORE_UNAVAILABLE");
      }
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const id = secretId(request);
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
          throw new Error("OAUTH_SECRET_STORE_UNAVAILABLE");
      } else if (!existing.ok) {
        throw new Error("OAUTH_SECRET_STORE_UNAVAILABLE");
      }
      const version = await fetchImpl(`${resourceUrl}:addVersion`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          payload: {
            data: Buffer.from(
              JSON.stringify(request.tokenSet),
              "utf8",
            ).toString("base64"),
          },
        }),
      });
      if (!version.ok) throw new Error("OAUTH_SECRET_STORE_UNAVAILABLE");
      if (accessorServiceAccount)
        await grantSecretAccessor(
          resourceUrl,
          token,
          accessorServiceAccount,
          fetchImpl,
        );
      return `secretmanager://projects/${projectId}/secrets/${id}`;
    },
  };
}

function tokenString(
  body: OAuthTokenResponse,
  key: string,
): string | undefined {
  return typeof body[key] === "string" && body[key].trim().length > 0
    ? body[key].trim()
    : undefined;
}

export function createOAuthIntegrationAuthorizationAdapter(
  options: OAuthAuthorizationAdapterOptions,
): IntegrationAuthorizationAdapter {
  if (options.stateSecret.trim().length < 32)
    throw new Error(
      "ENCOIS_INTEGRATION_OAUTH_STATE_SECRET must be at least 32 characters",
    );
  const callbackUrl = new URL(options.callbackUrl);
  if (
    callbackUrl.protocol !== "https:" &&
    callbackUrl.hostname !== "localhost" &&
    callbackUrl.hostname !== "127.0.0.1"
  )
    throw new Error(
      "ENCOIS_INTEGRATION_OAUTH_CALLBACK_URL must use HTTPS outside local development",
    );
  const providers = parseConfig(options.configJson);
  const fetchImpl = options.fetchImpl ?? fetch;
  const secretWriter =
    options.secretWriter ??
    (options.projectId
      ? createGoogleSecretWriter(
          options.projectId,
          fetchImpl,
          options.accessorServiceAccount,
        )
      : undefined);
  if (!secretWriter)
    throw new Error("OAuth Secret Manager writer is not configured");
  const stateTtlMs = options.stateTtlMs ?? DEFAULT_STATE_TTL_MS;

  return {
    async start(request: IntegrationAuthorizationAdapterRequest) {
      const provider = request.provider.trim().toLowerCase();
      const config = providers[provider];
      if (!config) throw new Error("INTEGRATION_PROVIDER_NOT_CONFIGURED");
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + Math.max(60, Math.floor(stateTtlMs / 1000));
      const state = encodeState(
        {
          version: "encois-oauth-state.v1",
          integrationId: request.integrationId,
          organizationId: request.organizationId,
          actorId: request.actorId,
          ...(request.userId ? { userId: request.userId } : {}),
          provider,
          issuedAt,
          expiresAt,
          nonce: randomUUID(),
        },
        options.stateSecret,
      );
      const authorizationUrl = new URL(config.authorizationEndpoint);
      authorizationUrl.searchParams.set("client_id", config.clientId);
      authorizationUrl.searchParams.set("redirect_uri", callbackUrl.toString());
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("scope", config.scopes.join(" "));
      return {
        status: "redirect" as const,
        authorizationUrl: authorizationUrl.toString(),
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        stateHash: stateHash(state),
      };
    },

    async inspectState(
      request: IntegrationAuthorizationCompleteRequest,
    ): Promise<IntegrationAuthorizationState> {
      if (!request.state.trim())
        throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
      const state = decodeState(request.state, options.stateSecret);
      return {
        stateHash: stateHash(request.state),
        integrationId: state.integrationId,
        organizationId: state.organizationId,
        actorId: state.actorId,
        ...(state.userId ? { userId: state.userId } : {}),
        provider: state.provider,
      };
    },

    async complete(
      request: IntegrationAuthorizationCompleteRequest,
    ): Promise<IntegrationAuthorizationCompleteResult> {
      if (!request.code.trim() || !request.state.trim())
        throw new Error("INTEGRATION_AUTHORIZATION_STATE_INVALID");
      const state = decodeState(request.state, options.stateSecret);
      const config = providers[state.provider];
      if (!config) throw new Error("INTEGRATION_PROVIDER_NOT_CONFIGURED");
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        code: request.code.trim(),
        redirect_uri: callbackUrl.toString(),
        client_id: config.clientId,
      });
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (config.tokenAuthMethod === "basic") {
        headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`;
      } else {
        params.set("client_secret", config.clientSecret);
      }
      const response = await fetchImpl(config.tokenEndpoint, {
        method: "POST",
        headers,
        body: params.toString(),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body) || !tokenString(body, "access_token"))
        throw new Error("INTEGRATION_AUTHORIZATION_FAILED");
      const tokenSet: Record<string, unknown> = {
        ...body,
        encois_token_obtained_at: new Date().toISOString(),
      };
      const credentialRef = await secretWriter.write({
        organizationId: state.organizationId,
        integrationId: state.integrationId,
        provider: state.provider,
        tokenSet,
      });
      return {
        stateHash: stateHash(request.state),
        integrationId: state.integrationId,
        organizationId: state.organizationId,
        actorId: state.actorId,
        ...(state.userId ? { userId: state.userId } : {}),
        provider: state.provider,
        credentialRef,
        status: "active",
      };
    },
  };
}

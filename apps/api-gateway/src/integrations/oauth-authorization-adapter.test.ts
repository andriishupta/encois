import { describe, expect, it } from "vitest";
import { createOAuthIntegrationAuthorizationAdapter } from "./oauth-authorization-adapter.js";

describe("OAuth integration authorization adapter", () => {
  it("signs state, exchanges the code, and stores only a Secret Manager reference", async () => {
    let stored: Record<string, unknown> | undefined;
    const adapter = createOAuthIntegrationAuthorizationAdapter({
      configJson: JSON.stringify({
        github: {
          clientId: "client-id",
          clientSecret: "server-only-secret",
          authorizationEndpoint: "https://github.com/login/oauth/authorize",
          tokenEndpoint: "https://github.com/login/oauth/access_token",
          scopes: ["repo:status", "read:user"],
        },
      }),
      callbackUrl: "https://app.example/api/v1/integrations/authorization/callback",
      stateSecret: "a-state-secret-that-is-longer-than-thirty-two-characters",
      fetchImpl: async (_input, init) => {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("code=one-time-code");
        return new Response(JSON.stringify({ access_token: "provider-token", token_type: "bearer", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
      },
      secretWriter: {
        async write(request) {
          stored = request.tokenSet;
          return "secretmanager://projects/demo/secrets/encois-integration-org-integration";
        },
      },
    });

    const started = await adapter.start({
      integrationId: "integration",
      organizationId: "org",
      actorId: "actor",
      userId: "user",
      provider: "GitHub",
      scopeIds: ["team"],
      grantedScopes: ["code.read"],
    });
    expect(started.status).toBe("redirect");
    if (started.status !== "redirect") throw new Error("expected redirect");
    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.searchParams.get("client_id")).toBe("client-id");
    expect(authorizationUrl.searchParams.get("scope")).toBe("repo:status read:user");
    if (!adapter.complete) throw new Error("expected OAuth completion handler");
    const result = await adapter.complete({ code: "one-time-code", state: authorizationUrl.searchParams.get("state") ?? "" });
    expect(result).toMatchObject({ integrationId: "integration", organizationId: "org", userId: "user", credentialRef: "secretmanager://projects/demo/secrets/encois-integration-org-integration", status: "active" });
    expect(stored).toMatchObject({ access_token: "provider-token" });
  });

  it("rejects tampered state before contacting the provider", async () => {
    const adapter = createOAuthIntegrationAuthorizationAdapter({
      configJson: JSON.stringify({ github: { clientId: "id", clientSecret: "secret", authorizationEndpoint: "https://github.com/authorize", tokenEndpoint: "https://github.com/token", scopes: ["read:user"] } }),
      callbackUrl: "https://app.example/callback",
      stateSecret: "a-state-secret-that-is-longer-than-thirty-two-characters",
      secretWriter: { async write() { return "secretmanager://projects/demo/secrets/test"; } },
      fetchImpl: async () => { throw new Error("provider must not be called"); },
    });
    if (!adapter.complete) throw new Error("expected OAuth completion handler");
    await expect(adapter.complete({ code: "code", state: "tampered.state" })).rejects.toThrow("INTEGRATION_AUTHORIZATION_STATE_INVALID");
  });
});

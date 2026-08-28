import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("API auth configuration", () => {
  const configuredEnv = {
    AGENT_GATEWAY_POLICY_VERSION: "policy-read-only-fixture-v1",
  } as const;

  it("keeps production sign-in provider restrictions Google-only by default", () => {
    expect(
      loadConfig(configuredEnv).identityPlatformAllowedSignInProviders,
    ).toEqual(["google.com"]);
  });

  it("allows local emulator providers through explicit configuration", () => {
    expect(
      loadConfig({
        ...configuredEnv,
        IDENTITY_PLATFORM_ALLOWED_SIGN_IN_PROVIDERS: "google.com, password",
      }).identityPlatformAllowedSignInProviders,
    ).toEqual(["google.com", "password"]);
  });

  it("rejects password authentication in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        IDENTITY_PLATFORM_ALLOWED_SIGN_IN_PROVIDERS: "google.com,password",
      }),
    ).toThrow(
      "Production Identity Platform authentication must allow only google.com.",
    );
  });

  it("rejects the Firebase Auth Emulator in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      }),
    ).toThrow(
      "FIREBASE_AUTH_EMULATOR_HOST must not be configured in production.",
    );
  });
});

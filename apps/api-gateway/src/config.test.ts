import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("API auth configuration", () => {
  it("keeps production sign-in provider restrictions Google-only by default", () => {
    expect(loadConfig({}).identityPlatformAllowedSignInProviders).toEqual(["google.com"]);
  });

  it("allows local emulator providers through explicit configuration", () => {
    expect(
      loadConfig({ IDENTITY_PLATFORM_ALLOWED_SIGN_IN_PROVIDERS: "google.com, password" })
        .identityPlatformAllowedSignInProviders,
    ).toEqual(["google.com", "password"]);
  });
});

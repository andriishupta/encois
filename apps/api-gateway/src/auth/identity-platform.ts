import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import type { Context } from "hono";
import type { AosAuthenticationResult, AosAuthenticator, AosPrincipal, GatewayEnv } from "../middleware/aos.js";

export type IdentityPlatformIdentity = {
  email?: string;
  emailVerified: boolean;
  identityProvider: string;
  subject: string;
  tenantId?: string;
};

export type IdentityPlatformAuthenticatorOptions = {
  checkRevoked?: boolean;
  projectId: string;
  resolvePrincipal: (identity: IdentityPlatformIdentity, context: Context<GatewayEnv>) => Promise<AosPrincipal | null>;
};

function bearerToken(context: Context<GatewayEnv>): string | null {
  const header = context.req.header("Authorization");
  if (!header) return null;

  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function identityFromToken(token: DecodedIdToken): IdentityPlatformIdentity {
  const firebase = token.firebase as { identities?: Record<string, unknown>; sign_in_provider?: string } | undefined;
  const identityProvider = firebase?.sign_in_provider ?? "identity-platform";

  return {
    email: typeof token.email === "string" ? token.email : undefined,
    emailVerified: token.email_verified === true,
    identityProvider,
    subject: token.uid,
    tenantId: typeof token.firebase?.tenant === "string" ? token.firebase.tenant : undefined,
  };
}

export function createIdentityPlatformAuthenticator(
  options: IdentityPlatformAuthenticatorOptions,
): AosAuthenticator {
  const app =
    getApps().find((candidate) => candidate.options.projectId === options.projectId) ??
    initializeApp({
      credential: applicationDefault(),
      projectId: options.projectId,
    }, `identity-platform-${options.projectId}`);
  const auth = getAuth(app);

  return async (context): Promise<AosAuthenticationResult> => {
    const token = bearerToken(context);
    if (!token) {
      return { reason: "missing_bearer_token", status: "unauthenticated" };
    }

    try {
      const decodedToken = await auth.verifyIdToken(token, options.checkRevoked ?? false);
      const principal = await options.resolvePrincipal(identityFromToken(decodedToken), context);

      return principal
        ? { principal, status: "authenticated" }
        : { reason: "identity_has_no_active_membership", status: "unauthenticated" };
    } catch {
      return { reason: "invalid_identity_platform_token", status: "unauthenticated" };
    }
  };
}

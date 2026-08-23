export type IntegrationAuthorizationAdapterRequest = {
  integrationId: string;
  organizationId: string;
  actorId: string;
  userId?: string;
  provider: string;
  scopeIds: readonly string[];
  grantedScopes: readonly string[];
};

export type IntegrationAuthorizationAdapterResult =
  | { status: "redirect"; authorizationUrl: string; expiresAt?: string; stateHash?: string }
  | { status: "pending"; expiresAt?: string };

export type IntegrationAuthorizationCompleteRequest = {
  code: string;
  state: string;
};

export type IntegrationAuthorizationCompleteResult = {
  stateHash: string;
  integrationId: string;
  organizationId: string;
  actorId: string;
  userId?: string;
  provider: string;
  credentialRef: string;
  status?: "authorized" | "active";
};

export type IntegrationAuthorizationState = Omit<IntegrationAuthorizationCompleteResult, "credentialRef" | "status">;

/**
 * Provider-specific OAuth/Secret Manager work belongs outside the control
 * plane. The adapter receives metadata only and must never return credentials.
 */
export type IntegrationAuthorizationAdapter = {
  start: (request: IntegrationAuthorizationAdapterRequest) => Promise<IntegrationAuthorizationAdapterResult>;
  /** Validate and decode callback state without exchanging the provider code. */
  inspectState?: (request: IntegrationAuthorizationCompleteRequest) => Promise<IntegrationAuthorizationState>;
  complete?: (request: IntegrationAuthorizationCompleteRequest) => Promise<IntegrationAuthorizationCompleteResult>;
};

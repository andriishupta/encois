const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Resolve a short-lived workload identity token; never accepts a caller token. */
export async function fetchGoogleAccessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string" || body.access_token.trim().length === 0) {
    throw new Error("GOOGLE_ACCESS_TOKEN_UNAVAILABLE");
  }
  return body.access_token;
}

export type IdentityTokenFetch = (audience: string, fetchImpl: typeof fetch) => Promise<string>;

const METADATA_IDENTITY_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

/**
 * Cloud Run's internal ingress requires a Google identity token in addition to
 * Encois' service token. The metadata server is available only to the
 * deployed workload; local clients intentionally omit this header unless an
 * audience is configured.
 */
export const fetchCloudRunIdentityToken: IdentityTokenFetch = async (audience, fetchImpl) => {
  const response = await fetchImpl(`${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}`, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!response.ok) throw new Error(`Cloud Run identity token request failed with HTTP ${response.status}`);
  const token = (await response.text()).trim();
  if (!token) throw new Error("Cloud Run identity token response was empty");
  return token;
};

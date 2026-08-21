export type AuthSession = {
  accessToken: string;
  organizationId?: string;
};

const AUTH_SESSION_KEY = 'encois.auth.session.v1';
const AUTH_SESSION_EVENT = 'encois:auth-session-changed';

type DashboardEnv = {
  MODE?: string;
  VITE_ENCOIS_ACCESS_TOKEN?: string;
  VITE_ENCOIS_ORGANIZATION_ID?: string;
};

function environment(): DashboardEnv {
  return (import.meta as ImportMeta & { env?: DashboardEnv }).env ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the tab-scoped browser session. Identity Platform/Firebase should
 * eventually own token acquisition and refresh; this storage boundary keeps
 * that adapter out of API calls and makes the current local fixture explicit.
 */
export function getAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(AUTH_SESSION_KEY) ?? 'null');
    if (!isRecord(value) || typeof value.accessToken !== 'string' || value.accessToken.trim().length === 0) return null;

    return {
      accessToken: value.accessToken,
      ...(typeof value.organizationId === 'string' && value.organizationId.trim().length > 0
        ? { organizationId: value.organizationId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function setAuthSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;

  window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;

  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

export function getDevelopmentAuthSession(): AuthSession | null {
  const env = environment();
  const accessToken = env.VITE_ENCOIS_ACCESS_TOKEN?.trim();

  // A VITE_* value is embedded into the bundle. Never treat it as a hosted
  // production secret or use it outside the local development scaffold.
  if (env.MODE !== 'development' || !accessToken) return null;

  return {
    accessToken,
    ...(env.VITE_ENCOIS_ORGANIZATION_ID?.trim()
      ? { organizationId: env.VITE_ENCOIS_ORGANIZATION_ID.trim() }
      : {}),
  };
}

export function authSessionEventName(): string {
  return AUTH_SESSION_EVENT;
}

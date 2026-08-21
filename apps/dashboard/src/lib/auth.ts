import { initializeApp } from 'firebase/app'
import { isJsonObject } from '@encois/contracts'
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'

export type AuthSession = {
  /** Only populated for the local development fixture. Production uses Firebase SDK token acquisition. */
  accessToken: string
  organizationId?: string
}

const AUTH_SESSION_KEY = 'encois.auth.session.v1'
const AUTH_ORGANIZATION_KEY = 'encois.auth.organization.v1'
const AUTH_SESSION_EVENT = 'encois:auth-session-changed'
const FIREBASE_AUTH_SENTINEL = 'identity-platform-sdk'

type DashboardEnv = {
  MODE?: string
  VITE_ENCOIS_UI_MODE?: string
  VITE_ENCOIS_ACCESS_TOKEN?: string
  VITE_ENCOIS_ORGANIZATION_ID?: string
  VITE_FIREBASE_API_KEY?: string
  VITE_FIREBASE_AUTH_DOMAIN?: string
  VITE_FIREBASE_PROJECT_ID?: string
  VITE_FIREBASE_APP_ID?: string
  VITE_FIREBASE_AUTH_EMULATOR_HOST?: string
}

function environment(): DashboardEnv {
  return (import.meta as ImportMeta & { env?: DashboardEnv }).env ?? {}
}

function configuredFirebase(): boolean {
  const env = environment()
  return Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_AUTH_DOMAIN && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID)
}

const firebaseAuth = configuredFirebase()
  ? getAuth(
      initializeApp({
        apiKey: environment().VITE_FIREBASE_API_KEY,
        authDomain: environment().VITE_FIREBASE_AUTH_DOMAIN,
        projectId: environment().VITE_FIREBASE_PROJECT_ID,
        appId: environment().VITE_FIREBASE_APP_ID,
      }),
    )
  : null

const firebaseAuthEmulatorHost = environment().VITE_FIREBASE_AUTH_EMULATOR_HOST?.trim()
if (firebaseAuth && firebaseAuthEmulatorHost) {
  connectAuthEmulator(firebaseAuth, `http://${firebaseAuthEmulatorHost}`, { disableWarnings: true })
}

let currentFirebaseUser: User | null = null
let authStateReadyResolve: (() => void) | undefined
const authStateReady = new Promise<void>((resolve) => {
  authStateReadyResolve = resolve
})
const persistenceReady = firebaseAuth
  ? setPersistence(firebaseAuth, browserSessionPersistence)
  : Promise.resolve()

if (firebaseAuth) {
  onAuthStateChanged(firebaseAuth, (user) => {
    currentFirebaseUser = user
    authStateReadyResolve?.()
    window.dispatchEvent(new Event(AUTH_SESSION_EVENT))
  })
} else {
  authStateReadyResolve?.()
}

function storedOrganizationId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const organizationId = window.sessionStorage.getItem(AUTH_ORGANIZATION_KEY)?.trim()
  return organizationId || undefined
}

/** Wait until Firebase has restored the browser session before routing. */
export async function initializeBrowserAuth(): Promise<void> {
  await Promise.all([persistenceReady, authStateReady])
}

/** Returns a synchronous route/session snapshot after initializeBrowserAuth(). */
export function getAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null

  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(AUTH_SESSION_KEY) ?? 'null')
    if (isJsonObject(value) && typeof value.accessToken === 'string' && value.accessToken.trim().length > 0) {
      return {
        accessToken: value.accessToken,
        ...(typeof value.organizationId === 'string' && value.organizationId.trim().length > 0
          ? { organizationId: value.organizationId }
          : {}),
      }
    }
  } catch {
    // A malformed local development fixture is treated as signed out.
  }

  const organizationId = storedOrganizationId()
  return currentFirebaseUser && organizationId
    ? { accessToken: FIREBASE_AUTH_SENTINEL, organizationId }
    : null
}

/** Gets a fresh bearer token without exposing Firebase refresh tokens to API code. */
export async function getAuthSessionToken(): Promise<AuthSession | null> {
  const localSession = getAuthSession()
  if (localSession && localSession.accessToken !== FIREBASE_AUTH_SENTINEL) return localSession

  await initializeBrowserAuth()
  if (!firebaseAuth?.currentUser) return null

  const organizationId = storedOrganizationId()
  return {
    accessToken: await firebaseAuth.currentUser.getIdToken(),
    ...(organizationId ? { organizationId } : {}),
  }
}

export function setAuthSession(session: AuthSession): void {
  if (typeof window === 'undefined') return

  window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
  if (session.organizationId) window.sessionStorage.setItem(AUTH_ORGANIZATION_KEY, session.organizationId)
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT))
}

export function setAuthOrganizationId(organizationId: string): void {
  if (typeof window === 'undefined') return

  window.sessionStorage.setItem(AUTH_ORGANIZATION_KEY, organizationId)
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT))
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return

  window.sessionStorage.removeItem(AUTH_SESSION_KEY)
  window.sessionStorage.removeItem(AUTH_ORGANIZATION_KEY)
  if (firebaseAuth?.currentUser) void signOut(firebaseAuth)
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT))
}

export async function signInWithGoogle(): Promise<User> {
  if (!firebaseAuth) throw new Error('Identity Platform browser configuration is missing.')

  const provider = new GoogleAuthProvider()
  const result = await signInWithPopup(firebaseAuth, provider)
  return result.user
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  if (!firebaseAuth || !firebaseAuthEmulatorHost) throw new Error('Local Firebase Auth Emulator is not configured.')

  const result = await signInWithEmailAndPassword(firebaseAuth, email, password)
  return result.user
}

export async function signOutFromIdentityPlatform(): Promise<void> {
  if (firebaseAuth) await signOut(firebaseAuth)
  clearAuthSession()
}

export function isIdentityPlatformConfigured(): boolean {
  return firebaseAuth !== null
}

export function isFirebaseAuthEmulatorConfigured(): boolean {
  return firebaseAuth !== null && Boolean(firebaseAuthEmulatorHost)
}

export function getDevelopmentAuthSession(): AuthSession | null {
  const env = environment()
  const accessToken = env.VITE_ENCOIS_ACCESS_TOKEN?.trim()

  // A VITE_* value is embedded into the bundle. Never treat it as a hosted
  // production secret or use it outside the local development scaffold.
  if (env.MODE !== 'development' || !accessToken) return null

  return {
    accessToken,
    ...(env.VITE_ENCOIS_ORGANIZATION_ID?.trim()
      ? { organizationId: env.VITE_ENCOIS_ORGANIZATION_ID.trim() }
      : {}),
  }
}

/**
 * The local UI fixture is opt-in. API-backed pages must not silently turn
 * transient API failures into fabricated organization or workspace state.
 */
export function isDashboardMockMode(): boolean {
  return environment().VITE_ENCOIS_UI_MODE?.trim().toLowerCase() === 'mock'
}

export function authSessionEventName(): string {
  return AUTH_SESSION_EVENT
}

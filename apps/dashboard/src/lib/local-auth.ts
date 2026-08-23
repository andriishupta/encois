import { signInWithEmailAndPassword, type User } from 'firebase/auth'
import { getFirebaseAuth, isFirebaseAuthEmulatorConfigured } from './auth'

export async function signInWithLocalEmail(email: string, password: string): Promise<User> {
  const firebaseAuth = getFirebaseAuth()
  if (!firebaseAuth || !isFirebaseAuthEmulatorConfigured()) {
    throw new Error('Local Firebase Auth Emulator is not configured.')
  }

  const result = await signInWithEmailAndPassword(firebaseAuth, email, password)
  return result.user
}

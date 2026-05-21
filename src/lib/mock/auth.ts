/**
 * Mock for `firebase/auth`. Provides a synthetic operator account that
 * "signs in" immediately on first access. Used in place of Google /
 * Microsoft OAuth so the portfolio demo loads without provider config.
 *
 * The Web3 "Connect Wallet" UX in Phase 4 will swap the displayed
 * identity to a wallet address; this auth layer just provides the
 * uid/email that downstream code asserts on.
 */

import { fsGetDoc, fsSetDoc } from './store';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  providerData: Array<{ providerId: string; uid: string; email: string | null }>;
  getIdToken: () => Promise<string>;
  getIdTokenResult: () => Promise<{ token: string; claims: Record<string, any> }>;
  metadata: { creationTime: string; lastSignInTime: string };
}

export interface Auth {
  __mock: true;
  currentUser: AuthUser | null;
  app: any;
  signOut: () => Promise<void>;
}

const DEMO_USER: AuthUser = {
  uid: 'demo_operator_001',
  email: 'operator@rigwatch.app',
  displayName: 'Demo Operator',
  photoURL: null,
  emailVerified: true,
  isAnonymous: false,
  providerData: [{ providerId: 'demo', uid: 'demo_operator_001', email: 'operator@rigwatch.app' }],
  getIdToken: async () => 'mock-id-token',
  getIdTokenResult: async () => ({ token: 'mock-id-token', claims: { role: 'developer' } }),
  metadata: {
    creationTime: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString(),
    lastSignInTime: new Date().toISOString(),
  },
};

let _currentUser: AuthUser | null = DEMO_USER;

// Seed Firestore user profile with developer role so the auth bootstrap
// hooks see a complete record on first read.
fsSetDoc('users', DEMO_USER.uid, {
  uid: DEMO_USER.uid,
  email: DEMO_USER.email,
  displayName: DEMO_USER.displayName,
  role: 'developer',
  createdAt: DEMO_USER.metadata.creationTime,
  lastLoginAt: DEMO_USER.metadata.lastSignInTime,
  isActive: true,
  language: 'en',
});

type AuthListener = (user: AuthUser | null) => void;
const listeners = new Set<AuthListener>();

const notify = (): void => {
  for (const l of listeners) {
    try { l(_currentUser); } catch {}
  }
};

export const getAuth = (_app?: any): Auth => ({
  __mock: true,
  get currentUser() { return _currentUser; },
  app: _app,
  signOut: async () => {
    _currentUser = null;
    notify();
  },
});

export const signOut = async (_auth?: Auth): Promise<void> => {
  _currentUser = null;
  notify();
};

export const onAuthStateChanged = (
  _auth: Auth,
  callback: AuthListener,
  _errorCb?: any,
): (() => void) => {
  listeners.add(callback);
  // Fire immediately with current state — matches Firebase behaviour.
  queueMicrotask(() => {
    try { callback(_currentUser); } catch {}
  });
  return () => listeners.delete(callback) as unknown as void;
};

// OAuth providers — kept as constructable classes so legacy code that does
// `new GoogleAuthProvider()` doesn't blow up.

export class GoogleAuthProvider {
  providerId = 'google.com';
  private params: Record<string, string> = {};
  setCustomParameters(p: Record<string, string>) { this.params = { ...this.params, ...p }; }
  addScope(_s: string) {}
}

export class OAuthProvider {
  providerId: string;
  private params: Record<string, string> = {};
  constructor(providerId: string) { this.providerId = providerId; }
  setCustomParameters(p: Record<string, string>) { this.params = { ...this.params, ...p }; }
  addScope(_s: string) {}
}

export interface UserCredential {
  user: AuthUser;
  providerId: string | null;
  operationType: 'signIn';
}

const signInDemo = async (providerId: string): Promise<UserCredential> => {
  // Simulate a short popup delay so the spinner in LoginModal has a beat.
  await new Promise((res) => setTimeout(res, 600));
  _currentUser = DEMO_USER;
  // Refresh the firestore profile timestamp.
  const existing = fsGetDoc('users', DEMO_USER.uid);
  fsSetDoc('users', DEMO_USER.uid, {
    ...(existing ?? {}),
    lastLoginAt: new Date().toISOString(),
    isActive: true,
  });
  notify();
  return { user: DEMO_USER, providerId, operationType: 'signIn' };
};

export const signInWithPopup = async (_auth: Auth, provider: any): Promise<UserCredential> =>
  signInDemo(provider?.providerId ?? 'demo');

export const signInWithRedirect = async (_auth: Auth, provider: any): Promise<void> => {
  await signInDemo(provider?.providerId ?? 'demo');
};

export const getRedirectResult = async (_auth: Auth): Promise<UserCredential | null> =>
  _currentUser ? { user: _currentUser, providerId: 'demo', operationType: 'signIn' } : null;

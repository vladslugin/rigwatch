/**
 * Firebase entry point.
 *
 * In the RigWatch portfolio build there is no actual Firebase backend —
 * every `firebase/*` import is rewired in vite.config.ts to point at the
 * in-memory mock under `src/lib/mock`. The exports below therefore return
 * mock-shaped sentinels that the rest of the codebase consumes verbatim.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';

// Importing the store triggers the telemetry pumper so the dashboard has
// live data as soon as anything reads `temporaer/{rigId}`.
import './mock/store';

const app: FirebaseApp = initializeApp({ projectId: 'rigwatch-demo' });

export const realtimeDB: Database = getDatabase(app);
export const firestoreDB: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({ tenant: 'common', prompt: 'select_account' });

export type { Database, Firestore, Auth };
export default app;

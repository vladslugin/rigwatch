import { initializeApp, type FirebaseApp, getApps, getApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';

type FirebaseConfig = {
  apiKey: string | undefined;
  authDomain: string | undefined;
  databaseURL: string | undefined;
  projectId: string | undefined;
  storageBucket: string | undefined;
  messagingSenderId: string | undefined;
  appId: string | undefined;
  measurementId: string | undefined;
};

const LOG_PREFIX = '[Firebase]';

// Firebase configuration from environment variables (public at runtime)
const firebaseConfig: FirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const findMissingConfigKeys = (config: FirebaseConfig) =>
  Object.entries(config)
    .filter(([_, v]) => !v)
    .map(([k]) => k);

// Basic runtime validation to help during setup
const missingKeys = findMissingConfigKeys(firebaseConfig);
if (missingKeys.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`${LOG_PREFIX} Missing env vars for config:`, missingKeys.join(', '));
}

// LEGACY: Prevent multiple Firebase initializations
let app: FirebaseApp | null = null;
let realtimeDB: Database | null = null;
let firestoreDB: Firestore | null = null;
let auth: Auth | null = null;

const initFirebaseServices = () => {
  try {
    // Check if Firebase app is already initialized
    const existingApps = getApps();
    if (existingApps.length > 0) {
      console.log(`${LOG_PREFIX} Using existing Firebase app`);
      app = getApp(); // Use existing app
    } else {
      console.log(`${LOG_PREFIX} Initializing new Firebase app`);
      app = initializeApp(firebaseConfig);
    }
    realtimeDB = getDatabase(app);
    firestoreDB = getFirestore(app);
    auth = getAuth(app);
    console.log(`${LOG_PREFIX} Initialized successfully`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Initialization failed:`, error);
    // WORKAROUND: fallback to existing app if initialization fails
    try {
      app = getApp();
      console.log(`${LOG_PREFIX} Fallback: Using existing app`);
    } catch (fallbackError) {
      console.error(`${LOG_PREFIX} Fallback failed:`, fallbackError);
      throw new Error('Failed to initialize Firebase');
    }
  }
};

initFirebaseServices();

// Add connection state monitoring
const monitorRealtimeConnection = () => {
  if (!realtimeDB) return;
  import('firebase/database').then(({ ref, onValue }) => {
    const connectedRef = ref(realtimeDB!, '.info/connected');
    onValue(connectedRef, (snapshot) => {
      const connected = snapshot.val();
      // MAGIC: log the connection state for diagnostics in production
      console.log(`${LOG_PREFIX} Connection state:`, connected ? 'Connected' : 'Disconnected');
    });
  });
};

monitorRealtimeConnection();

console.log(`${LOG_PREFIX} All services initialized successfully`);

// Configure Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
  // LEGACY: removed hd restriction to allow all Google accounts
});

// Configure Microsoft Auth Provider
export const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({
  tenant: 'common', // MAGIC: allow all Microsoft accounts (personal and work)
  prompt: 'select_account'
});

export { realtimeDB, firestoreDB, auth };
export type { Database, Firestore, Auth };
export default app;

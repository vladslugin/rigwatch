/**
 * Mock for `firebase/app`. Returns a sentinel object whenever the legacy
 * code asks to initialise / fetch a Firebase app. The downstream modules
 * (database / firestore / auth) ignore the value entirely.
 */

export interface FirebaseApp {
  __mock: true;
  name: string;
  options: Record<string, any>;
}

let _app: FirebaseApp | null = null;

export const initializeApp = (config?: Record<string, any>, name = '[DEFAULT]'): FirebaseApp => {
  _app = { __mock: true, name, options: config ?? {} };
  return _app;
};

export const getApps = (): FirebaseApp[] => (_app ? [_app] : []);

export const getApp = (_name?: string): FirebaseApp => {
  if (!_app) _app = initializeApp({});
  return _app;
};

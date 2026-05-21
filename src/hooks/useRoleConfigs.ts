import { useEffect } from 'react';
import { firestoreDB } from '../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import type { UserRole, UserRoleConfig } from '../types/auth';
import { USER_ROLE_CONFIGS } from '../types/auth';

const ROLECONFIGS_COLLECTION = 'roleConfigs';
const DEV_STORAGE_KEY = 'roleConfigsDev';

type RoleConfigsRecord = Record<UserRole, UserRoleConfig>;

// Simple in-module pub/sub for DEV and manual broadcasts
type Listener = (configs: RoleConfigsRecord) => void;
const listeners = new Set<Listener>();

const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';

const ensureAllRoles = (partial: Partial<RoleConfigsRecord>): RoleConfigsRecord => {
  const merged: any = { ...USER_ROLE_CONFIGS, ...partial };
  return merged as RoleConfigsRecord;
};

const readDevStorage = (): RoleConfigsRecord => {
  try {
    const raw = localStorage.getItem(DEV_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return ensureAllRoles(parsed);
  } catch {
    return USER_ROLE_CONFIGS;
  }
};

const writeDevStorage = (configs: RoleConfigsRecord) => {
  try {
    localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(configs));
  } catch {}
};

export const getAllRoleConfigs = async (): Promise<RoleConfigsRecord> => {
  if (isDev || !firestoreDB) {
    return readDevStorage();
  }
  try {
    const colRef = collection(firestoreDB, ROLECONFIGS_COLLECTION);
    const snap = await getDocs(colRef);
    const map: Partial<RoleConfigsRecord> = {};
    snap.forEach(d => {
      const id = d.id as UserRole;
      const data = d.data() as UserRoleConfig;
      if (id && data) {
        map[id] = data;
      }
    });
    return ensureAllRoles(map);
  } catch {
    return USER_ROLE_CONFIGS;
  }
};

export const getRoleConfig = async (role: UserRole): Promise<UserRoleConfig> => {
  if (isDev || !firestoreDB) {
    const all = readDevStorage();
    return all[role] || USER_ROLE_CONFIGS[role];
  }
  try {
    const ref = doc(firestoreDB, ROLECONFIGS_COLLECTION, role);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserRoleConfig;
    }
  } catch {}
  return USER_ROLE_CONFIGS[role];
};

export const saveRoleConfig = async (role: UserRole, data: Partial<UserRoleConfig>): Promise<void> => {
  if (isDev || !firestoreDB) {
    const current = readDevStorage();
    const next: RoleConfigsRecord = {
      ...current,
      [role]: {
        ...current[role],
        ...data
      } as UserRoleConfig
    };
    writeDevStorage(next);
    // Broadcast to listeners
    listeners.forEach(l => l(next));
    return;
  }
  const ref = doc(firestoreDB, ROLECONFIGS_COLLECTION, role);
  // Merge existing with new
  try {
    const existingSnap = await getDoc(ref);
    const payload = existingSnap.exists()
      ? { ...existingSnap.data(), ...data, updatedAt: serverTimestamp() }
      : { ...USER_ROLE_CONFIGS[role], ...data, updatedAt: serverTimestamp() };
    if (existingSnap.exists()) {
      await updateDoc(ref, payload as any);
    } else {
      await setDoc(ref, payload as any);
    }
  } finally {
    // Firestore listeners will notify subscribers
  }
};

export const subscribeRoleConfigs = (listener: Listener): (() => void) => {
  listeners.add(listener);
  // Initial emit
  getAllRoleConfigs().then(cfg => {
    try { listener(cfg); } catch {}
  });

  let unsubscribeFirestore: (() => void) | null = null;

  if (!isDev && firestoreDB) {
    const colRef = collection(firestoreDB, ROLECONFIGS_COLLECTION);
    unsubscribeFirestore = onSnapshot(colRef, async () => {
      const cfgs = await getAllRoleConfigs();
      listeners.forEach(l => {
        try { l(cfgs); } catch {}
      });
    });
  } else {
    // DEV: listen to localStorage changes across tabs
    const storageHandler = (e: StorageEvent) => {
      if (e.key === DEV_STORAGE_KEY) {
        const cfgs = readDevStorage();
        listeners.forEach(l => {
          try { l(cfgs); } catch {}
        });
      }
    };
    window.addEventListener('storage', storageHandler);
    unsubscribeFirestore = () => window.removeEventListener('storage', storageHandler);
  }

  return () => {
    listeners.delete(listener);
    try { unsubscribeFirestore?.(); } catch {}
  };
};

// Optional React helper: ensure subscription tied to component lifecycle
export const useRoleConfigsSubscription = (onChange: Listener) => {
  useEffect(() => subscribeRoleConfigs(onChange), [onChange]);
};


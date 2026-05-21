import { useCallback, useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useAuth } from './useAuth';

/** Firestore collection for scripts visible to all authenticated users (see security rules). */
export const RIGOPS_SHARED_SCRIPTS_COLLECTION = 'rigops_shared_scripts';

export type SharedRigopsScriptRow = {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  updatedByName?: string;
};

/** Firestore document ~1 MiB max — keep a safe margin for metadata */
const MAX_CONTENT_CHARS = 900_000;

/**
 * Real-time shared Rigops script library.
 *
 * Deploy Firestore rules, e.g.:
 * ```
 * match /rigops_shared_scripts/{id} {
 *   allow read, create, update, delete: if request.auth != null;
 * }
 * ```
 * Tighten further (e.g. custom claims / roles) as needed.
 */
export function useSharedRigopsScripts(enabled: boolean) {
  const { user, isAuthenticated } = useAuth();
  const [scripts, setScripts] = useState<SharedRigopsScriptRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUse = Boolean(firestoreDB && isAuthenticated && user);

  useEffect(() => {
    if (!enabled || !canUse || !firestoreDB) {
      setScripts([]);
      setLoading(false);
      if (!enabled) setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const colRef = collection(firestoreDB, RIGOPS_SHARED_SCRIPTS_COLLECTION);
    const q = query(colRef, orderBy('updatedAt', 'desc'), limit(200));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: SharedRigopsScriptRow[] = [];
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const updatedAtRaw = data.updatedAt;
          let updatedAt = 0;
          if (typeof updatedAtRaw === 'number') {
            updatedAt = updatedAtRaw;
          } else if (
            updatedAtRaw &&
            typeof updatedAtRaw === 'object' &&
            'toMillis' in updatedAtRaw &&
            typeof (updatedAtRaw as { toMillis: () => number }).toMillis === 'function'
          ) {
            updatedAt = (updatedAtRaw as { toMillis: () => number }).toMillis();
          }
          list.push({
            id: d.id,
            name: typeof data.name === 'string' ? data.name : 'Untitled',
            content: typeof data.content === 'string' ? data.content : '',
            updatedAt,
            updatedByName: typeof data.updatedByName === 'string' ? data.updatedByName : undefined,
          });
        });
        setScripts(list);
        setLoading(false);
      },
      (err) => {
        console.error('[useSharedRigopsScripts]', err);
        setError(err.message || 'Firestore error');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [enabled, canUse, user?.uid]);

  const saveScript = useCallback(
    async (existingId: string | null, name: string, content: string): Promise<string> => {
      if (!firestoreDB || !user) {
        throw new Error('Team library unavailable');
      }
      if (content.length > MAX_CONTENT_CHARS) {
        throw new Error(`Script too large (max ~${MAX_CONTENT_CHARS} characters)`);
      }
      const payload = {
        name: name.trim() || 'Untitled',
        content,
        updatedAt: Date.now(),
        updatedByUid: user.uid,
        updatedByName: (user.displayName || user.email || 'unknown').toString().slice(0, 200),
        updatedByEmail: (user.email ?? '').toString().slice(0, 200),
      };
      if (existingId) {
        await updateDoc(doc(firestoreDB, RIGOPS_SHARED_SCRIPTS_COLLECTION, existingId), payload);
        return existingId;
      }
      const ref = await addDoc(collection(firestoreDB, RIGOPS_SHARED_SCRIPTS_COLLECTION), {
        ...payload,
        createdAt: Date.now(),
        createdByUid: user.uid,
        createdByEmail: (user.email ?? '').toString().slice(0, 200),
        createdByName: (user.displayName || user.email || 'unknown').toString().slice(0, 200),
      });
      return ref.id;
    },
    [user],
  );

  const deleteScript = useCallback(async (scriptId: string) => {
    if (!firestoreDB) throw new Error('Firestore not initialized');
    await deleteDoc(doc(firestoreDB, RIGOPS_SHARED_SCRIPTS_COLLECTION, scriptId));
  }, []);

  return {
    scripts,
    loading,
    error,
    canUse,
    saveScript,
    deleteScript,
  };
}

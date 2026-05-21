import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useAuth } from './useAuth';
import {
  DEFAULT_BRENNBEWERTUNG_KNOWLEDGE,
} from '../utils/brennbewertungKnowledge';
import type { BrennbewertungKnowledgeBase } from '../types/brennbewertung';
import { BRENNBEWERTUNG_KEYS } from '../types/brennbewertung';

const DOC_PATH = ['dealer_knowledge', 'brennbewertung'] as const;

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
};

/**
 * Coerce a Firestore document into a fully-populated knowledge base. Any
 * missing variable falls back to the default text so the dealer view always
 * has something to render, even if Claus only edited part of the data.
 */
const mergeWithDefaults = (raw: unknown): BrennbewertungKnowledgeBase => {
  const merged = {} as BrennbewertungKnowledgeBase;
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  for (const key of BRENNBEWERTUNG_KEYS) {
    const incoming = source[key];
    const fallback = DEFAULT_BRENNBEWERTUNG_KNOWLEDGE[key];
    if (!incoming || typeof incoming !== 'object') {
      merged[key] = fallback;
      continue;
    }
    const obj = incoming as Record<string, unknown>;
    merged[key] = {
      title: typeof obj.title === 'string' && obj.title.length > 0 ? obj.title : fallback.title,
      grund: normalizeStringArray(obj.grund).length > 0 ? normalizeStringArray(obj.grund) : fallback.grund,
      auswirkungen: normalizeStringArray(obj.auswirkungen).length > 0 ? normalizeStringArray(obj.auswirkungen) : fallback.auswirkungen,
      massnahmen: normalizeStringArray(obj.massnahmen).length > 0 ? normalizeStringArray(obj.massnahmen) : fallback.massnahmen,
    };
  }
  return merged;
};

/**
 * Subscribe to the dealer-mode knowledge base stored in Firestore at
 * `dealer_knowledge/brennbewertung`. The hook returns the live document
 * merged with built-in defaults, so callers always see a complete dataset.
 *
 * If the document does not exist yet AND the current user has admin/dev
 * privileges, we seed it with the defaults from
 * {@link DEFAULT_BRENNBEWERTUNG_KNOWLEDGE} so Claus has something to edit.
 * Read-only roles never trigger a write.
 */
export const useBrennbewertungKnowledge = () => {
  const { user } = useAuth();
  const [knowledge, setKnowledge] = useState<BrennbewertungKnowledgeBase>(
    DEFAULT_BRENNBEWERTUNG_KNOWLEDGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canSeed =
    user?.role === 'super_admin' ||
    user?.role === 'developer' ||
    user?.role === 'admin';

  useEffect(() => {
    if (!firestoreDB) {
      setIsLoading(false);
      return;
    }

    const docRef = doc(firestoreDB, DOC_PATH[0], DOC_PATH[1]);
    const unsubscribe = onSnapshot(
      docRef,
      async (snap) => {
        if (snap.exists()) {
          setKnowledge(mergeWithDefaults(snap.data()));
          setError(null);
          setIsLoading(false);
          return;
        }

        // Document missing — seed with defaults so the editor has somewhere
        // to start. Only privileged users get to write; everyone else simply
        // sees the in-memory defaults.
        if (canSeed) {
          try {
            await setDoc(docRef, {
              ...DEFAULT_BRENNBEWERTUNG_KNOWLEDGE,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: user?.uid ?? 'system',
            });
          } catch (seedError) {
            console.warn('[Brennbewertung] Failed to seed knowledge base:', seedError);
          }
        }
        setKnowledge(DEFAULT_BRENNBEWERTUNG_KNOWLEDGE);
        setIsLoading(false);
      },
      (err) => {
        console.error('[Brennbewertung] knowledge subscription error:', err);
        setError(err.message || 'Failed to load knowledge base');
        setKnowledge(DEFAULT_BRENNBEWERTUNG_KNOWLEDGE);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [canSeed, user?.uid]);

  return { knowledge, isLoading, error };
};

/**
 * Persist edits to the knowledge base. Only callable by privileged roles —
 * Firestore rules must enforce the same restriction server-side.
 */
export const saveBrennbewertungKnowledge = async (
  next: BrennbewertungKnowledgeBase,
  editorUid?: string,
): Promise<{ success: boolean; error?: string }> => {
  if (!firestoreDB) return { success: false, error: 'Firestore not initialized' };
  try {
    const docRef = doc(firestoreDB, DOC_PATH[0], DOC_PATH[1]);
    await setDoc(
      docRef,
      {
        ...next,
        updatedAt: serverTimestamp(),
        updatedBy: editorUid ?? 'unknown',
      },
      { merge: true },
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Save failed',
    };
  }
};

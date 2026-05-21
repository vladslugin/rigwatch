import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useAuth } from './useAuth';
import {
  DEFAULT_DEALER_PROMPT_SETTINGS,
  mergeDealerPromptSettings,
  type DealerPromptSettings,
} from '../types/dealerPromptSettings';

const DOC_PATH = ['dealer_knowledge', 'prompt_settings'] as const;

/**
 * Subscribe to the globally-shared dealer prompt settings stored in Firestore
 * at `dealer_knowledge/prompt_settings`. Returned settings are always merged
 * with built-in defaults, so callers see a complete object even if the doc
 * does not exist yet.
 *
 * If the document is missing AND the current user has admin/dev privileges,
 * we seed it with defaults so editors have somewhere to start. Read-only
 * roles never trigger a write.
 */
export const useDealerPromptSettings = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<DealerPromptSettings>(DEFAULT_DEALER_PROMPT_SETTINGS);
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
          setSettings(mergeDealerPromptSettings(snap.data()));
          setError(null);
          setIsLoading(false);
          return;
        }

        if (canSeed) {
          try {
            await setDoc(docRef, {
              ...DEFAULT_DEALER_PROMPT_SETTINGS,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: user?.uid ?? 'system',
            });
          } catch (seedError) {
            console.warn('[DealerPrompt] Failed to seed prompt settings:', seedError);
          }
        }
        setSettings(DEFAULT_DEALER_PROMPT_SETTINGS);
        setIsLoading(false);
      },
      (err) => {
        console.error('[DealerPrompt] settings subscription error:', err);
        setError(err.message || 'Failed to load prompt settings');
        setSettings(DEFAULT_DEALER_PROMPT_SETTINGS);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [canSeed, user?.uid]);

  return { settings, isLoading, error };
};

/**
 * Persist edits to the dealer prompt settings. Only callable by privileged
 * roles (developer / super_admin); Firestore rules must enforce server-side.
 */
export const saveDealerPromptSettings = async (
  next: DealerPromptSettings,
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

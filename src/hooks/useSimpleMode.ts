import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';

/**
 * Hook to check if user has simple_mode enabled in Firestore
 * Returns true for simplified interface, false for advanced interface
 */
export const useSimpleMode = () => {
  const [simpleMode, setSimpleMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const loadSimpleMode = async () => {
      if (!user?.uid) {
        setSimpleMode(false);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const firebase = await import('../lib/firebase');
        const firestoreDB = firebase.firestoreDB;
        
        if (!firestoreDB) {
          console.warn('[useSimpleMode] Firestore not available, defaulting to advanced mode');
          setSimpleMode(false);
          setLoading(false);
          return;
        }

        const { doc, getDoc } = await import('firebase/firestore');
        const userDocRef = doc(firestoreDB, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const userData = userDoc.data();
          const isSimpleMode = userData?.simple_mode === true;
          setSimpleMode(isSimpleMode);
          console.log('[useSimpleMode] Simple mode:', isSimpleMode);
        } else {
          // User document doesn't exist, default to advanced mode
          setSimpleMode(false);
          console.log('[useSimpleMode] User document not found, defaulting to advanced mode');
        }

      } catch (err: any) {
        console.error('[useSimpleMode] Failed to load simple mode setting:', err);
        setError(err?.message || 'Failed to load user preferences');
        setSimpleMode(false); // Default to advanced mode on error
      } finally {
        setLoading(false);
      }
    };

    loadSimpleMode();
  }, [user?.uid]);

  /**
   * Update simple mode setting in Firestore
   */
  const setSimpleModeEnabled = async (enabled: boolean): Promise<void> => {
    if (!user?.uid) {
      throw new Error('User not authenticated');
    }

    try {
      const firebase = await import('../lib/firebase');
      const firestoreDB = firebase.firestoreDB;
      
      if (!firestoreDB) {
        throw new Error('Firestore not available');
      }

      const { doc, setDoc } = await import('firebase/firestore');
      const userDocRef = doc(firestoreDB, 'users', user.uid);
      
      await setDoc(userDocRef, { simple_mode: enabled }, { merge: true });
      setSimpleMode(enabled);
      console.log('[useSimpleMode] Simple mode updated:', enabled);

    } catch (err: any) {
      console.error('[useSimpleMode] Failed to update simple mode:', err);
      setError(err?.message || 'Failed to update user preferences');
      throw err;
    }
  };

  return {
    simpleMode,
    loading,
    error,
    setSimpleModeEnabled
  };
};

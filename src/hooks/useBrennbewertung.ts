import { useCallback, useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import {
  BRENNBEWERTUNG_KEYS,
  type BrennbewertungKey,
  type BrennbewertungSource,
  type BrennbewertungValues,
} from '../types/brennbewertung';

const DEV_OVERRIDE_KEY = 'hase-dealer-c-override';

const ZERO_VALUES: BrennbewertungValues = {
  C0: 0, C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0,
};

const clampPercent = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
};

const parseFromSnapshot = (raw: unknown): BrennbewertungValues => {
  if (!raw || typeof raw !== 'object') return { ...ZERO_VALUES };
  const obj = raw as Record<string, unknown>;
  const result = { ...ZERO_VALUES };
  for (const key of BRENNBEWERTUNG_KEYS) {
    if (key in obj) result[key] = clampPercent(obj[key]);
  }
  return result;
};

const readDevOverride = (): BrennbewertungValues | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DEV_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parseFromSnapshot(parsed);
  } catch {
    return null;
  }
};

const writeDevOverride = (values: BrennbewertungValues | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (values === null) {
      window.localStorage.removeItem(DEV_OVERRIDE_KEY);
    } else {
      window.localStorage.setItem(DEV_OVERRIDE_KEY, JSON.stringify(values));
    }
    window.dispatchEvent(new CustomEvent('brennbewertung-override-changed'));
  } catch {
    // localStorage failures are non-fatal
  }
};

export interface UseBrennbewertungResult {
  values: BrennbewertungValues;
  source: BrennbewertungSource;
  isLoading: boolean;
  /** Top-three C-keys ordered by descending value, filtered to non-zero entries. */
  topThree: BrennbewertungKey[];
  /** True iff every C-value is exactly 0 (i.e. perfect combustion). */
  isAllZero: boolean;
  /** Set or clear the dev override (developer/super-admin only — UI gates this). */
  setDevOverride: (values: BrennbewertungValues | null) => void;
  /** Whether a dev override is currently active. */
  hasDevOverride: boolean;
}

/**
 * Read C0-C6 burn-quality variables for the given device.
 *
 * Sources, in priority order:
 *   1. Local dev override (set by the developer/super-admin C-panel for
 *      testing). Persisted in localStorage so the values stay between reloads.
 *   2. RTDB `statistik_monat_tage/<deviceId>/c`. Per Claus's 2026-04-28 spec
 *      this node exists once the firmware writes it; today the node is empty
 *      on most devices — the hook simply reports zeros until that ships.
 *
 * The hook also classifies the result so the UI can switch between the
 * "alles in Ordnung" and "könnte besser brennen" layouts without recomputing
 * the same thing in every consumer.
 */
export const useBrennbewertung = (deviceId: string | null): UseBrennbewertungResult => {
  const [firebaseValues, setFirebaseValues] = useState<BrennbewertungValues | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [override, setOverrideState] = useState<BrennbewertungValues | null>(() => readDevOverride());

  // Pick up override changes triggered from other tabs / panels.
  useEffect(() => {
    const handler = () => setOverrideState(readDevOverride());
    if (typeof window === 'undefined') return;
    window.addEventListener('brennbewertung-override-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('brennbewertung-override-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  useEffect(() => {
    if (!deviceId || !realtimeDB) {
      setFirebaseValues(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const cRef = ref(realtimeDB, `statistik_monat_tage/${deviceId}/c`);
    const unsubscribe = onValue(
      cRef,
      (snap) => {
        if (snap.exists()) {
          setFirebaseValues(parseFromSnapshot(snap.val()));
        } else {
          setFirebaseValues(null);
        }
        setIsLoading(false);
      },
      (error) => {
        console.warn('[Brennbewertung] subscription error:', error);
        setFirebaseValues(null);
        setIsLoading(false);
      },
    );
    return () => unsubscribe();
  }, [deviceId]);

  const setDevOverride = useCallback((values: BrennbewertungValues | null) => {
    writeDevOverride(values);
    setOverrideState(values);
  }, []);

  return useMemo<UseBrennbewertungResult>(() => {
    let values: BrennbewertungValues;
    let source: BrennbewertungSource;

    if (override) {
      values = override;
      source = 'devOverride';
    } else if (firebaseValues) {
      values = firebaseValues;
      source = 'firebase';
    } else {
      values = { ...ZERO_VALUES };
      source = 'none';
    }

    const topThree = (Object.keys(values) as BrennbewertungKey[])
      .filter((key) => values[key] > 0)
      .sort((a, b) => values[b] - values[a])
      .slice(0, 3);

    const isAllZero = BRENNBEWERTUNG_KEYS.every((key) => values[key] === 0);

    return {
      values,
      source,
      isLoading,
      topThree,
      isAllZero,
      setDevOverride,
      hasDevOverride: override !== null,
    };
  }, [override, firebaseValues, isLoading, setDevOverride]);
};

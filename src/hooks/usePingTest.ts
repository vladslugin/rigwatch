import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, get, set } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';

export type PingStatus = 'idle' | 'testing' | 'online' | 'offline';

export interface PingTestState {
  status: PingStatus;
  responseTimeMs: number | null;
  error: string | null;
}

/**
 * Active connectivity check that proves the controller is currently listening.
 *
 * Mechanism (matches the existing logic in ConnectionBlock.tsx / RigInfoModal.tsx):
 *   1. Read `konstant_app/<id>/c` — the controller's command-counter.
 *   2. Write three random pings into `konstant/<id>/p`, 2 s apart.
 *   3. Wait another 3 s, then re-read the counter.
 *   4. Counter changed → device is online; unchanged → offline.
 *
 * The whole exchange takes ~9–11 s. We use this rather than passively comparing
 * `tsfc` because the controller's heartbeat cadence is not strictly fixed, so
 * a passive freshness check produces false offlines for slow rigs.
 *
 * The hook auto-cancels in-flight checks when the device changes or the
 * component unmounts (via a generation token), so stale results never overwrite
 * the current state.
 */
export const usePingTest = (deviceId: string | null) => {
  const [state, setState] = useState<PingTestState>({
    status: 'idle',
    responseTimeMs: null,
    error: null,
  });

  // Generation counter — incremented on every new ping or device change so any
  // pending async work knows whether its result is still wanted.
  const generationRef = useRef(0);

  // Reset state whenever the dealer switches to a different device.
  useEffect(() => {
    generationRef.current += 1;
    setState({ status: 'idle', responseTimeMs: null, error: null });
  }, [deviceId]);

  // Cancel any in-flight ping when the component unmounts.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
    };
  }, []);

  const ping = useCallback(async () => {
    if (!deviceId || !realtimeDB) {
      setState({ status: 'offline', responseTimeMs: null, error: 'No device' });
      return;
    }

    const myGeneration = ++generationRef.current;
    const isCurrent = () => generationRef.current === myGeneration;

    setState({ status: 'testing', responseTimeMs: null, error: null });

    try {
      const counterRef = ref(realtimeDB, `konstant_app/${deviceId}/c`);
      const pingRef = ref(realtimeDB, `konstant/${deviceId}/p`);

      const initialSnap = await get(counterRef);
      if (!isCurrent()) return;
      const initialC = typeof initialSnap.val() === 'number' ? Number(initialSnap.val()) : 0;

      const startTime = Date.now();

      // Fire three pings, 2 s apart. Random offsets keep us out of any
      // potential equality-based de-duping on the controller side.
      for (let i = 0; i < 3; i++) {
        const value = Math.floor(Math.random() * 1000) + (i + 1) * 1000;
        await set(pingRef, value);
        if (!isCurrent()) return;
        if (i < 2) {
          await new Promise((r) => setTimeout(r, 2000));
          if (!isCurrent()) return;
        }
      }

      // Give the controller time to process the last ping.
      await new Promise((r) => setTimeout(r, 3000));
      if (!isCurrent()) return;

      const finalSnap = await get(counterRef);
      if (!isCurrent()) return;
      const finalC = typeof finalSnap.val() === 'number' ? Number(finalSnap.val()) : 0;

      const responseTimeMs = Date.now() - startTime;
      const isOnline = finalC !== initialC;

      setState({
        status: isOnline ? 'online' : 'offline',
        responseTimeMs: isOnline ? responseTimeMs : null,
        error: null,
      });
    } catch (error) {
      if (!isCurrent()) return;
      setState({
        status: 'offline',
        responseTimeMs: null,
        error: error instanceof Error ? error.message : 'Ping failed',
      });
    }
  }, [deviceId]);

  return { ...state, ping };
};

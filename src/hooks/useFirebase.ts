import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, onValue, set, update, get } from 'firebase/database';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { realtimeDB, firestoreDB } from '../lib/firebase';
import { useRigStore, useNotificationHelpers } from '../store/useRigStore';
import { useAuth } from './useAuth';
import { queueSetCommand, queueCommand, commandQueue } from '../utils/commandQueue';
import type { 
  RigData, 
  DeviceConfig, 
  DeviceMetadata, 
  ParameterMetadata,
  HistoricalLog 
} from '../types';
// import { getParameterDataType } from '../utils/parameterTypes';

// Helper function to clear device-specific caches
const clearDeviceCaches = () => {
  try {
    const preserveKeys = new Set([
      'rigwatch-user-preferences', // global user prefs
      'rigwatch-local-settings',   // visual settings (colors, positions, legend)
      'rigwatch-font-family',         // UI font
      'rigwatch-decimal-separator',   // UI decimal separator
      'rigwatch-theme-config',        // theme (mode + neo-brutalism)
      'rigops_script_library_v1',   // .rigops editor library
    ]);

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isRigopsKey = key.startsWith('rigwatch-');
      const isDeviceParamKey = key.includes('device') || key.includes('parameter');
      const isPreserved = preserveKeys.has(key);

      // Remove only device/parameter caches, keep visual/user prefs
      if ((isRigopsKey || isDeviceParamKey) && !isPreserved) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      const isRigopsKey = key.startsWith('rigwatch-');
      const isDeviceParamKey = key.includes('device') || key.includes('parameter');
      const isPreserved =
        key === 'rigwatch-user-preferences' ||
        key === 'rigwatch-session-simplification-mode';

      if ((isRigopsKey || isDeviceParamKey) && !isPreserved) {
        sessionKeysToRemove.push(key);
      }
    }
    sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));
  } catch (error) {
    console.warn('[Firebase] Error clearing caches:', error);
  }
};

export const useFirebaseConnection = () => {
  const deviceId = useRigStore(state => state.deviceId);
  const connectionStatus = useRigStore(state => state.connectionStatus);
  // REMOVED: isHistoricalMode - no longer needed, historical mode is handled by chart component
  const { user } = useAuth();
  
  const setDeviceId = useRigStore(state => state.setDeviceId);
  const setConnectionStatus = useRigStore(state => state.setConnectionStatus);
  const setDeviceExistence = useRigStore(state => state.setDeviceExistence);
	const updateCurrentData = useRigStore(state => state.updateCurrentData);
	
  const updateDeviceConfig = useRigStore(state => state.updateDeviceConfig);
  const updateDeviceMetadata = useRigStore(state => state.updateDeviceMetadata);
  const setErrorData = useRigStore(state => state.setErrorData);
  
  const { showError, showSuccess, showInfo } = useNotificationHelpers();
  const VERBOSE_FIREBASE_LOGS = false;

  // Generate stable client ID per browser tab (session)
  const getOrCreateSessionClientId = () => {
    try {
      const existing = sessionStorage.getItem('rigops_client_id');
      if (existing && existing.trim()) return existing;
      const id = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('rigops_client_id', id);
      return id;
    } catch {
      // Fallback when sessionStorage is not available
      return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
  };
  const clientId = useRef<string>(getOrCreateSessionClientId());

  const handleConnectionError = useCallback((error: unknown) => {
    console.error('[Firebase] Connection error:', error);
    setConnectionStatus('offline');
    showError('Connection lost. Check your network.');
  }, [setConnectionStatus, showError]);

  const addActiveClient = useCallback(async (deviceId: string, simpleMode: boolean = false) => {
    if (!realtimeDB) return false;
    try {
      // Check if user has forceSimpleMode enabled - it overrides local settings
      const effectiveSimpleMode = user?.forceSimpleMode === true ? true : simpleMode;
      
      const clientInfo = {
        clientId: clientId.current,
        name: (user?.displayName || user?.email || 'Unknown')?.toString().substring(0, 100),
        timestamp: Date.now(),
        userAgent: navigator.userAgent.substring(0, 100),
        connected_at: new Date().toISOString(),
        simple_mode: effectiveSimpleMode
      };

      const clientRef = ref(realtimeDB, `konstant/${deviceId}/active_clients/${clientId.current}`);
      await set(clientRef, clientInfo);
      
      const { onDisconnect } = await import('firebase/database');
      const disconnectRef = onDisconnect(clientRef);
      await disconnectRef.remove();
      
      return true;
    } catch (error) {
      console.warn('[Firebase] Failed to add active client:', error);
      return false;
    }
  }, [user?.displayName, user?.email, user?.forceSimpleMode]);

  const removeActiveClient = useCallback(async (deviceId: string) => {
    if (!realtimeDB) return;
    try {
      const clientRef = ref(realtimeDB, `konstant/${deviceId}/active_clients/${clientId.current}`);
      await set(clientRef, null);
    } catch (error) {
      console.warn('[Firebase] Failed to remove active client:', error);
    }
  }, []);

  const refreshActiveClientInfo = useCallback(async (deviceId: string) => {
    if (!realtimeDB) return false;
    try {
      const displayName = (user?.displayName || user?.email || '').toString().substring(0, 100);
      if (!displayName || displayName.trim() === '' || displayName === 'Unknown') {
        return false;
      }
      const clientRef = ref(realtimeDB, `konstant/${deviceId}/active_clients/${clientId.current}`);
      
      // Get current client data to preserve simple_mode if not forced
      const snapshot = await get(clientRef);
      const currentData = snapshot.exists() ? snapshot.val() : {};
      
      // Apply forceSimpleMode if set, otherwise keep current simple_mode
      const simple_mode = user?.forceSimpleMode === true ? true : (currentData.simple_mode ?? false);
      
      await update(clientRef, {
        name: displayName,
        timestamp: Date.now(),
        userAgent: navigator.userAgent.substring(0, 100),
        simple_mode
      });
      return true;
    } catch (error) {
      console.warn('[Firebase] Failed to refresh active client info:', error);
      return false;
    }
  }, [user?.displayName, user?.email, user?.forceSimpleMode]);

  
  const listenersRef = useRef<{
    temporaer?: () => void;
    konstant?: () => void;
    konstantApp?: () => void;
    activeClients?: () => void; // for Simple Mode heartbeat leader election
  }>({});
  const kRecalcTimeoutRef = useRef<number | undefined>(undefined);
  const lastKFromDbRef = useRef<number | null>(null);
  const lastKWrittenRef = useRef<number | null>(null);
  const lastKManualRef = useRef<boolean | null>(null);
  const allowKWriteOnceRef = useRef<boolean>(false);
  const zeroClientsTimeoutRef = useRef<number | null>(null);
  const isCurrentDeviceContext = useCallback((targetDeviceId: string) => {
    return useRigStore.getState().deviceId === targetDeviceId;
  }, []);

  const scheduleKRecalc = useCallback(async (deviceId: string) => {
    try {
      if (!realtimeDB) return;
      if (kRecalcTimeoutRef.current !== undefined) {
        window.clearTimeout(kRecalcTimeoutRef.current);
        kRecalcTimeoutRef.current = undefined;
      }
      kRecalcTimeoutRef.current = window.setTimeout(async () => {
        try {
          // Ignore stale callbacks from older device listeners
          if (!isCurrentDeviceContext(deviceId)) return;

          // If external has changed k (doesn't match our last write) and we have no explicit user intent,
          // respect external value and skip write
          if (!allowKWriteOnceRef.current && lastKFromDbRef.current !== null && lastKWrittenRef.current !== null) {
            if (lastKFromDbRef.current !== lastKWrittenRef.current) {
              if (VERBOSE_FIREBASE_LOGS) console.log('[Firebase] Detected external k change; skipping auto write');
              return;
            }
          }

          // Respect manual override from console: if k_freeze is true, do not change k
          try {
            const kFreezeSnap = await get(ref(realtimeDB!, `konstant/${deviceId}/k_freeze`));
            let isFrozen = false;
            if (kFreezeSnap.exists()) {
              const raw = kFreezeSnap.val();
              if (typeof raw === 'boolean') isFrozen = raw;
              else if (typeof raw === 'number') isFrozen = raw !== 0;
              else if (typeof raw === 'string') {
                const s = raw.trim().toLowerCase();
                isFrozen = (s === 'true' || s === '1' || s === 'yes' || s === 'ja');
              }
            }
            if (isFrozen) {
              if (VERBOSE_FIREBASE_LOGS) console.log('[Firebase] k_freeze is active; skipping k recalculation');
              return;
            }
          } catch {}

          // Get active simple clients count
          const activeClientsRef = ref(realtimeDB!, `konstant/${deviceId}/active_clients`);
          const acSnap = await get(activeClientsRef);
          const clients = acSnap.exists() ? acSnap.val() : {};
          const entries = Object.entries(clients) as Array<[string, any]>;
          const simpleCount = entries.filter(([, v]) => v?.simple_mode === true).length;

          // Get manual offset
          let manualFlag = false;
          try {
            const kManualSnap = await get(ref(realtimeDB!, `konstant/${deviceId}/k_manual`));
            if (kManualSnap.exists()) {
              const raw = kManualSnap.val();
              if (typeof raw === 'boolean') {
                manualFlag = raw;
              } else if (typeof raw === 'number') {
                manualFlag = raw !== 0;
              } else if (typeof raw === 'string') {
                const s = raw.trim().toLowerCase();
                manualFlag = (s === 'true' || s === '1' || s === 'yes' || s === 'ja');
              } else {
                manualFlag = false;
              }
            }
          } catch {
            manualFlag = false;
          }
          const manual = manualFlag ? 1 : 0;

          // Update k
          const newK = simpleCount + manual;
          await set(ref(realtimeDB!, `konstant/${deviceId}/k`), newK);
          lastKWrittenRef.current = newK;
          allowKWriteOnceRef.current = false;
        } catch (error) {
          console.warn('[Firebase] Failed to recalc k (scheduled):', error);
        } finally {
          if (kRecalcTimeoutRef.current !== undefined) {
            window.clearTimeout(kRecalcTimeoutRef.current);
            kRecalcTimeoutRef.current = undefined;
          }
        }
      }, 500);
    } catch (error) {
      console.warn('[Firebase] scheduleKRecalc failed:', error);
    }
  }, [isCurrentDeviceContext]);

  // Ensure active client presence (used by UI actions to recover from missed registration)
  const ensureActiveClientPresent = useCallback(async (deviceId: string): Promise<boolean> => {
    try {
      if (!realtimeDB) return false;
      const clientRef = ref(realtimeDB, `konstant/${deviceId}/active_clients/${clientId.current}`);
      const snap = await get(clientRef);
      if (snap.exists()) return true;
      // Fallback to standard registration with onDisconnect cleanup
      return await addActiveClient(deviceId, /*simpleMode*/ false);
    } catch (e) {
      console.warn('[Firebase] ensureActiveClientPresent failed:', e);
      return false;
    }
  }, [addActiveClient]);

  const fetchInitialData = useCallback(async (deviceId: string) => {
    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      const appDataRef = ref(realtimeDB, `konstant_app/${deviceId}`);
      const konstantRef = ref(realtimeDB, `konstant/${deviceId}`);
      const temporaerRef = ref(realtimeDB, `temporaer/${deviceId}`);

      const [appSnapshot, konstantSnapshot, temporaerSnapshot] = await Promise.all([
        get(appDataRef).catch(() => null),
        get(konstantRef).catch(() => null),
        get(temporaerRef).catch(() => null),
      ]);

      // Ignore stale initial fetch if user already switched to another device
      if (!isCurrentDeviceContext(deviceId)) return;

      if (appSnapshot && appSnapshot.exists()) {
        setDeviceExistence('exists');
        updateDeviceMetadata(appSnapshot.val());
      }

      if (konstantSnapshot && konstantSnapshot.exists()) {
        updateDeviceConfig(konstantSnapshot.val());
      }

      if (temporaerSnapshot && temporaerSnapshot.exists()) {
        const initialData = temporaerSnapshot.val() as RigData;
        updateCurrentData(initialData, undefined, true);
      }

    } catch (error) {
      console.error('[Firebase] Initial data fetch failed:', error);
      handleConnectionError(error);
    }
  }, [updateDeviceMetadata, updateDeviceConfig, updateCurrentData, handleConnectionError, isCurrentDeviceContext]);

  const setupRealtimeListeners = useCallback((deviceId: string) => {
    if (!realtimeDB) {
      console.error('[Firebase] Cannot setup listeners - database not initialized');
      return;
    }

    const temporaerRef = ref(realtimeDB!, `temporaer/${deviceId}`);

    const temporaerUnsubscribe = onValue(temporaerRef, (snapshot) => {
      if (!isCurrentDeviceContext(deviceId)) return;
      const data = snapshot.val() as RigData | null;
      // Handle full deletion of /temporaer/{deviceId} (snapshot null):
      // clear UI state immediately so cards do not linger until page refresh.
      if (!data) {
        try {
          const { discoveredParameters, setDiscoveredParameters } = useRigStore.getState();
          if (discoveredParameters.length > 0) {
            setDiscoveredParameters([]);
          }
        } catch (e) {
          console.warn('[Firebase] Failed to clear discovered parameters after empty snapshot:', e);
        }
        updateCurrentData({});
        return;
      }

      // Keep discoveredParameters in sync with actual data keys.
      // We only remove parameters when the entire node is deleted (data === null, handled above).
      // Removing on every partial snapshot causes cards to flash-disappear and reappear one-by-one
      // because each re-fetch from Firestore completes at a different time.
      updateCurrentData(data);
    }, (error) => {
      console.error('[Firebase] Temporaer listener error:', error);
      handleConnectionError(error);
    });
    listenersRef.current.temporaer = temporaerUnsubscribe;

    const konstantRef = ref(realtimeDB!, `konstant/${deviceId}`);
    const konstantUnsubscribe = onValue(konstantRef, (snapshot) => {
      if (!isCurrentDeviceContext(deviceId)) return;
      const config = snapshot.val() as DeviceConfig | null;
      if (config) {
        updateDeviceConfig(config);
        // Recalculate k when konstant changes (e.g., k_manual updates) with debounce
        void scheduleKRecalc(deviceId);
        // Track k from DB to detect external changes
        try {
          const rawK = (config as any)?.k;
          const kNum = typeof rawK === 'number' ? rawK : Number.isFinite(Number(rawK)) ? Number(rawK) : null;
          if (kNum !== null && !Number.isNaN(kNum)) {
            lastKFromDbRef.current = kNum;
          }
        } catch {}
        // Detect local manual toggle to allow one write
        try {
          const rawManual = (config as any)?.k_manual;
          let manualBool = false;
          if (typeof rawManual === 'boolean') manualBool = rawManual;
          else if (typeof rawManual === 'number') manualBool = rawManual !== 0;
          else if (typeof rawManual === 'string') {
            const s = rawManual.trim().toLowerCase();
            manualBool = (s === 'true' || s === '1' || s === 'yes' || s === 'ja');
          }
          if (lastKManualRef.current === null) {
            lastKManualRef.current = manualBool;
          } else if (lastKManualRef.current !== manualBool) {
            allowKWriteOnceRef.current = true;
            lastKManualRef.current = manualBool;
          }
        } catch {}
      }
    }, (error) => {
      console.error('[Firebase] Konstant listener error:', error);
      handleConnectionError(error);
    });
    listenersRef.current.konstant = konstantUnsubscribe;

    const konstantAppRef = ref(realtimeDB!, `konstant_app/${deviceId}`);
    const konstantAppUnsubscribe = onValue(konstantAppRef, (snapshot) => {
      if (!isCurrentDeviceContext(deviceId)) return;
      const raw = snapshot.val() as (DeviceMetadata & { ecode?: number; ecode2?: number }) | null;
      if (raw) {
        updateDeviceMetadata(raw);
        // Extract error codes and push to store (single source of truth)
        const ecode = typeof raw.ecode === 'number' ? raw.ecode : undefined;
        const ecode2 = typeof raw.ecode2 === 'number' ? raw.ecode2 : undefined;
        setErrorData({ ecode, ecode2 });
      }
    }, (error) => {
      console.error('[Firebase] KonstantApp listener error:', error);
      handleConnectionError(error);
    });
    listenersRef.current.konstantApp = konstantAppUnsubscribe;

    const activeClientsRef = ref(realtimeDB!, `konstant/${deviceId}/active_clients`);
    const activeClientsUnsubscribe = onValue(activeClientsRef, (snapshot) => {
      try {
        if (!isCurrentDeviceContext(deviceId)) return;
        const clientsObj = snapshot.exists() ? (snapshot.val() || {}) : {};
        const clientCount = Object.keys(clientsObj).length;

        // Clear any pending zero-clients action if someone is active
        if (clientCount > 0 && zeroClientsTimeoutRef.current !== null) {
          window.clearTimeout(zeroClientsTimeoutRef.current);
          zeroClientsTimeoutRef.current = null;
        }

        // If we appear to have zero active clients, wait before forcing d=false.
        // Browsers in the background can throttle heartbeats; we avoid false negatives.
        if (clientCount === 0) {
          if (zeroClientsTimeoutRef.current === null) {
            zeroClientsTimeoutRef.current = window.setTimeout(async () => {
              zeroClientsTimeoutRef.current = null;
              try {
                if (!isCurrentDeviceContext(deviceId)) return;
                if (!realtimeDB) return;
                // Skip if tab is hidden to avoid toggling while throttled
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

                const latestSnap = await get(activeClientsRef);
                const latestClients = latestSnap.exists() ? (latestSnap.val() || {}) : {};
                const latestCount = Object.keys(latestClients).length;
                if (latestCount === 0) {
                  await set(ref(realtimeDB!, `konstant/${deviceId}/d`), false);
                  await set(ref(realtimeDB!, `konstant/${deviceId}/k_manual`), false);
                }
              } catch (e) {
                console.warn('[Firebase] Failed to enforce zero-client state (delayed):', e);
              }
            }, 45000); // 45s grace to survive background throttling
          }
          return;
        }

        // Schedule k recalculation after debounce delay
        void scheduleKRecalc(deviceId);
      } catch (error) {
        console.warn('[Firebase] Failed to auto-recalc device status:', error);
      }
    }, (error) => {
      console.error('[Firebase] Active clients listener error:', error);
    });
    listenersRef.current.activeClients = activeClientsUnsubscribe;

    const heartbeatKey = `__rigops_heartbeat_${deviceId}`;
    const trigValueKey = `__rigops_trig_value_${deviceId}`;
    const existingHeartbeat = (window as any)[heartbeatKey];
    
    if (!existingHeartbeat) {
      (window as any)[trigValueKey] = 0;
      
      (async () => {
        try {
          if (!realtimeDB) return;
          const trigRef = ref(realtimeDB as any, `temporaer/${deviceId}/TRIG1`);
          await set(trigRef, 1);
          (window as any)[trigValueKey] = 1;
        } catch (e) {
          console.warn('[Firebase] TRIG1 initial heartbeat failed:', e);
        }
      })();
      
      const heartbeatHandle = window.setInterval(async () => {
        try {
          // Stop stale heartbeat when device context changed
          if (!isCurrentDeviceContext(deviceId)) {
            window.clearInterval(heartbeatHandle);
            (window as any)[heartbeatKey] = undefined;
            (window as any)[trigValueKey] = undefined;
            return;
          }
          if (!realtimeDB) return;
          
          const activeClientsRef = ref(realtimeDB as any, `konstant/${deviceId}/active_clients`);
          const snapshot = await get(activeClientsRef);
          const clients = snapshot.exists() ? snapshot.val() : {};
          const clientCount = Object.keys(clients).length;
          
          if (clientCount === 0) return;
          
          const trigRef = ref(realtimeDB as any, `temporaer/${deviceId}/TRIG1`);
          const currentValue = (window as any)[trigValueKey] || 0;
          const newValue = currentValue === 0 ? 1 : 0;
          await set(trigRef, newValue);
          (window as any)[trigValueKey] = newValue;
        } catch (e) {
          console.warn('[Firebase] TRIG1 heartbeat failed:', e);
        }
      }, 5000);
      
      (window as any)[heartbeatKey] = heartbeatHandle;
    }

  }, [updateDeviceConfig, updateDeviceMetadata, handleConnectionError, isCurrentDeviceContext]);

  // Track connection attempts to prevent duplicate k increments
  const connectionAttemptsRef = useRef<Map<string, number>>(new Map());
  
  const connect = useCallback(async (newDeviceId: string) => {
    if (!newDeviceId?.trim()) {
      showError('Please enter a Rig ID');
      return false;
    }

    try {
      const targetId = newDeviceId.trim();
      
      // Check if Simple Mode is enabled (per-tab session override first)
      let isSimpleMode = (() => {
        try {
          const sessionVal = sessionStorage.getItem('rigwatch-session-simplification-mode');
          if (sessionVal !== null) {
            const s = sessionVal.trim().toLowerCase();
            return (s === 'true' || s === '1' || s === 'yes' || s === 'ja');
          }
          const prefs = localStorage.getItem('rigwatch-user-preferences');
          if (prefs) {
            const parsed = JSON.parse(prefs);
            return parsed.simplificationMode === true;
          }
        } catch (error) {
          console.error('[Firebase] Error parsing prefs:', error);
        }
        return false;
      })();
      if (user?.forceSimpleMode === true) {
        isSimpleMode = true;
      }

      console.log(`[Firebase] Connecting in ${isSimpleMode ? 'SIMPLE' : 'NORMAL'} mode to ${targetId}`);
      console.log(`[Firebase] Current state: deviceId=${deviceId}, connectionStatus=${connectionStatus}`);

      // STRICT: Prevent duplicate connections to the same device within the same session
      // Skip check if we're switching devices (deviceId should be null after cleanup)
      if (deviceId && (connectionStatus === 'online' || connectionStatus === 'connecting') && deviceId === targetId) {
        console.log(`[Firebase] ⚠️ Skipping connect: already ${connectionStatus} to ${targetId}`);
        // Still attempt to refresh client info (e.g., set proper name)
        try { await refreshActiveClientInfo(targetId); } catch {}
        return true;
      }

      // Additional protection: Prevent rapid duplicate connection attempts (ONLY in Simple Mode)
      if (isSimpleMode) {
        const now = Date.now();
        const lastAttempt = connectionAttemptsRef.current.get(targetId) || 0;
        if (now - lastAttempt < 1000) { // Within 1 second
          console.log(`[Firebase] ⚠️ Simple Mode: Skipping duplicate connection attempt to ${targetId} (too soon)`);
          return false;
        }
        connectionAttemptsRef.current.set(targetId, now);
      }

      // CRITICAL FIX: If switching devices, properly disconnect from old device first
      if (deviceId && deviceId !== targetId && (connectionStatus === 'online' || connectionStatus === 'connecting')) {
        console.log(`[Firebase]  Switching from device ${deviceId} to ${targetId}, disconnecting old device first...`);

        // Clean up old device
        try {
          if (!realtimeDB) return;

          await removeActiveClient(deviceId);
          // Listener will automatically recalculate d and k
        } catch (error) {
          console.warn('[Firebase] Failed to cleanup old device:', error);
        }

        // Clean up old listeners
        Object.values(listenersRef.current).forEach(unsubscribe => unsubscribe?.());
        listenersRef.current = {};

        // Clear TRIG1 heartbeat for old device
        const oldHeartbeatKey = `__rigops_heartbeat_${deviceId}`;
        const oldTrigValueKey = `__rigops_trig_value_${deviceId}`;
        const oldHeartbeat = (window as any)[oldHeartbeatKey];
        if (oldHeartbeat) {
          window.clearInterval(oldHeartbeat);
          (window as any)[oldHeartbeatKey] = undefined;
          (window as any)[oldTrigValueKey] = undefined;
          console.log('[Firebase] 🫀 TRIG1 heartbeat stopped for old device');
        }

        // Complete cleanup to prevent mixing data from different devices
        const { clearAllState } = useRigStore.getState();
        clearAllState();

        // Clear browser caches that might contain device-specific data
        clearDeviceCaches();

        console.log(`[Firebase] ✅ Old device completely cleaned up, proceeding with new connection`);
      }

      setConnectionStatus('connecting');
      
      if (!realtimeDB || !firestoreDB) {
        throw new Error('Firebase services not initialized');
      }

      // Clean up previous listeners (safety check)
      Object.values(listenersRef.current).forEach(unsubscribe => unsubscribe?.());
      listenersRef.current = {};

      // Existence check BEFORE wiring listeners
      try {
        const appRef = ref(realtimeDB, `konstant_app/${targetId}`);
        const konstRef = ref(realtimeDB, `konstant/${targetId}`);
        const tempRef = ref(realtimeDB, `temporaer/${targetId}`);

        const [appSnap, konstSnap, tempSnap] = await Promise.all([
          get(appRef).catch(() => null),
          get(konstRef).catch(() => null),
          get(tempRef).catch(() => null),
        ]);

        const exists = Boolean((appSnap && appSnap.exists()) || (konstSnap && konstSnap.exists()) || (tempSnap && tempSnap.exists()));
        if (!exists) {
          // Set attempted deviceId to allow UI to reference it
          setDeviceId(targetId);
          setDeviceExistence('not_found');
          setConnectionStatus('offline');
          console.warn(`[Firebase] ❌ Device not found: ${targetId}`);
          // Optional: show a toast, UI will also render a dedicated panel
          try {
            const { default: i18n } = await import('../i18n');
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            showError(i18n.t('app.unableToConnect', { id: targetId }) as unknown as string);
          } catch {
            showError(`Device not found: ${targetId}`);
          }
          return false;
        }
        console.log(`[Firebase] ✅ Device ${targetId} exists, proceeding with connection`);
        setDeviceExistence('exists');
      } catch (existErr) {
        console.warn('[Firebase] Device existence check failed:', existErr);
        // Proceed anyway; fetchInitialData will attempt to set existence flags
      }

      // Setup new listeners
      setupRealtimeListeners(targetId);
      setDeviceId(targetId);
      
      try {
        await fetchInitialData(targetId);
      } catch (error) {
        console.warn('[Firebase] Initial data fetch failed:', error);
        handleConnectionError(error);
        return false;
      }

      // Removed pre-installation logic for All Values and App Only-Werte

      // Multi-user support: Add this client to active clients list
      try {
        // Add client with simple_mode flag - listener will automatically recalculate d and k
        await addActiveClient(targetId, isSimpleMode);

        console.log(`[Firebase] ${isSimpleMode ? '📱 Simple Mode' : '👥 Normal Mode'}: Multi-user connection established for device ${targetId}`);

        // Try to immediately refresh client info with resolved user data (if available)
        try { await refreshActiveClientInfo(targetId); } catch {}
      } catch (error) {
        console.warn('[Firebase] Failed to setup multi-user connection:', error);
        // Don't fail connection if this fails, just log warning
      }
      
      setConnectionStatus('online');
      console.log(`[Firebase] ✅ Successfully connected to device ${targetId}`);
      showSuccess(`Connected to device ${targetId}`);
      return true;

    } catch (error) {
      console.error('[Firebase] Connection failed:', error);
      handleConnectionError(error);
      return false;
    }
  }, [setConnectionStatus, showError, showSuccess, setDeviceId, handleConnectionError, fetchInitialData, setupRealtimeListeners, addActiveClient, removeActiveClient, deviceId, connectionStatus, refreshActiveClientInfo]);

  // When auth user resolves later OR connection status changes OR forceSimpleMode changes, refresh name in active_clients
  useEffect(() => {
    const currentDeviceId = useRigStore.getState().deviceId;
    if (!currentDeviceId) return;
    // Refresh ONLY when fully online to avoid racing with addActiveClient()
    if (connectionStatus === 'online') {
      refreshActiveClientInfo(currentDeviceId);
    }
  }, [user?.displayName, user?.email, user?.forceSimpleMode, connectionStatus, refreshActiveClientInfo]);

  const disconnect = useCallback(async () => {
    const currentDeviceId = deviceId;

    // Multi-user support: Remove this client - listener will automatically recalculate d and k
    if (currentDeviceId && realtimeDB) {
      try {
        // CRITICAL FIX: Check if this is the last client BEFORE removing it
        const activeClientsRef = ref(realtimeDB, `konstant/${currentDeviceId}/active_clients`);
        const snapshot = await get(activeClientsRef);
        const currentClientCount = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;

        // Only clear heartbeat if this is the last client
        const isLastClient = currentClientCount <= 1;

        await removeActiveClient(currentDeviceId);

        console.log(`[Firebase] 👋 Disconnected: client ${clientId.current} removed (${isLastClient ? 'last client' : 'clients remaining: ' + (currentClientCount - 1)})`);

        // Clear TRIG1 heartbeat ONLY if this was the last client
        if (isLastClient) {
          const heartbeatKey = `__rigops_heartbeat_${currentDeviceId}`;
          const trigValueKey = `__rigops_trig_value_${currentDeviceId}`;
          const heartbeatHandle = (window as any)[heartbeatKey];
          if (heartbeatHandle) {
            window.clearInterval(heartbeatHandle);
            (window as any)[heartbeatKey] = undefined;
            (window as any)[trigValueKey] = undefined;
            console.log('[Firebase] 🫀 TRIG1 heartbeat stopped (last client disconnected)');
          }
        }
      } catch (error) {
        console.warn('[Firebase] Failed to handle multi-user disconnect:', error);
      }
    }
    
    Object.values(listenersRef.current).forEach(unsubscribe => unsubscribe?.());
    listenersRef.current = {};

    // Clear pending zero-clients timer if any
    if (zeroClientsTimeoutRef.current !== null) {
      window.clearTimeout(zeroClientsTimeoutRef.current);
      zeroClientsTimeoutRef.current = null;
    }

    // throttledUpdateRef.current.cancel?.(); // REMOVED: no longer using throttle
    
    setDeviceId(null);
    showInfo('Disconnected from device');
  }, [deviceId, setDeviceId, showInfo, removeActiveClient]);



  // Handle ONLY real page close/unload (NOT tab switching)
  useEffect(() => {
    const handleBeforeUnload = async () => {
      const currentDeviceId = useRigStore.getState().deviceId;
      if (!currentDeviceId || !realtimeDB) return;

      try {
        // Check if Simple Mode was enabled
        const wasSimpleMode = (() => {
          try {
            const prefs = localStorage.getItem('rigwatch-user-preferences');
            if (prefs) {
              const parsed = JSON.parse(prefs);
              return parsed.simplificationMode === true;
            }
          } catch {}
          return false;
        })();

        console.log(`[Firebase]  Page unload detected for ${currentDeviceId} (Simple Mode: ${wasSimpleMode})`);

        // Remove this client from active_clients - listener will automatically recalculate d and k
        const clientRef = ref(realtimeDB, `konstant/${currentDeviceId}/active_clients/${clientId.current}`);
        await set(clientRef, null);

        console.log(`[Firebase] 👋 Page unload: client ${clientId.current} removed`);
      } catch (error) {
        console.warn('[Firebase] Failed to handle multi-user page unload:', error);
      }
    };

    // REMOVED visibilityChange - don't set d=false for tab switching!
    // d=true should stay when user just switches tabs or minimizes window
    // d=false only for: manual disconnect, page close, or connection loss

    // Add event listeners - ONLY beforeunload for real page close
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      Object.values(listenersRef.current).forEach(unsubscribe => unsubscribe?.());
      if (zeroClientsTimeoutRef.current !== null) {
        window.clearTimeout(zeroClientsTimeoutRef.current);
        zeroClientsTimeoutRef.current = null;
      }
      // throttledUpdateRef.current.cancel?.(); // REMOVED: no longer using throttle
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run ONCE on mount, never re-run

  // React to in-session changes of simplificationMode and update active_clients + recalc d/k
  useEffect(() => {
    const handler = async (e: Event) => {
      const evt = e as CustomEvent;
      if (!evt.detail) return;
      const currentDeviceId = useRigStore.getState().deviceId;
      if (!currentDeviceId || !realtimeDB) return;
      try {
        // Handle simplificationMode -> update active_clients simple_mode
        if (typeof evt.detail.simplificationMode !== 'undefined') {
          // If user has forceSimpleMode enabled, ignore local setting changes
          if (user?.forceSimpleMode === true) {
            console.log(`[Firebase] Ignoring simplificationMode change - user has forceSimpleMode enabled`);
            return;
          }

          const enabled = Boolean(evt.detail.simplificationMode);
          const clientRef = ref(realtimeDB, `konstant/${currentDeviceId}/active_clients/${clientId.current}`);
          console.log(`[Firebase] Updating simple_mode in active_clients for ${clientId.current} to ${enabled}`);

          // First get current client data, then update it
          const currentSnapshot = await get(clientRef);
          if (currentSnapshot.exists()) {
            const currentData = currentSnapshot.val();
            const updatedData = {
              ...currentData,
              simple_mode: enabled,
              timestamp: Date.now()
            };

            // Use set() instead of update() to ensure listener triggers
            await set(clientRef, updatedData);
            console.log(`[Firebase]  Set complete client data with simple_mode: ${enabled}`);
          } else {
            // Client doesn't exist, just update simple_mode
            await set(clientRef, { simple_mode: enabled, timestamp: Date.now() });
            console.log(`[Firebase]  Created new client data with simple_mode: ${enabled}`);
          }

          // Mark next k write as allowed (user-driven change), then recalc after a short delay
          allowKWriteOnceRef.current = true;
          // Force k recalculation after a short delay
          setTimeout(async () => {
            try {
              // Get current active clients
              const activeClientsRef = ref(realtimeDB!, `konstant/${currentDeviceId}/active_clients`);
              const snapshot = await get(activeClientsRef);
              const clients = snapshot.exists() ? snapshot.val() : {};
              const entries = Object.entries(clients) as Array<[string, any]>;
              const simpleCount = entries.filter(([, v]) => v?.simple_mode === true).length;

              // Read manual offset and recalc k
              let manualFlag = false;
              try {
                const kManualSnap = await get(ref(realtimeDB!, `konstant/${currentDeviceId}/k_manual`));
                if (kManualSnap.exists()) {
                  const raw = kManualSnap.val();
                  if (typeof raw === 'boolean') manualFlag = raw;
                  else if (typeof raw === 'number') manualFlag = raw !== 0;
                  else if (typeof raw === 'string') {
                    const s = raw.trim().toLowerCase();
                    manualFlag = (s === 'true' || s === '1' || s === 'yes' || s === 'ja');
                  }
                }
              } catch {
                manualFlag = false;
              }
              const manual = manualFlag ? 1 : 0;

              await set(ref(realtimeDB!, `konstant/${currentDeviceId}/k`), simpleCount + manual);
              console.log(`[Firebase] Forced k recalculation: k=${simpleCount + manual} (simple=${simpleCount}, manual=${manual})`);
            } catch (error) {
              console.warn('[Firebase] Failed to force recalculation:', error);
            }
          }, 100);
        }

        // Removed: updating 'd' from user preferences to avoid preinstallation conflicts
      } catch (error) {
        console.warn('[Firebase] Failed to handle userPreferencesChanged event:', error);
      }
    };
    window.addEventListener('userPreferencesChanged', handler as EventListener);
    return () => {
      window.removeEventListener('userPreferencesChanged', handler as EventListener);
    };
  }, [realtimeDB]);

  return {
    connect,
    disconnect,
    connectionStatus,
    deviceId,
    clientId: clientId.current, // For debugging multi-user connections
    ensureActiveClientPresent,
  };
};

export const useParameterUpdates = () => {
  const deviceId = useRigStore(state => state.deviceId);
  const { showSuccess, showError, showInfo } = useNotificationHelpers();

  const updateParameter = useCallback(async (paramKey: string, value: number | boolean | string) => {
    console.log(`[Firebase] updateParameter called with paramKey="${paramKey}", value="${value}" (type: ${typeof value})`);
    
    if (!deviceId) {
      console.error('[Firebase] No device connected');
      showError('No device connected');
      return false;
    }

    try {
      if (!realtimeDB) {
        throw new Error('Database not initialized');
      }

      // Use command queue to prevent overwhelming controller with rapid commands
      // The queue automatically adds configurable delays between commands
      
      // Properly handle boolean values - preserve them as boolean, don't convert to numbers
      let cmdValue = value;
      if (typeof value === 'boolean') {
        // Keep boolean as is for cmd - controller expects "true"/"false" strings or booleans
        cmdValue = value;
      }
      
      console.log(`[Firebase] Queueing command: set ${paramKey} ${cmdValue}`);
      await queueSetCommand(deviceId, paramKey, cmdValue);
      
      console.log(`[Firebase] Command queued successfully`);
      showSuccess(`Parameter '${paramKey}' updated`);
      return true;

    } catch (error) {
      console.error('[Firebase] Parameter update failed:', error);
      showError(`Failed to update parameter: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }, [deviceId, showSuccess, showError]);

  const updateAlwaysSendData = useCallback(async (_enabled: boolean) => {
    if (!deviceId) return false;

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      await set(ref(realtimeDB, `konstant/${deviceId}/d`), Boolean(_enabled));
      return true;

    } catch (error) {
      console.error('[Firebase] AlwaysSendData update failed:', error);
      showError('Failed to update data sending mode');
      return false;
    }
  }, [deviceId, showError]);

  const triggerFirmwareUpdate = useCallback(async (force = false) => {
    if (!deviceId) {
      showError('No device connected');
      return false;
    }

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      const updateRef = ref(realtimeDB, `konstant/${deviceId}/u`);
      
      await set(updateRef, false);
      await set(updateRef, true);

      showSuccess(force ? 'Forced firmware update initiated' : 'Firmware update initiated');
      return true;

    } catch (error) {
      console.error('[Firebase] Firmware update failed:', error);
      showError('Failed to initiate firmware update');
      return false;
    }
  }, [deviceId, showSuccess, showError]);

  const checkForUpdates = useCallback(async () => {
    if (!deviceId) {
      showError('No device connected');
      return false;
    }

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      // Check current device metadata to see if updates are available
      const metadataRef = ref(realtimeDB, `konstant_app/${deviceId}`);
      const snapshot = await get(metadataRef);
      
      if (snapshot.exists()) {
        const metadata = snapshot.val();
        
        if (metadata.v) {
          showSuccess('Firmware update is available and ready to install');
          return true;
        } else {
          showInfo('No firmware updates available at this time');
          return false;
        }
      } else {
        showError('Unable to check for updates - device metadata not found');
        return false;
      }

    } catch (error) {
      console.error('[Firebase] Check for updates failed:', error);
      showError('Failed to check for firmware updates');
      return false;
    }
  }, [deviceId, showSuccess, showError, showInfo]);

  return {
    updateParameter,
    updateAlwaysSendData,
    triggerFirmwareUpdate,
    checkForUpdates,
  };
};

export const useParameterMetadata = () => {
  const updateParameterMetadata = useRigStore(state => state.updateParameterMetadata);
  const { showError } = useNotificationHelpers();
  
  // Keep track of active listeners to avoid duplicates
  const listenersRef = useRef<Record<string, () => void>>({});

  // FIXED: Fetch metadata WITHOUT triggering store updates during initial parsing
  const fetchMetadata = useCallback(async (paramId: string): Promise<ParameterMetadata | null> => {
    try {
      if (!firestoreDB) throw new Error('Firestore not initialized');

      const docRef = doc(firestoreDB, 'masse_und_gewichte', paramId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const metadata = docSnap.data() as ParameterMetadata;
        // DO NOT update store here - let the calling code handle it
        return metadata;
      } else {
        return null;
      }

    } catch (error) {
      console.error(`[Firestore] Failed to fetch metadata for ${paramId}:`, error);
      return null;
    }
  }, []);

  // Setup real-time listener for parameter metadata changes
  const setupParameterListener = useCallback((paramId: string) => {
    // Avoid duplicate listeners
    if (listenersRef.current[paramId]) {
      return;
    }

    try {
      if (!firestoreDB) throw new Error('Firestore not initialized');

      const docRef = doc(firestoreDB, 'masse_und_gewichte', paramId);
      
      const unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const rawMetadata = docSnap.data() as ParameterMetadata;
          
          // Use metadata as is
          const metadata = rawMetadata;
          
          // Only update store for real-time changes (not initial fetch)
          updateParameterMetadata(paramId, metadata);
          
          // Notify other tabs about metadata update
          try {
            const event = new CustomEvent('parameterMetadataUpdated', {
              detail: { paramId, metadata }
            });
            window.dispatchEvent(event);
            console.log(`[Firestore] 📡 Dispatched metadata update event for ${paramId}`);
          } catch (error) {
            console.warn(`[Firestore] Failed to dispatch metadata update event:`, error);
          }
        }
      }, (error) => {
        console.error(`[Firestore] Listener error for ${paramId}:`, error);
      });

      listenersRef.current[paramId] = unsubscribe;
      
    } catch (error) {
      console.error(`[Firestore] Failed to setup listener for ${paramId}:`, error);
    }
  }, [updateParameterMetadata]);

  const saveMetadata = useCallback(async (paramId: string, metadata: Partial<ParameterMetadata>): Promise<boolean> => {
    try {
      if (!firestoreDB) throw new Error('Firestore not initialized');

      // Map UI field names to Firebase field names
      const mappedMetadata: any = { ...metadata };
      
      // Field mapping: UI -> Firebase
      if ('displayName' in metadata) {
        mappedMetadata.name = metadata.displayName;
        delete mappedMetadata.displayName;
      }
      
      if ('unit' in metadata) {
        mappedMetadata.einheit = metadata.unit;
        delete mappedMetadata.unit;
      }
      
      if ('divisor' in metadata) {
        mappedMetadata.div = metadata.divisor;
        delete mappedMetadata.divisor;
      }
      
      if ('description' in metadata) {
        mappedMetadata.was = metadata.description;
        delete mappedMetadata.description;
      }
      
      if ('minValue' in metadata) {
        mappedMetadata.min = metadata.minValue;
        delete mappedMetadata.minValue;
      }
      
      if ('maxValue' in metadata) {
        mappedMetadata.max = metadata.maxValue;
        delete mappedMetadata.maxValue;
      }
      
      // dataType field is saved as is (no mapping)
      if ('dataType' in metadata) {
        if (metadata.dataType === undefined) {
          // Save null instead of deleting field - this way it always appears in listener updates
          mappedMetadata.dataType = null;
        } else {
          mappedMetadata.dataType = metadata.dataType;
        }
      }

      // decimalPlaces field - save as is, handle null for deletion
      if ('decimalPlaces' in metadata) {
        if (metadata.decimalPlaces === null) {
          // Use deleteField() to remove the field from Firestore
          const { deleteField } = await import('firebase/firestore');
          mappedMetadata.decimalPlaces = deleteField();
        } else if (metadata.decimalPlaces !== undefined) {
          mappedMetadata.decimalPlaces = metadata.decimalPlaces;
        }
      }

      // timeFormat - delete when explicitly set to null
      if ('timeFormat' in metadata) {
        if (metadata.timeFormat === null) {
          const { deleteField } = await import('firebase/firestore');
          mappedMetadata.timeFormat = deleteField();
        } else if (metadata.timeFormat !== undefined) {
          mappedMetadata.timeFormat = metadata.timeFormat as any;
        }
      }

      // timeInputUnit - delete when explicitly set to null
      if ('timeInputUnit' in metadata) {
        if (metadata.timeInputUnit === null) {
          const { deleteField } = await import('firebase/firestore');
          mappedMetadata.timeInputUnit = deleteField();
        } else if (metadata.timeInputUnit !== undefined) {
          mappedMetadata.timeInputUnit = metadata.timeInputUnit as any;
        }
      }

      // Alarm fields mapping
      // UI: isAlarmEnabled (boolean) -> Firestore: alarm
      if ('isAlarmEnabled' in metadata) {
        const alarmEnabled = Boolean((metadata as any).isAlarmEnabled);
        mappedMetadata.alarm = alarmEnabled;
        delete (mappedMetadata as any).isAlarmEnabled;
        // If alarm is disabled, delete thresholds entirely
        if (!alarmEnabled) {
          const { deleteField } = await import('firebase/firestore');
          mappedMetadata['min-alarm'] = deleteField();
          mappedMetadata['max-alarm'] = deleteField();
        }
      }

      // UI: alarmMinThreshold -> Firestore: min-alarm (delete if null)
      if ('alarmMinThreshold' in metadata) {
        const v = (metadata as any).alarmMinThreshold;
        delete (mappedMetadata as any).alarmMinThreshold;
        if (v === null) {
          const { deleteField } = await import('firebase/firestore');
          mappedMetadata['min-alarm'] = deleteField();
        } else if (v !== undefined) {
          const num = typeof v === 'string' ? parseFloat(v) : Number(v);
          if (!isNaN(num)) mappedMetadata['min-alarm'] = num;
        }
      }

      // UI: alarmMaxThreshold -> Firestore: max-alarm (delete if null)
      if ('alarmMaxThreshold' in metadata) {
        const v = (metadata as any).alarmMaxThreshold;
        delete (mappedMetadata as any).alarmMaxThreshold;
        if (v === null) {
          const { deleteField } = await import('firebase/firestore');
          mappedMetadata['max-alarm'] = deleteField();
        } else if (v !== undefined) {
          const num = typeof v === 'string' ? parseFloat(v) : Number(v);
          if (!isNaN(num)) mappedMetadata['max-alarm'] = num;
        }
      }

      // icon field - save as is (Firestore supports UTF-8)
      if ('icon' in metadata) {
        const iconValue = metadata.icon;
        if (iconValue && typeof iconValue === 'string') {
          mappedMetadata.icon = iconValue;
        }
      }

      // Clean undefined values to avoid Firestore errors, BUT preserve deleteField objects
      const cleanMetadata: any = {};
      Object.entries(mappedMetadata).forEach(([key, value]) => {
        // Keep deleteField objects (they are not undefined and have special meaning)
        // Special handling for fields that can be explicitly null/deleteField
        if ((key === 'dataType' || key === 'decimalPlaces') && value !== undefined) {
          cleanMetadata[key] = value;
        } else if (value !== undefined) {
          cleanMetadata[key] = value;
        }
      });

      const docRef = doc(firestoreDB, 'masse_und_gewichte', paramId);
      await setDoc(docRef, cleanMetadata, { merge: true });
      
      // IMMEDIATELY update store for instant visual feedback
      // Re-fetch and apply the metadata immediately, don't wait for listener
      const updatedDoc = await getDoc(docRef);
      if (updatedDoc.exists()) {
        const freshMetadata = updatedDoc.data() as ParameterMetadata;
        updateParameterMetadata(paramId, freshMetadata);
      }
      
      // Setup listener for this parameter if not already active (for future updates)
      if (!listenersRef.current[paramId]) {
        setupParameterListener(paramId);
      }
      
      return true;

    } catch (error) {
      console.error(`[Firestore] Failed to save metadata for ${paramId}:`, error);
      showError(`Failed to save parameter settings`);
      return false;
    }
  }, [showError, setupParameterListener, updateParameterMetadata]);

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      Object.values(listenersRef.current).forEach(unsubscribe => unsubscribe());
      listenersRef.current = {};
    };
  }, []);

  return {
    fetchMetadata,
    saveMetadata,
    setupParameterListener,
  };
};

export const useHistoricalData = () => {
  const deviceId = useRigStore(state => state.deviceId);
  const setHistoricalTimestamps = useRigStore(state => state.setHistoricalTimestamps);
  const { showError, showSuccess } = useNotificationHelpers();
  const historienListenerRef = useRef<() => void>();
  
  // Use refs for notification functions to prevent unnecessary re-renders
  const showErrorRef = useRef(showError);
  const showSuccessRef = useRef(showSuccess);
  showErrorRef.current = showError;
  showSuccessRef.current = showSuccess;

  const loadHistoricalTimestamps = useCallback(async (): Promise<string[]> => {
    if (!deviceId) return [];

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      const historienRef = ref(realtimeDB, `historien/${deviceId}`);
      const snapshot = await get(historienRef);

      if (snapshot.exists()) {
        const timestamps: string[] = [];
        snapshot.forEach((child) => {
          const key = child.key;
          if (key && key.length === 10 && /^\d+$/.test(key)) {
            timestamps.push(key);
          }
        });
        
        timestamps.sort((a, b) => parseInt(b) - parseInt(a));
        console.log(`[HistoricalData] Found ${timestamps.length} historical logs`);
        
        // Update store with timestamps
        setHistoricalTimestamps(timestamps);
        return timestamps;
      }
      
      setHistoricalTimestamps([]);
      return [];

    } catch (error) {
      console.error('[Firebase] Failed to load historical timestamps:', error);
      showErrorRef.current('Failed to load historical data list');
      setHistoricalTimestamps([]);
      return [];
    }
  }, [deviceId, setHistoricalTimestamps]);

  // Realtime listener: keep Abbrand (historien) list up-to-date without reload
  useEffect(() => {
    // Clean up any previous listener
    historienListenerRef.current?.();
    if (!deviceId || !realtimeDB) {
      return;
    }

    const historienRef = ref(realtimeDB, `historien/${deviceId}`);
    const unsubscribe = onValue(historienRef, (snapshot) => {
      if (!snapshot.exists()) {
        setHistoricalTimestamps([]);
        return;
      }

      const timestamps: string[] = [];
      snapshot.forEach((child) => {
        const key = child.key;
        if (key && key.length === 10 && /^\d+$/.test(key)) {
          timestamps.push(key);
        }
      });
      timestamps.sort((a, b) => parseInt(b) - parseInt(a));
      setHistoricalTimestamps(timestamps);
    }, (error) => {
      console.error('[HistoricalData] Listener error for historien:', error);
    });

    historienListenerRef.current = unsubscribe;

    return () => {
      try { historienListenerRef.current?.(); } catch {}
      historienListenerRef.current = undefined;
    };
  }, [deviceId, setHistoricalTimestamps]);

  const loadHistoricalData = useCallback(async (timestamp: string): Promise<HistoricalLog | null> => {
    if (!deviceId || !timestamp) return null;

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      const dataRef = ref(realtimeDB, `historien/${deviceId}/${timestamp}`);
      const snapshot = await get(dataRef);

      if (snapshot.exists()) {
        const data = snapshot.val() as HistoricalLog;
        console.log(`[HistoricalData] Loaded historical data with ${Object.keys(data).length} time points`);
        
        // Legacy behavior: DO NOT change current data or historical mode
        // Only return the historical data for chart consumption
        // Parameters should continue showing live data
        
        showSuccessRef.current(`Loaded ${Object.keys(data).length} historical records for chart`);
        return data;
      } else {
        showErrorRef.current('No historical data found for selected timestamp');
        return null;
      }

    } catch (error) {
      console.error('[Firebase] Failed to load historical data:', error);
      showErrorRef.current('Failed to load historical data');
      return null;
    }
  }, [deviceId]);

  const deleteHistoricalData = useCallback(async (timestamp: string): Promise<boolean> => {
    if (!deviceId || !timestamp) return false;

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      await set(ref(realtimeDB, `historien/${deviceId}/${timestamp}`), null);
      showSuccessRef.current('Historical data deleted');
      return true;
    } catch (error) {
      console.error('[Firebase] Failed to delete historical data:', error);
      showErrorRef.current('Failed to delete historical data');
      return false;
    }
  }, [deviceId]);

  const clearHistoricalMode = useCallback(() => {
    console.log('[HistoricalData] Clearing historical mode, returning to live data');
    showSuccessRef.current('Returned to live data mode');
  }, []);

  return {
    loadHistoricalTimestamps,
    loadHistoricalData,
    deleteHistoricalData,
    clearHistoricalMode,
  };
};

export const useDeviceList = () => {
  const { showError, showInfo } = useNotificationHelpers();

  const getAllDeviceIds = useCallback(async (): Promise<string[]> => {
    console.log('[Firebase] Fetching all device IDs from konstant_app path');
    
    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      // Use konstant_app path since it contains device metadata
      const konstantAppRef = ref(realtimeDB, 'konstant_app');
      const snapshot = await get(konstantAppRef);

      if (snapshot.exists()) {
        const deviceIds: string[] = [];
        snapshot.forEach((child) => {
          const deviceId = child.key;
          if (deviceId) {
            deviceIds.push(deviceId);
          }
        });
        
        deviceIds.sort(); // Sort alphabetically for better UX
        console.log(`[Firebase] Found ${deviceIds.length} device IDs:`, deviceIds);
        showInfo(`Found ${deviceIds.length} available devices`);
        return deviceIds;
      } else {
        console.log('[Firebase] No devices found in konstant_app path');
        showInfo('No devices found');
        return [];
      }

    } catch (error) {
      console.error('[Firebase] Failed to fetch device IDs:', error);
      showError('Failed to fetch device list');
      return [];
    }
  }, [showError, showInfo]);

  const getDeviceMetadata = useCallback(async (deviceId: string): Promise<DeviceMetadata | null> => {
    console.log(`[Firebase] Fetching metadata for device: ${deviceId}`);
    
    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      const metadataRef = ref(realtimeDB, `konstant_app/${deviceId}`);
      const snapshot = await get(metadataRef);

      if (snapshot.exists()) {
        const metadata = snapshot.val() as DeviceMetadata;
        console.log(`[Firebase] Found metadata for ${deviceId}:`, metadata);
        return metadata;
      } else {
        console.log(`[Firebase] No metadata found for ${deviceId}`);
        return null;
      }

    } catch (error) {
      console.error(`[Firebase] Failed to fetch metadata for ${deviceId}:`, error);
      return null;
    }
  }, []);

  const getAllDevicesWithMetadata = useCallback(async (): Promise<Array<{
    deviceId: string;
    metadata: DeviceMetadata | null;
  }>> => {
    console.log('[Firebase] Fetching all devices with their metadata');
    
    const deviceIds = await getAllDeviceIds();
    const devicesWithMetadata = await Promise.all(
      deviceIds.map(async (deviceId) => ({
        deviceId,
        metadata: await getDeviceMetadata(deviceId),
      }))
    );

    console.log(`[Firebase] Loaded metadata for ${devicesWithMetadata.length} devices`);
    return devicesWithMetadata;
  }, [getAllDeviceIds, getDeviceMetadata]);

  return {
    getAllDeviceIds,
    getDeviceMetadata,
    getAllDevicesWithMetadata,
  };
};

export const useParameterVariants = () => {
  const deviceId = useRigStore(state => state.deviceId);
  const currentData = useRigStore(state => state.currentData);
  const deviceMetadata = useRigStore(state => state.deviceMetadata);
  const discoveredParameters = useRigStore(state => state.discoveredParameters);
  const { showError, showSuccess, showInfo } = useNotificationHelpers();
  
  // Variants cache (batched), shared within hook instance
  const variantsCacheRef = useRef<{ list: string[]; infoMap: Record<string, any>; ts: number } | null>(null);
  const VARIANTS_CACHE_TTL_MS = 60_000;

  const getVariantsWithInfo = useCallback(async (): Promise<{ list: string[]; infoMap: Record<string, any> }> => {
    const now = Date.now();
    if (variantsCacheRef.current && (now - variantsCacheRef.current.ts) < VARIANTS_CACHE_TTL_MS) {
      return { list: variantsCacheRef.current.list, infoMap: variantsCacheRef.current.infoMap };
    }
    try {
      if (!realtimeDB) throw new Error('Database not initialized');
      const entwicklungRef = ref(realtimeDB as any, `entwicklung/parameter`);
      const snapshot = await get(entwicklungRef);
      const list: string[] = [];
      const infoMap: Record<string, any> = {};
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const key = child.key;
          if (key && key !== '~' && key !== '~~') {
            list.push(key);
            const data = child.val();
            infoMap[key] = (data && typeof data === 'object') ? (data._variant_info || null) : null;
          }
        });
      }
      list.sort();
      variantsCacheRef.current = { list, infoMap, ts: Date.now() };
      return { list, infoMap };
    } catch (error) {
      console.error('[Firebase] Failed to load variants with info:', error);
      return { list: [], infoMap: {} };
    }
  }, []);

  const loadVariantList = useCallback(async (): Promise<string[]> => {
    const { list } = await getVariantsWithInfo();
    return list;
  }, [getVariantsWithInfo]);

  const saveVariant = useCallback(async (variantName: string): Promise<boolean> => {
    if (!deviceId || !variantName?.trim()) {
      showError('Invalid variant name');
      return false;
    }

    if (variantName.startsWith('~')) {
      showError('Variant name cannot start with "~"');
      return false;
    }

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      console.log(`[ParameterVariants] Saving comprehensive variant "${variantName}" for device ${deviceId}`);

      // 1. Filter ONLY writable parameters (not measured values)
      const variantData: any = {};
      let savedParameterCount = 0;

      if (currentData && Object.keys(currentData).length > 0) {
        console.log(`[ParameterVariants] Filtering writable parameters from ${Object.keys(currentData).length} total parameters`);
        
        Object.entries(currentData).forEach(([paramId, value]) => {
          // Find parameter metadata to check zugriff
          const paramInfo = discoveredParameters.find(p => p.originalName === paramId);
          const zugriff = paramInfo?.zugriff;
          
          console.log(`[ParameterVariants] Checking ${paramId}: zugriff="${zugriff}", value=${value}`);
          
          // Only save parameters with write access (w or rw)
          if (zugriff && zugriff.includes('w')) {
            variantData[paramId] = value;
            savedParameterCount++;
            console.log(`[ParameterVariants] Including ${paramId} (zugriff=${zugriff})`);
          } else {
            console.log(`[ParameterVariants] Skipping ${paramId} (zugriff=${zugriff || 'none'} - read-only or no access)`);
          }
        });
        
        console.log(`[ParameterVariants] Filtered ${savedParameterCount} writable parameters out of ${Object.keys(currentData).length} total`);
      }

      // 2. Get ALL device settings from konstant/{deviceId}
      const konstantRef = ref(realtimeDB as any, `konstant/${deviceId}`);
      const konstantSnapshot = await get(konstantRef);
      
      if (konstantSnapshot.exists()) {
        const konstantData = konstantSnapshot.val();
        console.log(`[ParameterVariants] Including device settings:`, Object.keys(konstantData));
        
        // Include all konstant settings (like old system saved all checkbox/input states)
        // BUT exclude complex objects like active_clients, command field 'cmd', and data sending flag 'd'
        Object.entries(konstantData).forEach(([key, value]) => {
          // Skip system fields, command field, data sending flag, and complex objects
          if (key === 'k' || key === 'cmd' || key === 'd' || key === 'active_clients') {
            return;
          }
          
          // Only save primitive values (string, number, boolean)
          const valueType = typeof value;
          if (valueType === 'object' && value !== null) {
            console.warn(`[ParameterVariants] Skipping complex konstant field "${key}" (type: ${Array.isArray(value) ? 'array' : 'object'})`);
            return;
          }
          
          if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
            variantData[`konstant_${key}`] = value;
          }
        });
      }

      // 3. Add metadata about this variant
      variantData._variant_info = {
        created_at: Date.now(),
        created_by: 'modern_app',
        device_model: deviceMetadata.rig || 'Unknown',
        device_version: deviceMetadata.vers || 'Unknown',
        parameter_count: savedParameterCount, // Only writable parameters
        settings_count: konstantSnapshot.exists() ? Object.keys(konstantSnapshot.val()).length : 0,
        total_parameters_available: Object.keys(currentData || {}).length,
        writable_parameters_saved: savedParameterCount,
        saved_from_device: deviceId
      };

      // 4. Validate we have something to save
      if (savedParameterCount === 0) {
        showError('No writable parameters found to save. Only read-only parameters detected.');
        console.warn('[ParameterVariants] No writable parameters found. Available parameters:', Object.keys(currentData || {}));
        return false;
      }

      const variantRef = ref(realtimeDB as any, `entwicklung/parameter/${variantName}`);
      await set(variantRef, variantData);

      // const totalItems = Object.keys(variantData).length - 1; // -1 for _variant_info
      showSuccess(`Rig model "${variantName}" saved with ${savedParameterCount} writable parameters and ${variantData._variant_info.settings_count} settings`);
      console.log(`[ParameterVariants] Saved variant with:`, {
        writableParameters: savedParameterCount,
        totalDataKeys: Object.keys(variantData),
        skippedReadOnlyCount: Object.keys(currentData || {}).length - savedParameterCount
      });
      // Invalidate variants cache so next list/info fetch sees the new variant
      variantsCacheRef.current = null;
      return true;

    } catch (error) {
      console.error('[Firebase] Failed to save variant:', error);
      showError('Failed to save rig model variant');
      return false;
    }
  }, [deviceId, currentData, deviceMetadata, discoveredParameters, showSuccess, showError]);

  const loadVariant = useCallback(async (variantName: string, useTakeparams: boolean = false): Promise<boolean> => {
    if (!deviceId || !variantName) {
      showError('No variant selected');
      return false;
    }

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      console.log(`[ParameterVariants] Loading comprehensive variant "${variantName}" for device ${deviceId}`);

      const variantRef = ref(realtimeDB as any, `entwicklung/parameter/${variantName}`);
      const variantSnapshot = await get(variantRef);

      if (!variantSnapshot.exists()) {
        showError(`Rig model "${variantName}" not found`);
        return false;
      }

      const variantData = variantSnapshot.val();
      console.log(`[ParameterVariants] 📥 Loaded variant data:`, Object.keys(variantData));

      // 2. Apply device settings (konstant fields) FIRST
      const konstantUpdates: any = {};
      let settingsCount = 0;

      Object.entries(variantData).forEach(([key, value]) => {
        if (key.startsWith('konstant_')) {
          const konstantKey = key.replace('konstant_', '');
          
          // CRITICAL: Never restore 'cmd' - it's a command field, not a setting!
          // Restoring cmd would write raw values like "48" instead of proper commands
          // Also never restore 'd' - data sending flag should remain controlled by client connections
          if (konstantKey === 'cmd' || konstantKey === 'd') {
            console.warn(`[ParameterVariants] Skipping konstant_${konstantKey} (should not be restored from variant)`);
            return;
          }
          
          konstantUpdates[konstantKey] = value;
          settingsCount++;
        }
      });

      if (Object.keys(konstantUpdates).length > 0) {
        console.log(`[ParameterVariants] Applying ${Object.keys(konstantUpdates).length} device settings:`, konstantUpdates);
        
        // Apply all konstant settings
        const updates: any = {};
        Object.entries(konstantUpdates).forEach(([key, value]) => {
          updates[`konstant/${deviceId}/${key}`] = value;
        });
        
        await update(ref(realtimeDB as any), updates);
        console.log(`[ParameterVariants] Device settings applied successfully`);
      }

      // 3. Apply writable parameters using selected method
      let parametersApplied = 0;
      const parameterEntries = Object.entries(variantData).filter(([key, value]) => {
        // Exclude metadata and konstant settings
        if (key.startsWith('konstant_') || key === '_variant_info') {
          return false;
        }
        // Exclude complex types (objects, arrays) - only allow primitives
        const valueType = typeof value;
        if (valueType === 'object' && value !== null) {
          console.warn(`[ParameterVariants] Skipping complex parameter "${key}" (type: ${Array.isArray(value) ? 'array' : 'object'})`);
          return false;
        }
        // Only allow string, number, boolean
        return valueType === 'string' || valueType === 'number' || valueType === 'boolean';
      });

      console.log(`[ParameterVariants] Applying ${parameterEntries.length} parameters to device using ${useTakeparams ? 'FAST (takeparams)' : 'SLOW (individual commands)'} method...`);

      if (useTakeparams) {
        // FAST METHOD: Bulk update temporaer + takeparams command
        console.log(`[ParameterVariants] 🚀 Using FAST method: bulk temporaer update + takeparams`);

        // Prepare bulk update for temporaer
        const temporaerUpdates: any = {};
        for (const [paramId, value] of parameterEntries) {
          temporaerUpdates[`temporaer/${deviceId}/${paramId}`] = value;
          parametersApplied++;
        }

        if (Object.keys(temporaerUpdates).length > 0) {
          // Execute bulk update
          console.log(`[ParameterVariants] 📦 Bulk updating ${Object.keys(temporaerUpdates).length} parameters in temporaer...`);
          await update(ref(realtimeDB as any), temporaerUpdates);
          console.log(`[ParameterVariants] ✅ Bulk temporaer update completed`);

          // Wait 1 second before sending takeparams command to avoid race condition
          console.log(`[ParameterVariants] ⏳ Waiting 1 second before sending takeparams...`);
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Send takeparams command
          console.log(`[ParameterVariants] 📡 Sending takeparams command...`);
          await queueCommand(deviceId, "takeparams");
          console.log(`[ParameterVariants] ✅ Takeparams command sent`);
        }
      } else {
        // SLOW METHOD: Individual commands (legacy behavior)
        console.log(`[ParameterVariants] 🐌 Using SLOW method: individual commands`);

        // Use command queue to apply parameters with automatic delays
        // This prevents overwhelming the controller and respects user-configured delay settings
        for (const [paramId, value] of parameterEntries) {
          try {
            console.log(`[ParameterVariants] Queueing parameter ${paramId} = ${value}`);
            await queueSetCommand(deviceId, paramId, value as string | number | boolean);
            parametersApplied++;
            console.log(`[ParameterVariants] Queued parameter ${paramId} = ${value}`);
          } catch (error) {
            console.error(`[ParameterVariants] Failed to queue parameter ${paramId}:`, error);
          }
        }

        console.log(`[ParameterVariants] Queued ${parametersApplied}/${parameterEntries.length} parameters (will be applied with delays)`);

        // IMPORTANT: Wait until ALL commands are processed before clearing cmd
        console.log(`[ParameterVariants] ⏳ Waiting for command queue to finish...`);
        await commandQueue.waitUntilEmpty();
        console.log(`[ParameterVariants] ✅ All commands processed!`);
      }

      
      // 5. Show info about what was loaded
      const variantInfo = variantData._variant_info;
      const paramCount = parameterEntries.length;
      
      let message = `Rig model "${variantName}" loaded`;
      if (variantInfo) {
        const createdDate = new Date(variantInfo.created_at).toLocaleDateString();
        message += ` (${paramCount} parameters, ${settingsCount} settings, created ${createdDate})`;
      } else {
        message += ` (${paramCount} parameters, ${settingsCount} settings)`;
      }
      
      showSuccess(message);
      console.log(`[ParameterVariants] Successfully loaded variant "${variantName}" with ${parametersApplied} parameters applied`);
      console.log(`[ParameterVariants] Live data should resume normal operation now`);
      return true;

    } catch (error) {
      console.error('[Firebase] Failed to load variant:', error);
      showError('Failed to load rig model variant');
      return false;
    }
  }, [deviceId, showSuccess, showError]);

  const deleteVariant = useCallback(async (variantName: string): Promise<boolean> => {
    if (!variantName || variantName.startsWith('~')) {
      showError('Invalid variant for deletion');
      return false;
    }

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      await set(ref(realtimeDB as any, `entwicklung/parameter/${variantName}`), null);
      showSuccess(`Rig model "${variantName}" deleted`);
      // Invalidate variants cache so next list/info fetch reflects the deletion
      variantsCacheRef.current = null;
      return true;

    } catch (error) {
      console.error('[Firebase] Failed to delete variant:', error);
      showError('Failed to delete rig model variant');
      return false;
    }
  }, [showSuccess, showError]);

  const getVariantInfo = useCallback(async (variantName: string): Promise<any | null> => {
    if (!variantName) return null;
    // Try cache first
    const cached = variantsCacheRef.current;
    if (cached && Object.prototype.hasOwnProperty.call(cached.infoMap, variantName)) {
      return cached.infoMap[variantName] || null;
    }
    // Fallback to batched fetch
    const { infoMap } = await getVariantsWithInfo();
    return infoMap[variantName] || null;
  }, [getVariantsWithInfo]);

  const exportVariant = useCallback(async (variantName: string): Promise<string | null> => {
    if (!variantName) return null;

    try {
      if (!realtimeDB) throw new Error('Database not initialized');

      const variantRef = ref(realtimeDB as any, `entwicklung/parameter/${variantName}`);
      const snapshot = await get(variantRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        const exportData = {
          variant_name: variantName,
          exported_at: Date.now(),
          data: data
        };
        
        const jsonString = JSON.stringify(exportData, null, 2);
        showInfo(`Rig model "${variantName}" exported to clipboard`);
        return jsonString;
      }
      return null;

    } catch (error) {
      console.error('[Firebase] Failed to export variant:', error);
      showError('Failed to export rig model variant');
      return null;
    }
  }, [showInfo, showError]);

  return {
    loadVariantList,
    getVariantsWithInfo,
    saveVariant,
    loadVariant,
    deleteVariant,
    getVariantInfo,
    exportVariant,
  };
};

// Module-level cache for rig model info shared across components
const rigModelModuleCache: Map<string, { name: string; data: any | null }> = new Map();

export const useRigModel = () => {
  const deviceMetadata = useRigStore(state => state.deviceMetadata);
  const { showError } = useNotificationHelpers();
  
  // Cache to prevent repeated queries
  const [cachedModel, setCachedModel] = useState<string | null>(null);
  const [cachedModelData, setCachedModelData] = useState<any | null>(null);
  const [lastArticleNumber, setLastArticleNumber] = useState<string | null>(null);

  const getRigModelName = useCallback(async (): Promise<string> => {
    const articleNumber = deviceMetadata.a != null ? deviceMetadata.a.toString() : null;
    if (!articleNumber) return 'Unknown Model';

    // Module-level cache first
    const cached = rigModelModuleCache.get(articleNumber);
    if (cached) {
      if (cachedModel !== cached.name) setCachedModel(cached.name);
      if (cachedModelData !== cached.data) setCachedModelData(cached.data);
      if (lastArticleNumber !== articleNumber) setLastArticleNumber(articleNumber);
      return cached.name;
    }

    try {
      if (!firestoreDB) return 'Unknown Model';

      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const rigModelsRef = collection(firestoreDB, 'rig_models');
      const q = query(rigModelsRef, where('article_number', '==', articleNumber));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        const modelData = doc.data();
        const modelName = modelData.name || 'Unknown Model';

        // Save to module cache and local state
        rigModelModuleCache.set(articleNumber, { name: modelName, data: modelData });
        setCachedModel(modelName);
        setCachedModelData(modelData);
        setLastArticleNumber(articleNumber);
        return modelName;
      }

      rigModelModuleCache.set(articleNumber, { name: 'Unknown Model', data: null });
      setCachedModel('Unknown Model');
      setCachedModelData(null);
      setLastArticleNumber(articleNumber);
      return 'Unknown Model';
    } catch (error) {
      console.error('[RigModel] Error fetching rig model:', error);
      showError('Failed to fetch rig model information');
      return 'Unknown Model';
    }
  }, [deviceMetadata.a, showError, cachedModel, cachedModelData, lastArticleNumber]);

  const getRigModelData = useCallback(async (): Promise<any | null> => {
    const articleNumber = deviceMetadata.a != null ? deviceMetadata.a.toString() : null;
    if (!articleNumber) return null;

    const cached = rigModelModuleCache.get(articleNumber);
    if (cached) return cached.data;

    // Ensure name/data are fetched and cached, then return from module cache
    await getRigModelName();
    const after = rigModelModuleCache.get(articleNumber);
    return after ? after.data : null;
  }, [deviceMetadata.a, getRigModelName]);

  return {
    getRigModelName,
    getRigModelData,
    cachedModelName: cachedModel,
    cachedModelData: cachedModelData,
  };
};

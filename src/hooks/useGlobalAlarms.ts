import { useEffect, useState, useCallback, useRef } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot, addDoc, updateDoc, doc, Timestamp, deleteDoc, getDocs, getFirestore } from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';
import { useAuth } from './useAuth';
import { useTranslation } from 'react-i18next';
import { useNotificationHelpers } from '../store/useRigStore';

export interface GlobalAlarm {
  id?: string;
  deviceId: string;
  parameterName: string;
  parameterDisplayName?: string;
  alarmType: 'high' | 'low';
  value: number;
  threshold: number;
  message: string;
  timestamp: Timestamp;
  resolved?: boolean;
  resolvedAt?: Timestamp;
  userId: string;
  language: string;
  type?: 'alarm' | 'bootstrap';
}

// Narrow input type for creating alarms from the client
type AddGlobalAlarmInput = Omit<
  GlobalAlarm,
  'id' | 'timestamp' | 'userId' | 'language' | 'type' | 'resolvedAt'
> & {
  resolvedAt?: Date | number | Timestamp;
};

interface UseGlobalAlarmsResult {
  globalAlarms: GlobalAlarm[];
  loading: boolean;
  error: string | null;
  addGlobalAlarm: (alarm: AddGlobalAlarmInput) => Promise<void>;
  resolveGlobalAlarm: (alarmId: string) => Promise<void>;
  clearOldAlarms: () => Promise<void>;
}

export const useGlobalAlarms = (): UseGlobalAlarmsResult => {
  const [globalAlarms, setGlobalAlarms] = useState<GlobalAlarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const { showWarning, showSuccess } = useNotificationHelpers();
  

  // Track which alarms were already shown as toasts in this tab (id-based)
  const shownAlarmIdsRef = useRef<Set<string>>(new Set());
  // Track last toast per (deviceId:paramName) with cooldown
  const lastToastRef = useRef<Record<string, number>>({});
  // Ensure only one instance emits toasts (singleton guard)
  const shouldEmitToastsRef = useRef<boolean>(false);
  const initialLoadRef = useRef<boolean>(false);
  // Track local messages recently created in this tab to prevent duplicate toast on snapshot
  const recentLocalMessagesRef = useRef<Array<{deviceId: string; parameterName: string; message: string; at: number}>>([]);
  // Track which resolved toasts were already shown (for modified events)
  const resolvedToastShownRef = useRef<Set<string>>(new Set());

  // Clean up old alarms (older than 2 days)
  const clearOldAlarms = useCallback(async () => {
    if (!user) return;

    try {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const db = firestoreDB || getFirestore();
      const q = query(
        collection(db, 'alarms'),
        where('timestamp', '<', Timestamp.fromDate(twoDaysAgo))
      );

      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);

      console.log(`[GlobalAlarms] Cleaned up ${snapshot.docs.length} old alarms`);
    } catch (error) {
      console.error('[GlobalAlarms] Error cleaning old alarms:', error);
    }
  }, [user]);

  // Add new global alarm
  const addGlobalAlarm = useCallback(async (alarm: AddGlobalAlarmInput) => {
    if (!user) return;

    try {
      // Normalize optional resolvedAt to Firestore Timestamp if provided
      let resolvedAtTs: Timestamp | undefined;
      if (alarm.resolvedAt instanceof Timestamp) {
        resolvedAtTs = alarm.resolvedAt;
      } else if (alarm.resolvedAt instanceof Date) {
        resolvedAtTs = Timestamp.fromDate(alarm.resolvedAt);
      } else if (typeof alarm.resolvedAt === 'number') {
        resolvedAtTs = Timestamp.fromMillis(alarm.resolvedAt);
      }

      const { resolvedAt, ...alarmWithoutResolvedAt } = alarm as any;
      const newAlarm: Omit<GlobalAlarm, 'id'> = {
        ...alarmWithoutResolvedAt,
        timestamp: Timestamp.now(),
        userId: user.uid,
        language: i18n.resolvedLanguage || i18n.language || 'en',
        type: 'alarm',
        ...(resolvedAtTs ? { resolvedAt: resolvedAtTs } : {})
      };

      const db = firestoreDB || getFirestore();
      // Add to local recent list to avoid duplicate toast on this tab
      try {
        recentLocalMessagesRef.current.push({
          deviceId: alarm.deviceId,
          parameterName: alarm.parameterName,
          message: alarm.message,
          at: Date.now()
        });
        // Cleanup after 5s
        setTimeout(() => {
          recentLocalMessagesRef.current = recentLocalMessagesRef.current.filter(e => Date.now() - e.at < 5000);
        }, 6000);
      } catch {}

      await addDoc(collection(db, 'alarms'), newAlarm);
      console.log(`[GlobalAlarms] Added alarm for ${alarm.deviceId}:${alarm.parameterName}`);
    } catch (error) {
      console.error('[GlobalAlarms] Error adding alarm:', error);
      setError('Failed to save alarm');
    }
  }, [user, i18n.resolvedLanguage, i18n.language]);

  // Resolve existing alarm
  const resolveGlobalAlarm = useCallback(async (alarmId: string) => {
    if (!user) return;

    try {
      const db = firestoreDB || getFirestore();
      const alarmRef = doc(db, 'alarms', alarmId);
      await updateDoc(alarmRef, {
        resolved: true,
        resolvedAt: Timestamp.now()
      });
      console.log(`[GlobalAlarms] Resolved alarm ${alarmId}`);
    } catch (error) {
      console.error('[GlobalAlarms] Error resolving alarm:', error);
      setError('Failed to resolve alarm');
    }
  }, [user]);

  // Subscribe to global alarms (last 24 hours)
  useEffect(() => {
    if (!user) {
      setGlobalAlarms([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Query for alarms from the last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const db = firestoreDB || getFirestore();
    const alarmsCol = collection(db, 'alarms');

    // Bootstrap: ensure collection exists by creating a hidden doc if empty (privileged roles only)
    (async () => {
      try {
        const snapshot = await getDocs(query(alarmsCol, limit(1)));
        const isPrivileged = user?.role === 'developer' || user?.role === 'super_admin';
        if (snapshot.empty && isPrivileged) {
          await addDoc(alarmsCol, {
            type: 'bootstrap',
            message: 'init',
            timestamp: Timestamp.now()
          } as any);
          console.log('[GlobalAlarms] Bootstrapped alarms collection');
        }
      } catch (e) {
        console.warn('[GlobalAlarms] Bootstrap skipped:', e);
      }
    })();

    const q = query(
      alarmsCol,
      where('timestamp', '>=', Timestamp.fromDate(oneDayAgo)),
      orderBy('timestamp', 'desc'),
      limit(100) // Limit to prevent too much data
    );

    // Singleton guard: only first mounted instance will emit toasts
    try {
      const anyWin = window as any;
      if (!anyWin.__rigopsGlobalAlarmToasterActive) {
        anyWin.__rigopsGlobalAlarmToasterActive = true;
        shouldEmitToastsRef.current = true;
      } else {
        shouldEmitToastsRef.current = false;
      }
    } catch {}

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const raw: GlobalAlarm[] = snapshot.docs
          .map(doc => ({ id: doc.id, ...(doc.data() as any) } as GlobalAlarm))
          .filter(a => (a as any).type !== 'bootstrap'); // Keep test-alarm type for processing

        // Deduplicate in-memory for view/history: group by (device,param,message,resolved,minuteBucket)
        const seen = new Set<string>();
        const alarms: GlobalAlarm[] = [];
        raw.forEach(a => {
          const ts = (a.timestamp as any)?.toMillis?.() ?? Date.now();
          const bucket = Math.floor(ts / 60000);
          const key = `${a.deviceId}|${a.parameterName}|${a.message}|${(a as any).resolved ? '1' : '0'}|${bucket}`;
          if (seen.has(key)) return;
          seen.add(key);
          alarms.push(a);
        });

        setGlobalAlarms(alarms);
        setLoading(false);
        console.log(`[GlobalAlarms] Loaded ${alarms.length} global alarms`);

        // Emit toasts for alarms after initial load (added + resolved changes)
        const changes = snapshot.docChanges();
        if (!initialLoadRef.current) {
          // Skip toasts for initial hydration
          initialLoadRef.current = true;
        } else {
          changes.forEach(change => {
            const id = change.doc.id;
            const data = change.doc.data() as GlobalAlarm;
            if ((data as any).type === 'bootstrap') return;
            const isResolved = Boolean((data as any).resolved);

            if (change.type === 'added') {
              if (shownAlarmIdsRef.current.has(id)) return;
              
              // Special handling for test alarms
              const isTestAlarm = (data as any).type === 'test-alarm';
              
              // Deduplicate if this tab just created the same message recently (skip for test alarms)
              if (!isTestAlarm) {
                const recentHit = recentLocalMessagesRef.current.find(e =>
                  e.deviceId === data.deviceId &&
                  e.parameterName === data.parameterName &&
                  e.message === data.message &&
                  Date.now() - e.at < 3000
                );
                if (recentHit) {
                  shownAlarmIdsRef.current.add(id);
                  // Still dispatch UI event so card styles react immediately
                  try {
                    const event = new CustomEvent('alarm-toast', {
                      detail: {
                        deviceId: data.deviceId,
                        parameterName: data.parameterName,
                        alarmType: (data as any).alarmType,
                        resolved: isResolved,
                        isTest: false
                      }
                    });
                    window.dispatchEvent(event);
                  } catch {}
                  return;
                }
              }

              // Rate-limit by device+param (cooldown 15s) — do not suppress resolved events
              const key = `${data.deviceId}:${data.parameterName}`;
              const nowTs = Date.now();
              const lastTs = lastToastRef.current[key] || 0;
              if (!isResolved && nowTs - lastTs < 15000) {
                shownAlarmIdsRef.current.add(id);
                // Dispatch UI event regardless, so highlight can happen w/o toast
                try {
                  const event = new CustomEvent('alarm-toast', {
                    detail: {
                      deviceId: data.deviceId,
                      parameterName: data.parameterName,
                      alarmType: (data as any).alarmType,
                      resolved: isResolved
                    }
                  });
                  window.dispatchEvent(event);
                } catch {}
                return;
              }
              lastToastRef.current[key] = nowTs;

              // Show toast only if this tab is the active emitter (allow any device)
              if (shouldEmitToastsRef.current) {
                const msg = data.message || `${data.parameterDisplayName || data.parameterName}`;
                const options = { isAlarm: true, deviceId: data.deviceId, parameterName: data.parameterName, duration: isResolved ? 5000 : 10000 } as const;
                isResolved ? showSuccess(msg, options) : showWarning(msg, options);
              }
              shownAlarmIdsRef.current.add(id);

              // Dispatch global event to allow immediate UI reactions (e.g., highlight)
              try {
                const event = new CustomEvent('alarm-toast', {
                  detail: {
                    deviceId: data.deviceId,
                    parameterName: data.parameterName,
                    alarmType: (data as any).alarmType,
                    resolved: isResolved,
                    isTest: isTestAlarm
                  }
                });
                window.dispatchEvent(event);

                // For test alarms, also dispatch special event for CSS handling to avoid circular imports
                if (isTestAlarm) {
                  const firestoreTestEvent = new CustomEvent('firestore-test-alarm', {
                    detail: {
                      deviceId: data.deviceId,
                      parameterName: data.parameterName,
                      alarmType: (data as any).alarmType,
                      resolved: isResolved,
                      isFirestoreTest: true
                    }
                  });
                  window.dispatchEvent(firestoreTestEvent);
                }
              } catch {}
              return;
            }

            // Handle resolution updates (modified -> resolved)
            if (change.type === 'modified' && isResolved) {
              if (resolvedToastShownRef.current.has(id)) return;
              resolvedToastShownRef.current.add(id);

              // Always dispatch event so styles reset immediately
              try {
                const event = new CustomEvent('alarm-toast', {
                  detail: {
                    deviceId: data.deviceId,
                    parameterName: data.parameterName,
                    alarmType: (data as any).alarmType,
                    resolved: true
                  }
                });
                window.dispatchEvent(event);

                // For test alarms, also dispatch special event for CSS handling
                const isTestAlarm = (data as any).type === 'test-alarm';
                if (isTestAlarm) {
                  const firestoreTestEvent = new CustomEvent('firestore-test-alarm', {
                    detail: {
                      deviceId: data.deviceId,
                      parameterName: data.parameterName,
                      alarmType: (data as any).alarmType,
                      resolved: true,
                      isFirestoreTest: true
                    }
                  });
                  window.dispatchEvent(firestoreTestEvent);
                }
              } catch {}

              // Show success toast if this tab is active emitter
              if (shouldEmitToastsRef.current) {
                const msg = data.message || `${data.parameterDisplayName || data.parameterName}`;
                const options = { isAlarm: true, deviceId: data.deviceId, parameterName: data.parameterName, duration: 5000 } as const;
                showSuccess(msg, options);
              }
            }
          });
        }
      },
      (error) => {
        console.error('[GlobalAlarms] Error subscribing to alarms:', error);
        setError('Failed to load alarms');
        setLoading(false);
      }
    );

    // Clean up old alarms periodically (privileged roles only)
    if (user?.role === 'developer' || user?.role === 'super_admin') {
      clearOldAlarms();
    }

    return () => {
      unsubscribe();
      // Release singleton toaster flag if this instance owned it
      try {
        const anyWin = window as any;
        if (shouldEmitToastsRef.current && anyWin.__rigopsGlobalAlarmToasterActive) {
          anyWin.__rigopsGlobalAlarmToasterActive = false;
        }
      } catch {}
      shouldEmitToastsRef.current = false;
    };
  }, [user, clearOldAlarms]);

  return {
    globalAlarms,
    loading,
    error,
    addGlobalAlarm,
    resolveGlobalAlarm,
    clearOldAlarms
  };
};

/**
 * ENHANCED TEST ALARM SYSTEM
 * Simulates alarm conditions with optional Firestore sync for multi-device visibility
 * Directly manipulates DOM and dispatches events for testing
 */

import { soundManager } from './soundManager';
import { firestoreDB } from '../lib/firebase';
import { collection, addDoc, Timestamp, getDocs, query, where, updateDoc } from 'firebase/firestore';

interface TestAlarmConfig {
  deviceId: string;
  parameterName: string;
  alarmType: 'high' | 'low';
  durationMs?: number;
}

interface ActiveTest {
  timeoutId: ReturnType<typeof setTimeout>;
  config: TestAlarmConfig;
  startTime: number; // Track when test started
  alarmDocId?: string; // Firestore doc id for this test alarm
  testGroupId: string; // Unique id linking start/resolve
}

class TestAlarmManager {
  private activeTests = new Map<string, ActiveTest>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start a test alarm (with optional Firestore sync for multi-device visibility)
   */
  async startTestAlarm(config: TestAlarmConfig): Promise<void> {
    const key = `${config.deviceId}:${config.parameterName}`;
    const duration = config.durationMs || 20000;

    // Clear any existing test for this parameter
    this.clearTestAlarm(key);

    console.log(`[TestAlarm] Starting ${config.alarmType} test for ${config.parameterName} (${duration}ms)`);

    // Play sound immediately
    try {
      soundManager.playAlarmSound(config.alarmType);
    } catch (e) {
      console.warn('[TestAlarm] Sound failed:', e);
    }

    // Dispatch local alarm start event
    try {
      const startEvent = new CustomEvent('alarm-toast', {
        detail: {
          deviceId: config.deviceId,
          parameterName: config.parameterName,
          alarmType: config.alarmType,
          resolved: false,
          isTest: true
        }
      });
      window.dispatchEvent(startEvent);
    } catch (e) {
      console.error('[TestAlarm] Failed to dispatch start event:', e);
    }

    // ALSO write to Firestore for multi-device visibility
    try {
      if (firestoreDB) {
        const testGroupId = `${config.deviceId}:${config.parameterName}:${Date.now()}`;
        const docRef = await addDoc(collection(firestoreDB, 'alarms'), {
          deviceId: config.deviceId,
          parameterName: config.parameterName,
          parameterDisplayName: config.parameterName, // Simplified
          alarmType: config.alarmType,
          value: 999, // Synthetic test value
          threshold: 100, // Synthetic threshold
          message: `🧪 TEST: ${config.parameterName} alarm simulation`,
          timestamp: Timestamp.now(),
          userId: 'test-user',
          language: 'en',
          type: 'test-alarm', // Special type for test alarms
          resolved: false,
          testGroupId
        });
        console.log(`[TestAlarm] Created Firestore test alarm for multi-device sync`);
        // Save/update active test entry with doc id and group id
        const existing = this.activeTests.get(key);
        if (existing) {
          existing.alarmDocId = docRef.id;
          existing.testGroupId = testGroupId;
          this.activeTests.set(key, existing);
        }
      }
    } catch (e) {
      console.warn('[TestAlarm] Failed to create Firestore test alarm:', e);
      // Continue with local-only test
    }

    // Schedule auto-resolution (make it async)
    const timeoutId = setTimeout(async () => {
      await this.resolveTestAlarm(key);
    }, duration);

    this.activeTests.set(key, { 
      timeoutId, 
      config,
      startTime: Date.now(),
      testGroupId: `${config.deviceId}:${config.parameterName}:${Date.now()}`
    });

    // Start cleanup interval if not already running
    this.startCleanupInterval();
  }

  /**
   * Manually resolve a test alarm (with Firestore sync)
   */
  async resolveTestAlarm(key: string): Promise<void> {
    const test = this.activeTests.get(key);
    if (!test) return;

    console.log(`[TestAlarm] Resolving test for ${test.config.parameterName}`);

    // Clear timeout
    clearTimeout(test.timeoutId);
    this.activeTests.delete(key);

    // Dispatch local resolution event
    try {
      const resolveEvent = new CustomEvent('alarm-toast', {
        detail: {
          deviceId: test.config.deviceId,
          parameterName: test.config.parameterName,
          alarmType: test.config.alarmType,
          resolved: true,
          isTest: true
        }
      });
      window.dispatchEvent(resolveEvent);
    } catch (e) {
      console.error('[TestAlarm] Failed to dispatch resolve event:', e);
    }

    // ALSO write resolution to Firestore for multi-device sync
    try {
      if (firestoreDB) {
        // Prefer updating the original test doc if we know its id
        if (test.alarmDocId) {
          const { doc } = await import('firebase/firestore');
          const ref = doc(firestoreDB, 'alarms', test.alarmDocId);
          await updateDoc(ref, { resolved: true, resolvedAt: Timestamp.now() });
          console.log(`[TestAlarm] Marked Firestore test alarm resolved (docId=${test.alarmDocId})`);
        } else {
          // Fallback: resolve any matching unresolved docs for this device+param
          await this.resolveMatchingTestAlarms(test.config.deviceId, test.config.parameterName);
        }
      }
    } catch (e) {
      console.warn('[TestAlarm] Failed to create Firestore test resolution:', e);
    }
  }

  /**
   * Resolve matching unresolved test alarms by device+parameter (best-effort)
   */
  private async resolveMatchingTestAlarms(deviceId: string, parameterName: string): Promise<number> {
    if (!firestoreDB) return 0;
    const q = query(
      collection(firestoreDB, 'alarms'),
      where('type', '==', 'test-alarm'),
      where('deviceId', '==', deviceId),
      where('parameterName', '==', parameterName)
    );
    const snap = await getDocs(q);
    const unresolved = snap.docs.filter(d => !(d.data() as any).resolved);
    await Promise.all(unresolved.map(d => updateDoc(d.ref, { resolved: true, resolvedAt: Timestamp.now() })));
    if (unresolved.length > 0) {
      console.log(`[TestAlarm] Resolved ${unresolved.length} matching Firestore test alarms for ${deviceId}:${parameterName}`);
    }
    return unresolved.length;
  }

  /**
   * Resolve all Firestore test alarms for a device (or all devices if not provided)
   */
  async resolveAllTestAlarmsFirestore(deviceId?: string, parameterName?: string): Promise<number> {
    try {
      if (!firestoreDB) return 0;
      let q = query(collection(firestoreDB, 'alarms'), where('type', '==', 'test-alarm')) as any;
      if (deviceId) {
        const { query: qf, where: wf } = await import('firebase/firestore');
        q = qf(q, wf('deviceId', '==', deviceId));
        if (parameterName) {
          q = qf(q, wf('parameterName', '==', parameterName));
        }
      }
      const snap = await getDocs(q);
      const toResolve = snap.docs.filter(d => !(d.data() as any).resolved);
      await Promise.all(toResolve.map(d => updateDoc(d.ref, { resolved: true, resolvedAt: Timestamp.now() })));
      if (toResolve.length > 0) {
        console.log(`[TestAlarm] Resolved ${toResolve.length} Firestore test alarms${deviceId ? ' for device ' + deviceId : ''}`);
      }
      return toResolve.length;
    } catch (e) {
      console.warn('[TestAlarm] Failed to resolve Firestore test alarms:', e);
      return 0;
    }
  }

  /**
   * Clear a specific test alarm without resolution
   */
  clearTestAlarm(key: string): void {
    const test = this.activeTests.get(key);
    if (!test) return;

    clearTimeout(test.timeoutId);
    this.activeTests.delete(key);
    console.log(`[TestAlarm] Cleared test for ${test.config.parameterName}`);
  }

  /**
   * Clear all active test alarms
   */
  clearAllTests(): void {
    console.log(`[TestAlarm] Clearing all ${this.activeTests.size} active tests`);
    for (const [key] of this.activeTests) {
      this.clearTestAlarm(key);
    }
  }

  /**
   * Get active test keys
   */
  getActiveTests(): string[] {
    return Array.from(this.activeTests.keys());
  }

  /**
   * Check if a parameter is currently being tested
   */
  isParameterUnderTest(deviceId: string, parameterName: string): boolean {
    const key = `${deviceId}:${parameterName}`;
    return this.activeTests.has(key);
  }

  /**
   * Force cleanup of stuck/hanging test alarms
   */
  forceCleanupStuckTests(): number {
    const now = Date.now();
    const maxTestDuration = 25000; // 25 seconds max (5s buffer beyond normal 20s)
    let cleanedCount = 0;

    for (const [key, test] of this.activeTests.entries()) {
      const elapsed = now - test.startTime;
      if (elapsed > maxTestDuration) {
        console.warn(`[TestAlarm] Force cleaning stuck test: ${key} (${elapsed}ms elapsed)`);
        clearTimeout(test.timeoutId);
        this.activeTests.delete(key);
        
        // Dispatch force resolution event
        try {
          const resolveEvent = new CustomEvent('alarm-toast', {
            detail: {
              deviceId: test.config.deviceId,
              parameterName: test.config.parameterName,
              alarmType: test.config.alarmType,
              resolved: true,
              isTest: true
            }
          });
          window.dispatchEvent(resolveEvent);
        } catch (e) {
          console.error('[TestAlarm] Failed to dispatch force resolve event:', e);
        }
        
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[TestAlarm] Force cleaned ${cleanedCount} stuck tests`);
    }

    return cleanedCount;
  }

  /**
   * Start automatic cleanup interval
   */
  private startCleanupInterval(): void {
    if (this.cleanupInterval) return; // Already running

    this.cleanupInterval = setInterval(() => {
      this.forceCleanupStuckTests();
      
      // Stop interval if no active tests
      if (this.activeTests.size === 0) {
        this.stopCleanupInterval();
      }
    }, 5000); // Check every 5 seconds

    console.log('[TestAlarm] Started automatic cleanup monitoring');
  }

  /**
   * Stop automatic cleanup interval
   */
  private stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[TestAlarm] Stopped automatic cleanup monitoring');
    }
  }

  /**
   * Emergency: clear ALL test alarms immediately
   */
  emergencyStopAll(): void {
    console.warn(`[TestAlarm] EMERGENCY STOP: Clearing all ${this.activeTests.size} active tests`);
    
    for (const [, test] of this.activeTests.entries()) {
      clearTimeout(test.timeoutId);
      
      // Dispatch resolution events
      try {
        const resolveEvent = new CustomEvent('alarm-toast', {
          detail: {
            deviceId: test.config.deviceId,
            parameterName: test.config.parameterName,
            alarmType: test.config.alarmType,
            resolved: true,
            isTest: true
          }
        });
        window.dispatchEvent(resolveEvent);
      } catch (e) {
        console.error('[TestAlarm] Failed to dispatch emergency resolve event:', e);
      }
    }

    this.activeTests.clear();
    this.stopCleanupInterval();
  }
}

// Export singleton instance
export const testAlarmManager = new TestAlarmManager();

// Export convenience function for easy use in components
export const startTestAlarm = (config: TestAlarmConfig) => {
  testAlarmManager.startTestAlarm(config);
};

export const clearAllTestAlarms = () => {
  testAlarmManager.clearAllTests();
};

// Export emergency functions for debugging
export const forceCleanupStuckTests = () => {
  return testAlarmManager.forceCleanupStuckTests();
};

export const emergencyStopAllTests = () => {
  testAlarmManager.emergencyStopAll();
};

// Add to global window for emergency debugging - use a timeout to ensure everything is loaded
if (typeof window !== 'undefined') {
  setTimeout(() => {
    try {
      (window as any).testAlarmManager = testAlarmManager;
      (window as any).emergencyStopAllTests = emergencyStopAllTests;
      (window as any).forceCleanupStuckTests = forceCleanupStuckTests;
      
      // Also create a simple emergency stop function that works immediately
      (window as any).stopAllAlarms = () => {
        // Clear all alarm-related CSS classes
        document.querySelectorAll('[data-param-id]').forEach(el => {
          el.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
          (el as HTMLElement).style.removeProperty('opacity');
        });
        
        // Dispatch resolved events for all possible test alarms
        document.querySelectorAll('[data-param-id]').forEach(el => {
          const paramName = el.getAttribute('data-param-id');
          if (paramName) {
            try {
              const resolveEvent = new CustomEvent('alarm-toast', {
                detail: {
                  deviceId: 'emergency',
                  parameterName: paramName,
                  alarmType: 'high',
                  resolved: true,
                  isTest: true
                }
              });
              window.dispatchEvent(resolveEvent);
            } catch {}
          }
        });
        
        console.log('[Emergency] Forcefully stopped all alarms and cleared all CSS');
      };
      
      console.log('[TestAlarmSystem] Emergency functions attached to window object');
    } catch (e) {
      console.warn('[TestAlarmSystem] Failed to attach emergency functions to window:', e);
    }
  }, 100);
}

import { useCallback, useRef, useEffect, useState } from 'react';
import { useStoveStore } from '../store/useStoveStore';
import { useFirebaseConnection } from './useFirebase';
import type { ParameterInfo } from '../types';

interface UseAlarmNavigationProps {
  onExpandCategory?: (categoryName: string) => void;
  onCloseNotificationHistory?: () => void;
}

interface UseAlarmNavigationResult {
  navigateToAlarmParameter: (deviceId: string, parameterName: string) => Promise<void>;
}

export const useAlarmNavigation = ({
  onExpandCategory,
  onCloseNotificationHistory
}: UseAlarmNavigationProps = {}): UseAlarmNavigationResult => {
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentData = useStoveStore(state => state.currentData);
  const currentDeviceId = useStoveStore(state => state.deviceId);
  const connectionStatus = useStoveStore(state => state.connectionStatus);
  const { connect, disconnect } = useFirebaseConnection();
  
  // Track test alarms separately to prevent auto-clearing
  const [activeTestAlarms, setActiveTestAlarms] = useState<Set<string>>(new Set());

  const checkParameterAlarmState = useCallback((param: ParameterInfo): 'normal' | 'low' | 'high' => {
    const raw = (currentData as any)[param.originalName];
    if (raw === undefined || raw === null) return 'normal';

    const isEnabled = Boolean((param as any).isAlarmEnabled);
    if (!isEnabled) return 'normal';

    const minThr = (param as any).alarmMinThreshold;
    const maxThr = (param as any).alarmMaxThreshold;
    const value = Number(raw);
    if (!isFinite(value)) return 'normal';

    if (typeof minThr === 'number' && value < minThr) return 'low';
    if (typeof maxThr === 'number' && value > maxThr) return 'high';
    return 'normal';
  }, [currentData]);

  // Track Firestore test alarms through direct events instead of hook to avoid circular dependency
  useEffect(() => {
    const handleFirestoreTestAlarm = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.isFirestoreTest) return;
      
      const { deviceId, parameterName, resolved, alarmType } = detail;
      if (deviceId !== currentDeviceId) return;

      const el = document.querySelector(`[data-param-id="${parameterName}"]`) as HTMLElement | null;
      if (!el) return;

      if (resolved) {
        // Remove test alarm highlighting
        el.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
        el.style.removeProperty('opacity');
        setActiveTestAlarms(prev => {
          const newSet = new Set(prev);
          newSet.delete(parameterName);
          return newSet;
        });
        console.log(`[AlarmNavigation] Firestore test alarm resolved for ${parameterName}`);
      } else {
        // Apply test alarm highlighting
        const cls = alarmType === 'low' ? 'alarm-highlight-low' : 'alarm-highlight-high';
        el.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
        el.classList.add(cls, 'alarm-opacity-override');
        setActiveTestAlarms(prev => new Set(prev).add(parameterName));
        console.log(`[AlarmNavigation] Firestore test alarm activated for ${parameterName}`);
      }
    };

    window.addEventListener('firestore-test-alarm', handleFirestoreTestAlarm);
    return () => window.removeEventListener('firestore-test-alarm', handleFirestoreTestAlarm);
  }, [currentDeviceId]);

  // COMPLETELY REWRITTEN: Only CSS classes, NEVER touch inline opacity, respect test alarms
  const autoHighlightOutOfRange = useCallback(() => {
    try {
      const params = useStoveStore.getState().discoveredParameters;
      params.forEach((param) => {
        const paramName = param.originalName;
        
        // Skip auto-clearing for active test alarms
        if (activeTestAlarms.has(paramName)) {
          console.log(`[AlarmNavigation] Skipping auto-highlight for test alarm: ${paramName}`);
          return;
        }
        
        const state = checkParameterAlarmState(param);
        const el = document.querySelector(`[data-param-id="${paramName}"]`) as HTMLElement | null;
        if (!el) return;

        // Always remove all alarm classes first (but only for non-test alarms)
        el.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');

        if (state === 'normal') {
          // Completely normal: remove any inline opacity we might have set
          el.style.removeProperty('opacity');
          return;
        }

        // Apply alarm highlight - ONLY CSS classes, no inline styles
        const className = state === 'high' ? 'alarm-highlight-high' : 'alarm-highlight-low';
        el.classList.add(className, 'alarm-opacity-override');
      });
    } catch (e) {
      // noop
    }
  }, [checkParameterAlarmState, activeTestAlarms]);

  // Listen to global tick to auto-highlight
  useEffect(() => {
    const handler = () => autoHighlightOutOfRange();
    window.addEventListener('rigwatch-auto-highlight-tick', handler as EventListener);
    return () => window.removeEventListener('rigwatch-auto-highlight-tick', handler as EventListener);
  }, [autoHighlightOutOfRange]);

  // Listen to parameter settings changes (when alarm settings are updated)
  useEffect(() => {
    const handler = () => {
      console.log('[AlarmNavigation] Parameter settings changed, re-checking alarm states');
      autoHighlightOutOfRange();
    };
    window.addEventListener('parameterSettingsChanged', handler as EventListener);
    return () => window.removeEventListener('parameterSettingsChanged', handler as EventListener);
  }, [autoHighlightOutOfRange]);

  // REWRITTEN: alarm-toast handler with special logic for test alarms
  useEffect(() => {
    const onAlarmToast = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const { deviceId, parameterName, resolved, alarmType, isTest } = detail as { 
          deviceId: string; 
          parameterName: string; 
          resolved?: boolean; 
          alarmType?: 'high' | 'low' | 'recovered'; 
          isTest?: boolean 
        };
        
        // Only handle current device
        const currentId = useStoveStore.getState().deviceId;
        if (currentId && deviceId && currentId !== deviceId) return;

        const el = document.querySelector(`[data-param-id="${parameterName}"]`) as HTMLElement | null;
        if (!el) {
          // Fallback: run global check only for non-test alarms
          if (!isTest) {
            autoHighlightOutOfRange();
          }
          return;
        }

        if (isTest) {
          // Special handling for test alarms - they don't auto-clear via data checking
          if (resolved) {
            el.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
            el.style.removeProperty('opacity');
            setActiveTestAlarms(prev => {
              const newSet = new Set(prev);
              newSet.delete(parameterName);
              return newSet;
            });
            console.log(`[AlarmNavigation] Test alarm resolved for ${parameterName}`);
          } else {
            const cls = alarmType === 'low' ? 'alarm-highlight-low' : 'alarm-highlight-high';
            el.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
            el.classList.add(cls, 'alarm-opacity-override');
            setActiveTestAlarms(prev => new Set(prev).add(parameterName));
            console.log(`[AlarmNavigation] Test alarm activated for ${parameterName}`);
          }
        } else {
          // Regular alarm handling
          if (resolved) {
            el.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
            el.style.removeProperty('opacity');
          } else {
            const cls = alarmType === 'low' ? 'alarm-highlight-low' : 'alarm-highlight-high';
            el.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
            el.classList.add(cls, 'alarm-opacity-override');
          }
        }
      } catch {
        autoHighlightOutOfRange();
      }
    };
    window.addEventListener('alarm-toast', onAlarmToast as EventListener);
    return () => window.removeEventListener('alarm-toast', onAlarmToast as EventListener);
  }, [autoHighlightOutOfRange]);

  // REWRITTEN: simplified continuous highlight with ONLY CSS classes
  const startContinuousHighlight = useCallback((parameterElement: HTMLElement, param: ParameterInfo) => {
    // Clear any existing highlight timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    // Store original transition for restoration
    const originalTransition = parameterElement.style.transition || '';

    const checkAndUpdateHighlight = () => {
      const alarmState = checkParameterAlarmState(param);
      
      if (alarmState === 'normal') {
        // Parameter is back to normal, completely restore
        parameterElement.style.transition = originalTransition;
        parameterElement.style.removeProperty('opacity');
        parameterElement.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
        
        // Clear the continuous check
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
          highlightTimeoutRef.current = null;
        }
        
        console.log(`[AlarmNavigation] Clearing highlight for ${param.originalName} - back to normal`);
        return;
      }

      // Apply alarm highlighting with ONLY CSS classes (no inline opacity!)
      const className = alarmState === 'high' ? 'alarm-highlight-high' : 'alarm-highlight-low';
      parameterElement.classList.remove('alarm-highlight-high', 'alarm-highlight-low', 'alarm-opacity-override');
      parameterElement.classList.add(className, 'alarm-opacity-override');
      parameterElement.style.transition = 'all 0.5s ease-in-out';

      console.log(`[AlarmNavigation] Highlighting ${param.originalName} - state: ${alarmState}`);

      // Schedule next check (fast reaction)
      highlightTimeoutRef.current = setTimeout(checkAndUpdateHighlight, 300);
    };

    // Start the continuous check
    checkAndUpdateHighlight();
  }, [checkParameterAlarmState]);

  const navigateToAlarmParameter = useCallback(async (deviceId: string, parameterName: string) => {
    console.log(`[AlarmNavigation] Navigating to alarm parameter: ${parameterName} on device: ${deviceId}`);

    try {
      // Step 1: Close notification history if open
      if (onCloseNotificationHistory) {
        onCloseNotificationHistory();
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Step 2: Check if we need to switch devices
      if (currentDeviceId !== deviceId) {
        console.log(`[AlarmNavigation] Switching from device ${currentDeviceId} to ${deviceId}`);
        
        // Disconnect from current device if connected
        if (currentDeviceId && connectionStatus !== 'offline') {
          console.log(`[AlarmNavigation] Disconnecting from current device: ${currentDeviceId}`);
          disconnect();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Connect to target device
        console.log(`[AlarmNavigation] Connecting to target device: ${deviceId}`);
        connect(deviceId);

        // Wait for connection and data to stabilize
        console.log(`[AlarmNavigation] Waiting for connection to stabilize...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check if connection was successful
        const finalStatus = useStoveStore.getState().connectionStatus;
        if (finalStatus !== 'online') {
          console.warn(`[AlarmNavigation] Failed to connect to device ${deviceId}, status: ${finalStatus}`);
          return;
        }
      }

      // Step 3: Find the parameter by name (displayName or originalName)
      // Need to get fresh parameters after potential device switch
      const currentParameters = useStoveStore.getState().discoveredParameters;
      const parameter = currentParameters.find(param => 
        param.originalName === parameterName || 
        param.displayName === parameterName
      );

      if (!parameter) {
        console.warn(`[AlarmNavigation] Parameter not found: ${parameterName} in device ${deviceId}`);
        return;
      }

      // Step 4: Get category and expand if needed
      const categoryName = (parameter as any).kategorie || 'uncategorized';
      if (onExpandCategory) {
        onExpandCategory(categoryName);
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Step 5: Find the parameter element
      const parameterElement = document.querySelector(`[data-param-id="${parameter.originalName}"]`) as HTMLElement;
      
      if (!parameterElement) {
        console.warn(`[AlarmNavigation] Parameter element not found: ${parameter.originalName}`);
        return;
      }

      // Step 6: Scroll to the parameter with smooth animation
      parameterElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });

      // Step 7: Wait for scroll and start continuous alarm highlight
      await new Promise(resolve => setTimeout(resolve, 500));
      startContinuousHighlight(parameterElement, parameter);

    } catch (error) {
      console.error('[AlarmNavigation] Error navigating to alarm parameter:', error);
    }
  }, [currentDeviceId, connectionStatus, connect, disconnect, onExpandCategory, onCloseNotificationHistory, startContinuousHighlight]);

  return {
    navigateToAlarmParameter
  };
};

export default useAlarmNavigation;

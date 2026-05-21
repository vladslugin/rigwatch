import { useEffect, useRef, useCallback } from 'react';
import { useStoveStore } from '../store/useStoveStore';
import type { ParameterInfo } from '../types';

type AlarmState = 'normal' | 'low' | 'high';

export const useAlarmNotifications = () => {
  const deviceId = useStoveStore(state => state.deviceId);
  const currentData = useStoveStore(state => state.currentData);
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);

  // Track last alarm state to fire only on transitions for highlighting
  const lastStateRef = useRef<Record<string, AlarmState>>({});

  // Check alarm states and fire events
  const checkAlarmStates = useCallback(() => {
    if (!deviceId || !currentData || Object.keys(currentData).length === 0) {
      // Clear all alarm highlights when disconnected
      Object.keys(lastStateRef.current).forEach(paramId => {
        const lastState = lastStateRef.current[paramId];
        if (lastState !== 'normal') {
          try {
            const evt = new CustomEvent('alarm-toast', { 
              detail: { 
                deviceId: deviceId || 'unknown', 
                parameterName: paramId, 
                alarmType: lastState, 
                resolved: true 
              } 
            });
            window.dispatchEvent(evt);
          } catch {}
        }
      });
      lastStateRef.current = {};
      return;
    }

    discoveredParameters.forEach((param: ParameterInfo) => {
      const paramId = param.originalName;
      const raw = (currentData as any)[paramId];
      if (raw === undefined || raw === null) return;

      const isEnabled = Boolean((param as any).isAlarmEnabled);
      const minThr = (param as any).alarmMinThreshold;
      const maxThr = (param as any).alarmMaxThreshold;
      const value = Number(raw);
      if (!isFinite(value)) return;

      let state: AlarmState = 'normal';
      // Only check thresholds if alarm is enabled
      if (isEnabled) {
        if (typeof minThr === 'number' && value < minThr) state = 'low';
        if (typeof maxThr === 'number' && value > maxThr) state = state === 'low' ? 'low' : 'high';
      }

      const last = lastStateRef.current[paramId] || 'normal';
      
      // If alarm was disabled or thresholds changed, force clear highlighting
      if (!isEnabled && last !== 'normal') {
        console.log(`[AlarmNotifications] Alarm disabled for ${paramId}, clearing highlight`);
        try {
          const evt = new CustomEvent('alarm-toast', { 
            detail: { 
              deviceId, 
              parameterName: paramId, 
              alarmType: last, 
              resolved: true 
            } 
          });
          window.dispatchEvent(evt);
        } catch {}
        lastStateRef.current[paramId] = 'normal';
        return;
      }

      if (state === last) return;

      // Fire highlighting events for parameter cards
      if (state === 'high' || state === 'low') {
        try {
          const evt = new CustomEvent('alarm-toast', { 
            detail: { 
              deviceId, 
              parameterName: paramId, 
              alarmType: state, 
              resolved: false 
            } 
          });
          window.dispatchEvent(evt);
        } catch {}
      } else if (last !== 'normal') {
        // Recovery to normal range - remove highlighting
        try {
          const evt = new CustomEvent('alarm-toast', { 
            detail: { 
              deviceId, 
              parameterName: paramId, 
              alarmType: last, 
              resolved: true 
            } 
          });
          window.dispatchEvent(evt);
        } catch {}
      }

      lastStateRef.current[paramId] = state;
    });
  }, [deviceId, currentData, discoveredParameters]);

  // Check on data/parameters change
  useEffect(() => {
    checkAlarmStates();
  }, [checkAlarmStates]);

  // Also check when parameter settings change (alarm enable/disable, threshold changes)
  useEffect(() => {
    const handleSettingsChange = () => {
      console.log('[AlarmNotifications] Parameter settings changed, re-checking alarm states');
      checkAlarmStates();
    };
    window.addEventListener('parameterSettingsChanged', handleSettingsChange);
    return () => window.removeEventListener('parameterSettingsChanged', handleSettingsChange);
  }, [checkAlarmStates]);
};


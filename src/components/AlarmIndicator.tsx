import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useStoveStore } from '../store/useStoveStore';
import { useGlobalAlarms } from '../hooks/useGlobalAlarms';
import type { ParameterInfo } from '../types';
import { soundManager } from '../utils/soundManager';

interface AlarmIndicatorProps {
  onExpandCategory?: (categoryName: string) => void;
}

interface ActiveAlarm {
  paramId: string;
  displayName: string;
  value: number;
  threshold: number;
  type: 'high' | 'low';
  categoryName: string;
  isTest?: boolean; // NEW: mark test alarms
}

const AlarmIndicator: React.FC<AlarmIndicatorProps> = ({ onExpandCategory }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasPlayedSound, setHasPlayedSound] = useState(false);
  // Keep for potential backward compatibility (not directly used in render)
  const [, setTestAlarms] = useState<Set<string>>(new Set());
  const [testExpiryByParam, setTestExpiryByParam] = useState<Record<string, number>>({}); // param -> expiry ts
  const [nowTs, setNowTs] = useState<number>(Date.now());
  
  const deviceId = useStoveStore(state => state.deviceId);
  const currentData = useStoveStore(state => state.currentData);
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);
  
  // Get global alarms (including test alarms from Firestore)
  const { globalAlarms } = useGlobalAlarms();

  // Listen for test alarm events (local/initiator or same-device)
  useEffect(() => {
    const handleTestAlarm = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.isTest) return; // Only handle test alarms here
      
      const key = `${detail.deviceId}:${detail.parameterName}`;
      
      if (detail.resolved) {
        setTestAlarms(prev => {
          const newSet = new Set(prev);
          newSet.delete(key);
          return newSet;
        });
        // Clear local expiry for this parameter
        setTestExpiryByParam(prev => {
          const copy = { ...prev };
          delete copy[detail.parameterName];
          return copy;
        });
      } else {
        setTestAlarms(prev => new Set(prev).add(key));
        // Start 20s local timer from first detection
        setTestExpiryByParam(prev => {
          const existing = prev[detail.parameterName];
          const now = Date.now();
          if (!existing || existing <= now) {
            return { ...prev, [detail.parameterName]: now + 20000 };
          }
          return prev;
        });
      }
    };

    window.addEventListener('alarm-toast', handleTestAlarm);
    return () => window.removeEventListener('alarm-toast', handleTestAlarm);
  }, []);

  // Listen for Firestore-driven test events for this device (from useGlobalAlarms)
  useEffect(() => {
    const onFsTest = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (!d?.isFirestoreTest) return;
      if (d.deviceId !== deviceId) return;
      if (d.resolved) {
        setTestExpiryByParam(prev => {
          const copy = { ...prev };
          delete copy[d.parameterName];
          return copy;
        });
      } else {
        setTestExpiryByParam(prev => {
          const existing = prev[d.parameterName];
          const now = Date.now();
          if (!existing || existing <= now) {
            return { ...prev, [d.parameterName]: now + 20000 };
          }
          return prev;
        });
      }
    };
    window.addEventListener('firestore-test-alarm', onFsTest as EventListener);
    return () => window.removeEventListener('firestore-test-alarm', onFsTest as EventListener);
  }, [deviceId]);

  // Seed local timers when we see unresolved test docs (e.g., device joins mid-test)
  useEffect(() => {
    try {
      globalAlarms.forEach((ga: any) => {
        if (ga?.type !== 'test-alarm') return;
        if (ga?.deviceId !== deviceId) return;
        if (ga?.resolved) return;
        const paramName = ga?.parameterName;
        if (!paramName) return;
        setTestExpiryByParam(prev => {
          const existing = prev[paramName];
          const now = Date.now();
          if (!existing || existing <= now) {
            return { ...prev, [paramName]: now + 20000 };
          }
          return prev;
        });
      });
    } catch {}
  }, [globalAlarms, deviceId]);

  // Heartbeat to expire local test timers — 10s is precise enough for alarm expiry
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  // Check which parameters are currently in alarm state (real + test)
  const activeAlarms = useMemo((): ActiveAlarm[] => {
    if (!deviceId) return [];

    const alarms: ActiveAlarm[] = [];
    const addedParams = new Set<string>();
    
    // Real alarms - only if we have data
    if (currentData && Object.keys(currentData).length > 0) {
      discoveredParameters.forEach((param: ParameterInfo) => {
        const paramId = param.originalName;
        const raw = (currentData as any)[paramId];
        if (raw === undefined || raw === null) return;

        const isEnabled = Boolean((param as any).isAlarmEnabled);
        if (!isEnabled) return;

        const minThr = (param as any).alarmMinThreshold;
        const maxThr = (param as any).alarmMaxThreshold;
        const value = Number(raw);
        if (!isFinite(value)) return;

        let alarmType: 'high' | 'low' | null = null;
        let threshold: number = 0; // Initialize threshold
        
        if (typeof minThr === 'number' && value < minThr) {
          alarmType = 'low';
          threshold = minThr;
        } else if (typeof maxThr === 'number' && value > maxThr) {
          alarmType = 'high';
          threshold = maxThr;
        }

        if (alarmType) {
          alarms.push({
            paramId,
            displayName: param.displayName || param.originalName,
            value,
            threshold,
            type: alarmType,
            categoryName: (param as any).kategorie || 'uncategorized',
            isTest: false
          });
          addedParams.add(paramId);
        }
      });
    }

    // Add test alarms based on local expiry map (per-device timers)
    Object.entries(testExpiryByParam).forEach(([paramName, expiry]) => {
      if (expiry <= nowTs) return; // expired
      if (addedParams.has(paramName)) return; // already present as real alarm
      const param = discoveredParameters.find(p => p.originalName === paramName);
      if (!param) return;
      alarms.push({
        paramId: paramName,
        displayName: param.displayName || param.originalName,
        value: 999,
        threshold: 100,
        type: 'high',
        categoryName: (param as any).kategorie || 'uncategorized',
        isTest: true
      });
    });

    return alarms;
  }, [deviceId, currentData, discoveredParameters, testExpiryByParam, nowTs]);

  // Remove auto-scroll-on-alarm. We scroll only when user clicks an item in the panel.

  // Play sound when new alarms appear (avoid beep on initial hydration)
  const initialRenderRef = React.useRef(true);
  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    if (activeAlarms.length > 0 && !hasPlayedSound) {
      // Play sound for most severe alarm type
      const hasHigh = activeAlarms.some(a => a.type === 'high');
      const hasLow = activeAlarms.some(a => a.type === 'low');
      
      if (hasHigh) {
        soundManager.playAlarmSound('high');
      } else if (hasLow) {
        soundManager.playAlarmSound('low');
      }
      setHasPlayedSound(true);
    } else if (activeAlarms.length === 0) {
      // Reset sound flag when no alarms
      setHasPlayedSound(false);
    }
  }, [activeAlarms.length, hasPlayedSound]);

  // Format alarm display text
  const formatAlarmDisplay = useCallback((alarm: ActiveAlarm) => {
    const name = alarm.displayName.length > 8 
      ? alarm.displayName.substring(0, 8) + '…' 
      : alarm.displayName;
    
    if (alarm.isTest) {
      return `${name} (TEST)`;
    }
    
    const formattedValue = Number.isInteger(alarm.value) 
      ? alarm.value.toString() 
      : alarm.value.toFixed(1);
    
    const formattedThreshold = Number.isInteger(alarm.threshold) 
      ? alarm.threshold.toString() 
      : alarm.threshold.toFixed(1);
    
    const operator = alarm.type === 'high' ? '>' : '<';
    
    return `${name} (${formattedValue} ${operator} ${formattedThreshold})`;
  }, []);

  // Utility: wait for element to appear in DOM (e.g., after category expand)
  const waitForElement = useCallback(async (selector: string, timeoutMs = 2000): Promise<HTMLElement | null> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) return el;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }, []);

  // Handle parameter click - expand category (if provided), then scroll and highlight briefly
  const handleParameterClick = useCallback(async (alarm: ActiveAlarm) => {
    try {
      // Ask parent to expand the category if possible
      if (onExpandCategory) {
        onExpandCategory(alarm.categoryName);
      } else {
        // Fire a global event as a fallback (parent may listen to it)
        try {
          const evt = new CustomEvent('hase-expand-category', { detail: { categoryName: alarm.categoryName } });
          window.dispatchEvent(evt);
        } catch {}
      }

      // Wait for the element to be present (in case category was collapsed)
      const selector = `[data-param-id="${alarm.paramId}"]`;
      const el = (document.querySelector(selector) as HTMLElement) || await waitForElement(selector, 2000);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        // Brief highlight for visual confirmation
        el.classList.add('parameter-highlight', 'parameter-highlight-pulse');
        setTimeout(() => {
          el.classList.remove('parameter-highlight-pulse');
          el.classList.remove('parameter-highlight');
        }, 1200);
        // Close the panel after initiating scroll
        setIsExpanded(false);
      }
    } catch (error) {
      console.error('[AlarmIndicator] Error navigating to parameter:', error);
    }
  }, [onExpandCategory, waitForElement]);

  // Don't render if no active alarms
  if (activeAlarms.length === 0) {
    return null;
  }

  return (
    <>
      {/* Compact Alarm Button */}
      <div 
        className={`fixed bottom-4 left-4 z-50 transition-all duration-300 ${
          isExpanded ? 'transform scale-110' : ''
        }`}
      >
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`
            px-3 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm font-medium rounded-lg shadow-lg
            border-2 border-destructive/70 transition-all duration-200
            animate-pulse hover:animate-none
            flex items-center space-x-2 max-w-xs
          `}
          title="Click to expand alarm details"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="truncate">
            {activeAlarms.length === 1 ? formatAlarmDisplay(activeAlarms[0]) : `${activeAlarms.length} alarms`}
          </span>
          <svg 
            className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Expanded Panel */}
        {isExpanded && (
          <div className="absolute bottom-full left-0 mb-2 bg-card rounded-xl shadow-xl border border-border p-4 min-w-80 max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center">
                <svg className="w-4 h-4 text-destructive mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                Active Alarms ({activeAlarms.length})
              </h3>
              <button
                onClick={() => setIsExpanded(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {activeAlarms.map((alarm) => (
                <button
                  key={alarm.paramId}
                  onClick={() => handleParameterClick(alarm)}
                  className={`
                    w-full text-left p-3 rounded-lg border transition-colors
                    ${alarm.type === 'high'
                      ? 'bg-destructive/5 border-destructive/30 hover:bg-destructive/10'
                      : 'bg-warning/5 border-warning/30 hover:bg-warning/10'
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className={`
                          inline-block w-2 h-2 rounded-full flex-shrink-0
                          ${alarm.type === 'high' ? 'bg-destructive' : 'bg-warning'}
                        `} />
                        <span className="font-medium text-foreground truncate">
                          {alarm.displayName}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {alarm.isTest ? (
                          <span className="text-primary font-medium">🧪 Test Alarm - Click to navigate</span>
                        ) : (
                          <>
                            Current: <span className="font-mono">{alarm.value}</span> | 
                            Threshold: <span className="font-mono">{alarm.threshold}</span> |
                            Category: {alarm.categoryName}
                          </>
                        )}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Click on any parameter to navigate to it
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default AlarmIndicator;

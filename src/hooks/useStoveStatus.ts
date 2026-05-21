import { useEffect, useState } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import { useStoveStore } from '../store/useStoveStore';

export interface ComponentError {
  code: string;
  description: string;
}

export interface StoveStatusData {
  temperature?: number;
  scheibenluft?: number;
  rueckwandluft?: number;
  brennphase?: number;
  motorAErrors: ComponentError[];
  motorBErrors: ComponentError[];
  sensorErrors: ComponentError[];
}

const BRENNPHASE_LABELS: Record<number, string> = {
  1: 'Anheizen',
  2: 'Abbrand',
  3: 'Nachlegen',
  4: 'Aufheizen',
  5: 'Ausgehen'
};

// Error code definitions
const ERROR_DEFINITIONS = {
  motorA: [
    { bit: 0, code: 'hakt', description: 'Hakt' },
    { bit: 1, code: 'dreht_durch', description: 'Dreht durch' },
    { bit: 2, code: 'kein_strom', description: 'Kein Strom', isE2: true },
  ],
  motorB: [
    { bit: 3, code: 'hakt', description: 'Hakt' },
    { bit: 4, code: 'dreht_durch', description: 'Dreht durch' },
    { bit: 5, code: 'kein_strom', description: 'Kein Strom', isE2: true },
  ],
  sensor: [
    { bit: 6, code: 'defekt', description: 'Temperatursensor defekt' },
  ]
};

export const useStoveStatus = () => {
  const deviceId = useStoveStore(state => state.deviceId);
  
  // FIXED: Get live data directly from store to ensure reactivity
  const temperature = useStoveStore(state => state.currentData.T);
  const scheibenluft = useStoveStore(state => state.currentData.PL);
  const rueckwandluft = useStoveStore(state => state.currentData.SL);
  const brennphase = useStoveStore(state => {
    const f = state.currentData.F;
    return typeof f === 'number' ? f : undefined;
  });
  
  const [componentErrors, setComponentErrors] = useState<{
    motorAErrors: ComponentError[];
    motorBErrors: ComponentError[];
    sensorErrors: ComponentError[];
  }>({
    motorAErrors: [],
    motorBErrors: [],
    sensorErrors: [],
  });

  // Subscribe to motor and sensor statuses from konstant_app/<id>
  useEffect(() => {
    if (!deviceId || !realtimeDB) {
      console.log('[useStoveStatus] No deviceId or realtimeDB');
      setComponentErrors({
        motorAErrors: [],
        motorBErrors: [],
        sensorErrors: [],
      });
      return;
    }

    console.log(`[useStoveStatus] Setting up status listeners for device: ${deviceId}`);

    // Listen to konstant_app for motor and sensor statuses
    const konstantAppRef = ref(realtimeDB, `konstant_app/${deviceId}`);

    const handleStatusUpdate = onValue(konstantAppRef, (snapshot) => {
      if (!snapshot.exists()) {
        console.log('[useStoveStatus] No konstant_app data found');
        setComponentErrors({
          motorAErrors: [],
          motorBErrors: [],
          sensorErrors: [],
        });
        return;
      }

      const data = snapshot.val();
      console.log('[useStoveStatus] konstant_app data:', data);

      // Check error codes
      const ecode = data.ecode ?? 0;
      const ecode2 = data.ecode2 ?? 0;

      // Collect Motor A errors
      const motorAErrors: ComponentError[] = [];
      ERROR_DEFINITIONS.motorA.forEach(({ bit, code, description, isE2 }) => {
        const errorValue = isE2 ? ecode2 : ecode;
        if ((errorValue & (1 << bit)) !== 0) {
          motorAErrors.push({ code, description });
        }
      });

      // Collect Motor B errors
      const motorBErrors: ComponentError[] = [];
      ERROR_DEFINITIONS.motorB.forEach(({ bit, code, description, isE2 }) => {
        const errorValue = isE2 ? ecode2 : ecode;
        if ((errorValue & (1 << bit)) !== 0) {
          motorBErrors.push({ code, description });
        }
      });

      // Collect Sensor errors
      const sensorErrors: ComponentError[] = [];
      ERROR_DEFINITIONS.sensor.forEach(({ bit, code, description }) => {
        if ((ecode & (1 << bit)) !== 0) {
          sensorErrors.push({ code, description });
        }
      });

      setComponentErrors({
        motorAErrors,
        motorBErrors,
        sensorErrors,
      });
    }, (error) => {
      console.error('[useStoveStatus] konstant_app listener error:', error);
    });

    // Cleanup function
    return () => {
      console.log(`[useStoveStatus] Cleaning up status listeners for device: ${deviceId}`);
      off(konstantAppRef, 'value', handleStatusUpdate);
    };
  }, [deviceId]);

  const getBrennphaseLabel = (phase?: number): string => {
    if (phase === undefined || phase === null) return '—';
    return BRENNPHASE_LABELS[phase] || `Phase ${phase}`;
  };

  return {
    temperature,
    scheibenluft,
    rueckwandluft,
    brennphase,
    brennphaseLabel: getBrennphaseLabel(brennphase),
    motorAErrors: componentErrors.motorAErrors,
    motorBErrors: componentErrors.motorBErrors,
    sensorErrors: componentErrors.sensorErrors,
  };
};


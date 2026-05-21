import { useMemo } from 'react';
import { useStoveStore } from '../store/useStoveStore';

export interface ErrorInfo {
  code: number;
  description: string;
  active: boolean;
}

// Error code definitions - defined outside hook to prevent recreation on each render
const ERROR_DEFINITIONS = {
  E: [
    { bit: 0, description: 'Motor A hakt' },
    { bit: 1, description: 'Motor A dreht durch' },
    { bit: 3, description: 'Motor B hakt' },
    { bit: 4, description: 'Motor B dreht durch' },
    { bit: 6, description: 'Temperatursensor defekt' },
  ],
  E2: [
    { bit: 2, description: 'Motor A kein Strom' },
    { bit: 5, description: 'Motor B kein Strom' },
  ]
} as const;

const decodeErrors = (eValue?: number, e2Value?: number): ErrorInfo[] => {
  const errorList: ErrorInfo[] = [];

  if (eValue !== undefined) {
    ERROR_DEFINITIONS.E.forEach(({ bit, description }) => {
      errorList.push({ code: bit, description, active: (eValue & (1 << bit)) !== 0 });
    });
  }

  if (e2Value !== undefined) {
    ERROR_DEFINITIONS.E2.forEach(({ bit, description }) => {
      errorList.push({ code: bit + 100, description, active: (e2Value & (1 << bit)) !== 0 });
    });
  }

  return errorList;
};

/**
 * Pure selector hook — reads error state from Zustand store.
 * Firebase listeners for ecode/ecode2 are set up once in useFirebase.ts.
 * Multiple calls to this hook are cheap and don't create duplicate listeners.
 */
export const useErrors = () => {
  const errorData = useStoveStore(state => state.errorData);

  const errors = useMemo(
    () => decodeErrors(errorData.ecode, errorData.ecode2),
    [errorData.ecode, errorData.ecode2]
  );

  const activeErrors = useMemo(
    () => errors.filter(e => e.active),
    [errors]
  );

  return {
    errors: activeErrors,
    hasErrors: activeErrors.length > 0,
    errorData,
  };
};

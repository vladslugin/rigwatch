/**
 * Time formatting utility for displaying millisecond values in various time formats
 */

export type TimeFormat = 
  | 'h-min-s-ms'     // 4h 23min 16s 23ms
  | 'h-min-s'        // 4h 23min 16s
  | 'min-s'          // 23min 16s
  | 'min-only'       // 263.43 min
  | 's-only'         // 15823.023 s
  | 'h-only'         // 4.25 h
  | 'ms-only';       // 15823023 ms

/**
 * Format time value into a human-readable time string
 * @param timeValue - Time value (after divisor is applied, in target unit)
 * @param format - Desired time format
 * @param decimalPlaces - Number of decimal places for single unit formats
 * @returns Formatted time string
 */
export function formatTimeValue(
  timeValue: number | undefined | null,
  format: TimeFormat,
  decimalPlaces: number = 2
): string {
  if (timeValue === undefined || timeValue === null || isNaN(timeValue)) {
    return '0';
  }
  
  if (!format) {
    console.warn('[formatTimeValue] Invalid format provided:', format);
    return '0';
  }

  // The timeValue is already in the target unit (after divisor applied)
  const sign = timeValue < 0 ? '-' : '';
  const absValue = Math.abs(timeValue);

  switch (format) {
    case 'h-min-s-ms': {
      // For complex formats, treat input as seconds and convert to components
      const totalSeconds = Math.floor(absValue);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const ms = Math.floor((absValue - totalSeconds) * 1000);
      
      const parts = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}min`);
      if (seconds > 0) parts.push(`${seconds}s`);
      if (ms > 0) parts.push(`${ms}ms`);
      
      return sign + (parts.length > 0 ? parts.join(' ') : '0s');
    }

    case 'h-min-s': {
      const totalSeconds = Math.floor(absValue);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      
      const parts = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}min`);
      if (seconds > 0) parts.push(`${seconds}s`);
      
      return sign + (parts.length > 0 ? parts.join(' ') : '0s');
    }

    case 'min-s': {
      const totalSeconds = Math.floor(absValue);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      
      const parts = [];
      if (minutes > 0) parts.push(`${minutes}min`);
      if (seconds > 0) parts.push(`${seconds}s`);
      
      return sign + (parts.length > 0 ? parts.join(' ') : '0s');
    }

    case 'min-only': {
      return sign + absValue.toFixed(decimalPlaces) + ' min';
    }

    case 's-only': {
      return sign + absValue.toFixed(decimalPlaces) + ' s';
    }

    case 'h-only': {
      return sign + absValue.toFixed(decimalPlaces) + ' h';
    }

    case 'ms-only':
    default: {
      return sign + Math.round(absValue) + ' ms';
    }
  }
}

/**
 * Get time format options for UI dropdowns
 */
export const TIME_FORMAT_OPTIONS = [
  { value: 'h-min-s-ms', label: 'Std, Min, Sek, Ms (4h 23min 16s 23ms)' },
  { value: 'h-min-s', label: 'Std, Min, Sek (4h 23min 16s)' },
  { value: 'min-s', label: 'Min, Sek (23min 16s)' },
  { value: 'min-only', label: 'Nur Minuten (263.43 min)' },
  { value: 's-only', label: 'Nur Sekunden (15823.02 s)' },
  { value: 'h-only', label: 'Nur Stunden (4.25 h)' },
  { value: 'ms-only', label: 'Nur Millisekunden (15823023 ms)' },
] as const;

/**
 * Calculate the appropriate divisor for time parameters
 * @param timeInputUnit - Unit of raw data (ms, s, min, h)
 * @param timeFormat - Target display format
 * @returns Calculated divisor
 */
export function calculateTimeDivisor(
  timeInputUnit: 'ms' | 's' | 'min' | 'h',
  timeFormat: TimeFormat
): number {
  // Base conversion factors to milliseconds
  const inputToMs: Record<string, number> = {
    'ms': 1,
    's': 1000,
    'min': 60 * 1000,
    'h': 60 * 60 * 1000
  };
  
  // Target unit for different formats
  // For complex formats (h-min-s-ms, h-min-s, min-s), we want seconds as base
  // For simple formats (xxx-only), we want the specific unit
  const formatTargetUnit: Record<TimeFormat, 'ms' | 's' | 'min' | 'h'> = {
    'h-min-s-ms': 's',  // Changed: complex format needs seconds as base
    'h-min-s': 's', 
    'min-s': 's',
    'min-only': 'min',
    's-only': 's',
    'h-only': 'h',
    'ms-only': 'ms'
  };
  
  const targetUnit = formatTargetUnit[timeFormat];
  const targetToMs = inputToMs[targetUnit];
  const inputMs = inputToMs[timeInputUnit];
  
  // Calculate divisor to convert from input unit to target unit
  const divisor = targetToMs / inputMs;
  
  console.log(`[calculateTimeDivisor] ${timeInputUnit} → ${timeFormat}:`, {
    inputUnit: timeInputUnit,
    targetFormat: timeFormat,
    targetUnit,
    inputMs,
    targetToMs,
    calculatedDivisor: divisor
  });
  
  return divisor;
}

/**
 * Check if a parameter should be treated as time data
 * @param parameter - Parameter info object
 * @returns true if parameter is configured as time data
 */
export function isTimeParameter(parameter: any): boolean {
  const result = Boolean(parameter?.isTimeData);
  // Quiet verbose logs in production; keep only when explicitly enabled
  // if (process.env.NODE_ENV === 'development' && parameter?.originalName) {
  //   console.log(`[isTimeParameter] ${parameter.originalName}: isTimeData=${parameter.isTimeData}, result=${result}`);
  // }
  return result;
}

/**
 * Get the time format for a parameter
 * @param parameter - Parameter info object
 * @returns TimeFormat or null if not a time parameter
 */
export function getParameterTimeFormat(parameter: any): TimeFormat | null {
  if (!isTimeParameter(parameter)) {
    return null;
  }
  
  return parameter.timeFormat || 'ms-only';
}

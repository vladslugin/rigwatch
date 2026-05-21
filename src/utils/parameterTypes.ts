import type { ParameterInfo } from '../types/firebase';
import { formatTimeValue, isTimeParameter, getParameterTimeFormat } from './timeFormatting';

export type DataType = 'float' | 'int' | 'bool' | 'string' | 'uint64_t';


/**
 * Gets the decimal separator setting from localStorage (enhanced version)
 */
function getDecimalSeparatorSetting(): boolean {
  try {
    // Read the decimal separator mode from localStorage
    // false = dot (3.14), true = comma (3,14)
    const saved = localStorage.getItem('hase-decimal-separator');
    return saved === 'true';
  } catch (error) {
    return false; // Default to dot
  }
}

/**
 * Applies decimal separator to formatted number string
 */
function applyDecimalSeparator(numberString: string): string {
  const useComma = getDecimalSeparatorSetting();
  if (useComma && numberString.includes('.')) {
    return numberString.replace('.', ',');
  }
  return numberString;
}

/**
 * Determines parameter data type (with backward compatibility)
 */
export function getParameterDataType(parameter: ParameterInfo | undefined | null): DataType {
  // 0. Check that parameter exists
  if (!parameter) {
    console.warn('[ParameterTypes] getParameterDataType called with undefined/null parameter');
    return 'float'; // Safe default value
  }

  // 1. If dataType is explicitly specified - use it
  if (parameter.dataType) {
    return parameter.dataType;
  }

  // 2. Auto-detect type based on parameters (backward compatibility)
  
  // Boolean: maxValue=1 and minValue=0
  if (parameter.maxValue === 1 && parameter.minValue === 0) {
    return 'bool';
  }
  
  // Integer: 
  // - originalName='N' (counter)
  // - divisor=1 and no unit
  // - form=1 (integer form)
  // - maxValue <= 10 and no unit (simple counters)
  if (parameter.originalName === 'N' || 
      (parameter.divisor === 1 && !parameter.unit) ||
      parameter.form === 1 ||
      (parameter.maxValue !== undefined && parameter.maxValue <= 10 && !parameter.unit)) {
    return 'int';
  }
  
  // Large integers: treat as regular int (uint64_t is deprecated)
  // - maxValue > 1000000 without unit
  // - originalName contains 'ID', 'TIME', 'STAMP'
  if ((parameter.maxValue !== undefined && parameter.maxValue > 1000000 && !parameter.unit) ||
      (parameter.originalName && /ID|TIME|STAMP|COUNTER|COUNT/i.test(parameter.originalName))) {
    return 'int';
  }
  
  // String: no unit and no min/max values
  if (!parameter.unit && 
      parameter.minValue === undefined && 
      parameter.maxValue === undefined) {
    return 'string';
  }
  
  // Float: default
  return 'float';
}

/**
 * Format parameter value considering data type
 */
export function formatParameterValue(
  value: number | string | boolean | undefined,
  parameter: ParameterInfo | undefined | null,
  precision: number = 2
): string {
  if (value === undefined || value === null || parameter === null || parameter === undefined) {
    return '-';
  }

  // Check if this is a time parameter first
  if (isTimeParameter(parameter)) {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      return String(value);
    }
    
    // Apply divisor normally - for time parameters it will be auto-calculated
    const divisor = parameter.divisor || 1;
    const adjustedValue = numValue / divisor;
    
    const timeFormat = getParameterTimeFormat(parameter);
    if (timeFormat) {
      const decimalPlaces = (parameter as any).decimalPlaces !== undefined 
        ? (parameter as any).decimalPlaces 
        : precision;
      
      // Quiet verbose logs; enable only when debugging
      // if (process.env.NODE_ENV === 'development') {
      //   console.log(`[formatParameterValue] Time parameter ${parameter.originalName}: value=${value}, divisor=${divisor}, adjustedValue=${adjustedValue}, timeFormat=${timeFormat}`);
      // }
      
      // For time parameters, the divisor is already applied, so adjustedValue is in the target unit
      // We just need to format it according to timeFormat
      const formattedTime = formatTimeValue(adjustedValue, timeFormat, decimalPlaces);
      return applyDecimalSeparator(formattedTime);
    } else {
      // console.warn(`[formatParameterValue] Time parameter ${parameter.originalName} has no timeFormat! isTimeData=${(parameter as any).isTimeData}, timeFormat=${(parameter as any).timeFormat}`);
      // Fallback to normal formatting
    }
  }

  const dataType = getParameterDataType(parameter);
  
  // Special handling for Boolean
  if (dataType === 'bool') {
    // Convert value to boolean
    const boolValue = Boolean(Number(value));
    return boolValue ? 'True' : 'False';
  }
  
  // String handling
  if (dataType === 'string') {
    return String(value);
  }
  
  // Numeric types
  const numValue = Number(value);
  if (isNaN(numValue)) {
    return String(value);
  }

  // Apply divisor if present
  const divisor = parameter.divisor || 1;
  const adjustedValue = numValue / divisor;

  // Format depending on type
  switch (dataType) {
    case 'int':
    case 'uint64_t': // Treat as integer
      return Math.round(adjustedValue).toString();
    case 'float':
    default:
      // Use parameter's decimalPlaces if specified, otherwise fall back to precision
      const decimalPlaces = (parameter as any).decimalPlaces !== undefined 
        ? (parameter as any).decimalPlaces 
        : precision;
      const formattedNumber = adjustedValue.toFixed(decimalPlaces);
      // Apply decimal separator setting
      return applyDecimalSeparator(formattedNumber);
  }
}

/**
 * Parses string value according to parameter type
 */
export function parseParameterValue(
  stringValue: string, 
  parameter: ParameterInfo | undefined | null
): number | string | boolean {
  // Check that parameter exists
  if (!parameter) {
    console.warn('[ParameterTypes] parseParameterValue called with undefined/null parameter');
    // Try to parse as number, otherwise as string
    const numValue = parseFloat(stringValue.replace(',', '.'));
    return isNaN(numValue) ? stringValue : numValue;
  }

  const dataType = getParameterDataType(parameter);
  
  switch (dataType) {
    case 'bool':
      // Boolean: 'true', '1', 'yes', 'on' -> true
      const lowerValue = stringValue.toLowerCase().trim();
      return lowerValue === 'true' || lowerValue === '1' || 
             lowerValue === 'yes' || lowerValue === 'on';

    case 'int':
    case 'uint64_t':
      // Integer: parse as number and round
      const intValue = parseFloat(stringValue.replace(',', '.'));
      return isNaN(intValue) ? 0 : Math.round(intValue);

    case 'string':
      // String: as is
      return stringValue;

    case 'float':
    default:
      // Float: parse with comma support
      const floatValue = parseFloat(stringValue.replace(',', '.'));
      return isNaN(floatValue) ? 0 : floatValue;
  }
}

/**
 * Gets HTML input type for parameter editing
 */
export function getInputTypeForParameter(parameter: ParameterInfo | undefined | null): string {
  // Check that parameter exists
  if (!parameter) {
    console.warn('[ParameterTypes] getInputTypeForParameter called with undefined/null parameter');
    return 'text'; // Safe default value
  }

  const dataType = getParameterDataType(parameter);
  
  switch (dataType) {
    case 'bool':
      return 'checkbox';
    case 'int':
    case 'uint64_t':
      return 'number';
    case 'float':
      return 'number';
    case 'string':
    default:
      return 'text';
  }
}

/**
 * Gets placeholder for input field
 */
export function getInputPlaceholderForParameter(parameter: ParameterInfo | undefined | null): string {
  // Check that parameter exists
  if (!parameter) {
    console.warn('[ParameterTypes] getInputPlaceholderForParameter called with undefined/null parameter');
    return 'value'; // Safe default value
  }

  const dataType = getParameterDataType(parameter);
  
  switch (dataType) {
    case 'bool':
      return 'true/false';
    case 'int':
    case 'uint64_t':
      return '0';
    case 'float':
      return '0.0';
    case 'string':
    default:
      return 'value';
  }
} 

/**
 * Helper function to get air flow values with fallback (uppercase first, then lowercase)
 * This handles the transition from lowercase field names to uppercase field names in Firebase
 */
export const getAirFlowValue = (
  data: Record<string, any>,
  upperKey: string,
  lowerKey: string,
  defaultValue: number = 0
): number => {
  const upperValue = data[upperKey];
  const lowerValue = data[lowerKey];
  
  if (upperValue !== undefined && upperValue !== null) {
    return parseFloat(upperValue.toString());
  }
  if (lowerValue !== undefined && lowerValue !== null) {
    return parseFloat(lowerValue.toString());
  }
  return defaultValue;
};

/**
 * Helper function to get PL (Screen Air) values with proper fallback
 */
export const getPLValues = (data: Record<string, any>) => ({
  winkel: getAirFlowValue(data, 'PL_WINKEL', 'pl_winkel'),
  motorWinkel: getAirFlowValue(data, 'PL_MOTOR_WINKEL', 'pl_motor_winkel'),
  prozent: getAirFlowValue(data, 'PL_PROZENT', 'pl_prozent'),
});

/**
 * Helper function to get SL (Rear Air) values with proper fallback
 */
export const getSLValues = (data: Record<string, any>) => ({
  winkel: getAirFlowValue(data, 'SL_WINKEL', 'sl_winkel'),
  motorWinkel: getAirFlowValue(data, 'SL_MOTOR_WINKEL', 'sl_motor_winkel'),
  prozent: getAirFlowValue(data, 'SL_PROZENT', 'sl_prozent'),
});

/**
 * Helper function to get RL (Grate Air) values with proper fallback
 */
export const getRLValues = (data: Record<string, any>) => ({
  winkel: getAirFlowValue(data, 'RL_WINKEL', 'rl_winkel'),
  prozent: getAirFlowValue(data, 'RL_PROZENT', 'rl_prozent'),
}); 
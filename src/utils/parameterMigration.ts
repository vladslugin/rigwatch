import type { ParameterInfo, ParameterMetadata } from '../types/firebase';
import { getParameterDataType } from './parameterTypes';

/**
 * Suggests data type for an existing parameter based on its properties
 */
export function suggestDataTypeForParameter(parameter: ParameterInfo): 'float' | 'int' | 'bool' | 'string' {
  // If type is already set - use it
  if (parameter.dataType) {
    return parameter.dataType;
  }

  // Logic for determining type based on existing properties
  const autoDetectedType = getSmartDataType(parameter);
  
  console.log(`[Migration] Suggested dataType for ${parameter.originalName}: ${autoDetectedType}`, {
    originalName: parameter.originalName,
    minValue: parameter.minValue,
    maxValue: parameter.maxValue,
    unit: parameter.unit,
    divisor: parameter.divisor,
    form: parameter.form,
    suggestedType: autoDetectedType
  });

  return autoDetectedType;
}

/**
 * Creates update object for migrating parameter to new type system
 */
export function createMigrationUpdate(parameter: ParameterInfo): Partial<ParameterMetadata> | null {
  // If type is already set - migration not needed
  if (parameter.dataType) {
    return null;
  }

  const suggestedType = suggestDataTypeForParameter(parameter);
  
  return {
    dataType: suggestedType
  };
}

/**
 * Enhanced system for auto-detecting data types based on parameter characteristics
 * Without hardcoded exceptions - all logic is based on parameter metadata
 */
export function getSmartDataType(parameter: ParameterInfo): 'float' | 'int' | 'bool' | 'string' {
  // 1. Boolean: clear signs of boolean type
  if (parameter.maxValue === 1 && parameter.minValue === 0 && (parameter.divisor === undefined || parameter.divisor === 1)) {
    return 'bool';
  }

  // 2. String: no numeric constraints and no units
  if (parameter.minValue === undefined && parameter.maxValue === undefined && !parameter.unit) {
    return 'string';
  }

  // 3. Integer: integer characteristics
  if (
    // Divisor equals 1 (no fractional part)
    (parameter.divisor === undefined || parameter.divisor === 1) &&
    // Either unit indicates whole numbers
    (parameter.unit === '1' || parameter.unit === '' || parameter.unit === undefined ||
     parameter.unit === '°' || parameter.unit === 's' || parameter.unit === 'min') &&
    // Or value range indicates whole numbers
    (parameter.maxValue !== undefined && parameter.maxValue <= 10000 && parameter.maxValue % 1 === 0)
  ) {
    return 'int';
  }

  // 4. Float: default for all other numeric parameters
  if (parameter.unit || parameter.minValue !== undefined || parameter.maxValue !== undefined) {
    return 'float';
  }

  // 5. Fallback: if nothing fits - float (safest option)
  return 'float';
}

/**
 * Returns recommended type for parameter based on smart logic
 */
export function getRecommendedType(parameter: ParameterInfo): 'float' | 'int' | 'bool' | 'string' {
  return getSmartDataType(parameter);
}

/**
 * Checks if migration is needed for the parameter
 */
export function needsMigration(parameter: ParameterInfo): boolean {
  // If type is already set - migration not needed
  if (parameter.dataType) {
    return false;
  }

  // Always suggest migration for parameters without type
  return true;
}

/**
 * Creates migration plan for list of parameters
 */
export function createMigrationPlan(parameters: ParameterInfo[]): Array<{
  parameterName: string;
  currentType: string;
  recommendedType: string;
  update: Partial<ParameterMetadata>;
}> {
  return parameters
    .filter(needsMigration)
    .map(param => {
      const currentType = getParameterDataType(param);
      const recommendedType = getRecommendedType(param);
      
      return {
        parameterName: param.originalName,
        currentType,
        recommendedType, 
        update: { dataType: recommendedType }
      };
    });
} 
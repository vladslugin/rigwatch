import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { ref, remove } from 'firebase/database';
import { useAuth } from '../hooks/useAuth';
import type { ParameterInfo } from '../types';
import { useParameterFormatting } from '../hooks/useParameterDiscovery';
import { getParameterDataType } from '../utils/parameterTypes';
import { isTimeParameter, getParameterTimeFormat } from '../utils/timeFormatting';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useRigStore, useNotificationHelpers } from '../store/useRigStore';
import { realtimeDB } from '../lib/firebase';
import { useTranslation } from 'react-i18next';

/**
 * Props for the ParameterGrid component
 */
interface ParameterGridProps {
  /** Array of parameter metadata */
  parameters: ParameterInfo[];
  /** Whether grid is in reorder/edit mode */
  isEditMode: boolean;
  /** Search filter string */
  searchTerm: string;
  /** Access level filter */
  filterAccess?: 'all' | 'readable' | 'writable';
  /** Callback when favorite status is toggled */
  onToggleFavorite: (paramId: string) => void;
  /** Callback when legend visibility is toggled */
  onToggleShowInLegend: (paramId: string, show: boolean) => void;
  /** Callback to open parameter settings editor */
  onEditParameter: (paramId: string) => void;
  /** Callback when parameters are reordered via drag-drop */
  onReorderParameters: (orderedParamIds: string[]) => void;
  /** Callback to change parameter value (for writable params) */
  onParameterValueChange?: (paramId: string, newValue: string) => Promise<boolean>;
  /** Category name for position persistence */
  categoryName?: string;
}

const DEFAULT_DECIMAL_PLACES = 2;
const DEFAULT_UNFAVORITE_OPACITY = 0.3;
const DEFAULT_HEADER_COLOR = '#3498db';
const CARD_MIN_HEIGHT_PX = 110;
const CARD_MAX_HEIGHT_PX = 120;
const GRID_MIN_COLUMN_WIDTH_PX = 160;
const FAVORITE_FLAG = 1;

const LOCAL_SETTINGS_CHANGED_EVENT = 'localSettingsChanged';
const USER_PREFERENCES_CHANGED_EVENT = 'userPreferencesChanged';
const DECIMAL_SEPARATOR_CHANGED_EVENT = 'decimalSeparatorChanged';

const getAccessString = (param: ParameterInfo) => String((param as any).zugriff || '');
const getDisplayName = (param: ParameterInfo) => param.displayName || param.originalName;

/**
 * Determines if a hex color is light or dark based on luminance.
 * @param color - Hex color string (e.g., '#FF0000')
 * @returns true if the color is light, false if dark
 */
const isColorLight = (color: string): boolean => {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // MAGIC: 0.5 threshold keeps text readable across legacy palette
  return luminance > 0.5;
};

/**
 * Props for the internal ParameterCard component
 */
interface ParameterCardProps {
  param: ParameterInfo;
  isEditMode: boolean;
  isDragging: boolean;
  isFavorite: boolean;
  unfavoriteOpacity: number;
  onToggleFavorite: (paramId: string) => void;
  onToggleShowInLegend: (paramId: string, show: boolean) => void;
  onEditParameter: (paramId: string) => void;
  onDeleteParameter?: (paramId: string) => void;
  onDragStart: (e: React.DragEvent, paramId: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetParamId: string) => void;
  onParameterValueChange?: (paramId: string, newValue: string) => Promise<boolean>;
  onHide?: (paramId: string) => void;
  decimalSeparatorVersion?: number;
}

/**
 * Renders the parameter icon based on its type.
 * Supports FontAwesome, emoji, legacy unicode, and fallback.
 */
const ParameterIcon: React.FC<{ icon?: string }> = React.memo(({ icon }) => {
  const iconClasses = "mr-2 opacity-80 text-xs";
  
  // No icon - show default tag
  if (!icon || icon.trim() === '') {
    return <i className={`fas fa-tag ${iconClasses}`} />;
  }
  
  // Legacy encoded Unicode sequence (backward compatibility)
  if (typeof icon === 'string' && icon.includes('\\u{')) {
    try {
      const decodedIcon = icon.replace(/\\u\{([^}]+)\}/g, (_m, hex) => {
        return String.fromCodePoint(parseInt(hex, 16));
      });
      return <span className={iconClasses}>{decodedIcon}</span>;
    } catch {
      return <i className={`fas fa-tag ${iconClasses}`} />;
    }
  }
  
  // FontAwesome icon validation
  const isFontAwesome = typeof icon === 'string' && 
    icon.startsWith('fa-') && 
    /^fa-[a-zA-Z0-9-]+$/.test(icon) &&
    icon.length > 3 &&
    !/[\u{1F000}-\u{1F9FF}]/u.test(icon);
  
  if (isFontAwesome) {
    return <i className={`fas ${icon} ${iconClasses}`} />;
  }
  
  // Everything else (emoji, text)
  return <span className={iconClasses}>{icon}</span>;
});

ParameterIcon.displayName = 'ParameterIcon';

/**
 * Individual parameter card with inline editing capabilities.
 * Memoized to prevent unnecessary re-renders.
 */
const ParameterCard = React.memo<ParameterCardProps>(({ 
  param, 
  isEditMode, 
  isDragging, 
  isFavorite, 
  unfavoriteOpacity, 
  onToggleFavorite, 
  onToggleShowInLegend, 
  onEditParameter, 
  onDeleteParameter,
  onDragStart, 
  onDragEnd, 
  onDragOver, 
  onDrop, 
  onParameterValueChange, 
  onHide, 
  decimalSeparatorVersion 
}) => {
  const value = useRigStore(state => state.currentData[param.originalName]);
  const { formatParameterValue } = useParameterFormatting();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();

  // Inline editing state
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editingValue, setEditingValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  
  // Refs for focus management and conflict detection
  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueSpanRef = useRef<HTMLSpanElement | null>(null);
  const initialEditingValueRef = useRef<string>('');
  const submittingRef = useRef(false);
  const lastKnownValueRef = useRef<number | string | boolean | undefined>(value);
  
  // Check if parameter has write access and user has edit permission
  const hasWriteAccess = useMemo(() => {
    const zugriff = getAccessString(param);
    const isWritable = zugriff && zugriff.includes('w');
    return isWritable && !!hasPermission('parameters.edit_values');
  }, [param, hasPermission]);
  
  // Format value for display (memoized for performance)
  const formattedValue = useMemo(() => {
    const processedValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    return formatParameterValue(processedValue, param);
  }, [value, param, decimalSeparatorVersion]);

  // Event handlers
  const handleFavoriteClick = useCallback(() => {
    onToggleFavorite(param.originalName);
  }, [param.originalName, onToggleFavorite]);

  const handleLegendToggle = useCallback(() => {
    onToggleShowInLegend(param.originalName, !param.show_in_legend);
  }, [param.originalName, param.show_in_legend, onToggleShowInLegend]);

  const handleEditClick = useCallback(() => {
    onEditParameter(param.originalName);
  }, [param.originalName, onEditParameter]);

  /**
   * Computes the current display value for editing.
   * Applies divisor and formats based on parameter type.
   */
  const computeCurrentDisplayValue = useCallback(() => {
    if (!hasWriteAccess || !onParameterValueChange) return '';
    
    if (value === undefined || value === null) return '';
    
    // Boolean parameters: convert to 0/1
    if (getParameterDataType(param) === 'bool') {
      return Boolean(Number(value)) ? '1' : '0';
    }
    
    const numValue = Number(value);
    if (isNaN(numValue)) {
      try {
        return value != null ? value.toString() : '';
      } catch {
        return '';
      }
    }
    
    const divisor = param.divisor || 1;
    const displayValue = numValue / divisor;
    
    // Time parameters: special formatting
    if (isTimeParameter(param)) {
      const timeFormat = getParameterTimeFormat(param);
      if (timeFormat?.endsWith('-only')) {
        const timeDecimalPlaces = (param as any).decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
        return displayValue.toFixed(timeDecimalPlaces);
      }
      return displayValue.toString();
    }
    
    // Standard number formatting
    const dataType = getParameterDataType(param);
    if (dataType === 'int') {
      return Math.round(displayValue).toString();
    }
    
    const decimalPlaces = (param as any).decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
    return displayValue.toFixed(decimalPlaces);
  }, [hasWriteAccess, onParameterValueChange, param, value]);

  // Enter inline edit mode
  const enterEditMode = useCallback(() => {
    if (!hasWriteAccess || !onParameterValueChange) return;
    const currentValue = computeCurrentDisplayValue();
    setHasConflict(false);
    setValidationError(null);
    setEditingValue(currentValue);
    initialEditingValueRef.current = currentValue;
    setIsEditingValue(true);
  }, [computeCurrentDisplayValue, hasWriteAccess, onParameterValueChange]);

  /**
   * Saves the edited value to the device.
   * Handles conversion from display value to raw value.
   */
  const handleValueSave = useCallback(async (options?: { keepFocus?: boolean }) => {
    if (!onParameterValueChange) return;
    
    // Don't submit if validation error
    if (validationError) {
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    
    // No-op if unchanged
    if (editingValue.trim() === initialEditingValueRef.current.trim()) {
      setIsEditingValue(false);
      setEditingValue('');
      setValidationError(null);
      setHasConflict(false);
      setTimeout(() => valueSpanRef.current?.focus(), 0);
      return;
    }

    try {
      submittingRef.current = true;
      setIsSaving(true);
      
      let valueToSend = editingValue;
      const dataType = getParameterDataType(param);
      
      // Convert display value back to raw value
      if (dataType !== 'bool' && dataType !== 'string') {
        const numValue = parseFloat(editingValue.replace(',', '.'));
        if (!isNaN(numValue)) {
          let finalValue = numValue;
          
          // Time parameters: convert back to raw unit
          if (isTimeParameter(param)) {
            const divisor = param.divisor || 1;
            finalValue = numValue * divisor;
          }
          
          valueToSend = dataType === 'int' 
            ? Math.round(finalValue).toString() 
            : finalValue.toString();
        }
      }
      
      const success = await onParameterValueChange(param.originalName, valueToSend);
      
      if (success) {
        setIsEditingValue(false);
        setEditingValue('');
        setValidationError(null);
        setHasConflict(false);
        if (!options?.keepFocus) {
          setTimeout(() => valueSpanRef.current?.focus(), 0);
        }
      } else {
        setValidationError(t('parameterGrid.saveFailed'));
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    } catch (error) {
      console.error(`[ParameterCard] Error saving ${param.originalName}:`, error);
      setValidationError(t('parameterGrid.networkError'));
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setIsSaving(false);
      setTimeout(() => { submittingRef.current = false; }, 0);
    }
  }, [editingValue, onParameterValueChange, param, validationError, t]);

  // Cancel editing and revert
  const handleValueCancel = useCallback(() => {
    setIsEditingValue(false);
    setEditingValue('');
    setValidationError(null);
    setHasConflict(false);
    setTimeout(() => valueSpanRef.current?.focus(), 0);
  }, []);

  // Keyboard navigation in edit mode
  const handleValueKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleValueSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleValueCancel();
    } else if (e.key === 'Tab') {
      handleValueSave({ keepFocus: true });
    }
  }, [handleValueSave, handleValueCancel]);

  /**
   * Validates the editing value synchronously.
   * Checks format, range, and required constraints.
   */
  const validateEditingValue = useCallback((raw: string): string | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return t('parameterGrid.validation.required') as string;
    
    const type = getParameterDataType(param);
    if (type === 'string') return null;
    
    const normalized = trimmed.replace(',', '.');
    const num = Number(normalized);
    if (Number.isNaN(num)) return t('parameterGrid.validation.invalidNumber') as string;
    
    // Validate against min/max (using raw values)
    const divisor = param.divisor || 1;
    const rawValue = num * divisor;
    
    if (param.minValue !== undefined && rawValue < (param.minValue as number)) {
      return t('parameterGrid.validation.minimum', { value: param.minValue }) as string;
    }
    if (param.maxValue !== undefined && rawValue > (param.maxValue as number)) {
      return t('parameterGrid.validation.maximum', { value: param.maxValue }) as string;
    }
    
    return null;
  }, [param, t]);

  // Handle input changes with validation
  const handleChange = useCallback((val: string) => {
    setEditingValue(val);
    setValidationError(validateEditingValue(val));
  }, [validateEditingValue]);

  // Auto-focus and select when entering edit mode
  useEffect(() => {
    if (isEditingValue && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch {}
    }
  }, [isEditingValue]);

  // Detect external value changes while editing (conflict detection)
  useEffect(() => {
    if (!isEditingValue) {
      lastKnownValueRef.current = value;
      return;
    }
    if (value !== lastKnownValueRef.current && !submittingRef.current) {
      setHasConflict(true);
    }
    lastKnownValueRef.current = value;
  }, [value, isEditingValue]);

  // Header styling based on parameter color
  const headerBackgroundColor = param.color || DEFAULT_HEADER_COLOR;
  const headerTextColor = isColorLight(headerBackgroundColor) ? '#333333' : '#FFFFFF';
  const titleString = getDisplayName(param);

  return (
    <div
      // `group` lets the footer icon row reveal on hover instead of always
      // taking up visual space. Border thinned from 2 to 1 to match every
      // other card in the project (DealerHeaderCard, ticket cards, etc.) —
      // the 2-px ring made the parameter grid look heavier than the rest.
      className={`metric-card group bg-card rounded border border-border p-3 ${
        isDragging ? 'opacity-50' : ''
      } ${
        isEditMode ? 'cursor-grab active:cursor-grabbing' : ''
      } ${
        !isFavorite ? 'non-favorite-card' : ''
      }`}
      style={{
        transform: isDragging ? 'scale(0.95)' : 'none',
        minHeight: `${CARD_MIN_HEIGHT_PX}px`,
        maxHeight: `${CARD_MAX_HEIGHT_PX}px`,
        ['--user-opacity' as any]: !isFavorite ? unfavoriteOpacity : 1,
        outline: isEditMode ? '2px dashed hsl(var(--primary))' : 'none',
        outlineOffset: isEditMode ? '2px' : '0'
      } as React.CSSProperties}
      draggable={isEditMode}
      onDragStart={(e) => onDragStart(e, param.originalName)}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, param.originalName)}
      data-param-id={param.originalName}
    >
      {/* Colored header */}
      <div 
        className="flex items-center justify-between px-3 py-1.5 rounded-t"
        style={{
          backgroundColor: headerBackgroundColor,
          color: headerTextColor,
          margin: '-12px -12px 8px -12px',
        }}
      >
        <div className="flex items-center min-w-0 flex-1">
          <ParameterIcon icon={param.icon} />
          <span 
            className={`font-semibold leading-tight break-words whitespace-normal ${
              titleString.length > 12 ? 'text-xs' : 'text-sm'
            }`}
            style={{ 
              color: headerTextColor,
              lineHeight: '1.2',
              maxHeight: '2.4em',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical'
            }}
            title={param.description || param.displayName}
          >
            {titleString}
          </span>
        </div>
      </div>

      {/* Parameter value display/edit area */}
      <div className="flex items-baseline justify-end mb-2 px-2">
        {isEditingValue ? (
          // Edit mode rendering
          getParameterDataType(param) === 'bool' ? (
            // Boolean toggle switch
            <div className="flex items-center">
              <button
                onClick={() => {
                  const newValue = editingValue === '1' || editingValue.toLowerCase() === 'true' ? '0' : '1';
                  setEditingValue(newValue);
                  setTimeout(() => handleValueSave(), 50);
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded focus:outline-none focus:ring-1 focus:ring-ring focus:ring-offset-2 ${
                  editingValue === '1' || editingValue.toLowerCase() === 'true'
                    ? 'bg-success'
                    : 'bg-muted'
                }`}
                autoFocus
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded bg-white ${
                    editingValue === '1' || editingValue.toLowerCase() === 'true'
                      ? 'translate-x-6'
                      : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="ml-2 text-sm text-muted-foreground">
                {editingValue === '1' || editingValue.toLowerCase() === 'true' ? t('parameterGrid.on') : t('parameterGrid.off')}
              </span>
            </div>
          ) : (
            // Text input for numeric/string values
            <input
              type="text"
              value={editingValue}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={() => {
                if (submittingRef.current) return;
                if (validationError) {
                  setTimeout(() => inputRef.current?.focus(), 0);
                  return;
                }
                handleValueSave();
              }}
              onKeyDown={handleValueKeyPress}
              aria-invalid={validationError ? 'true' : 'false'}
              aria-describedby={validationError ? `${param.originalName}-error` : undefined}
              className={`text-xl font-bold font-mono rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 w-24 text-right border transition-colors ${
                validationError 
                    ? 'bg-destructive/10 border-destructive focus:ring-destructive' 
                    : 'bg-card border-border focus:ring-info focus:border-info'
              }`}
              style={{ width: `${Math.min(14, Math.max(5, editingValue.length))}ch` }}
              placeholder={(() => {
                if (isTimeParameter(param)) {
                  const timeFormat = getParameterTimeFormat(param);
                  if (timeFormat?.endsWith('-only')) {
                    return `0 ${timeFormat.replace('-only', '')}`;
                  }
                  return '0 s';
                }
                return param.unit && param.unit !== '1' ? `0 ${param.unit}` : '0';
              })()}
              autoFocus
              ref={inputRef}
            />
          )
        ) : (
          // Display mode rendering
          getParameterDataType(param) === 'bool' ? (
            // Boolean display with toggle
            <div className="flex items-center">
              <button
                onClick={() => {
                  if (!hasWriteAccess || !onParameterValueChange) return;
                  const currentBoolValue = Boolean(Number(value));
                  onParameterValueChange(param.originalName, currentBoolValue ? '0' : '1');
                }}
                disabled={!hasWriteAccess || !onParameterValueChange}
                className={`relative inline-flex h-6 w-11 items-center rounded focus:outline-none focus:ring-1 focus:ring-ring focus:ring-offset-2 ${
                  hasWriteAccess && onParameterValueChange ? 'cursor-pointer' : 'cursor-default opacity-70'
                } ${
                  Boolean(Number(value))
                    ? 'bg-success'
                    : 'bg-muted'
                }`}
                title={hasWriteAccess && onParameterValueChange 
                  ? (t('parameterGrid.toggleHint') as string) 
                  : (t('parameterGrid.readOnly') as string)}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded bg-white ${
                    Boolean(Number(value)) ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="ml-2 text-sm text-muted-foreground">
                {Boolean(Number(value)) ? t('parameterGrid.on') : t('parameterGrid.off')}
              </span>
            </div>
          ) : (
            // Numeric/string value display
            (() => {
              // Special handling for time parameters with unit suffix
              if (isTimeParameter(param)) {
                const tf = getParameterTimeFormat(param);
                if (tf && tf.endsWith('-only')) {
                  const m = (formattedValue || '').match(/^\s*([+-]?\d+(?:[.,]\d+)?)\s*([^\d\s]+)\s*$/);
                  const numPart = m ? m[1] : formattedValue;
                  const unitPart = m ? m[2] : '';
                  return (
                    <span 
                      className={`font-mono mr-1 ${
                        hasWriteAccess ? 'cursor-pointer hover:bg-accent px-1 py-0.5 rounded' : ''
                      }`}
                      onClick={enterEditMode}
                      onKeyDown={(e) => { if (e.key === 'Enter' && hasWriteAccess) { e.preventDefault(); enterEditMode(); } }}
                      title={hasWriteAccess ? (t('parameterGrid.valueEditHint') as string) : (t('parameterGrid.readOnly') as string)}
                      role="button"
                      tabIndex={hasWriteAccess ? 0 : -1}
                      ref={valueSpanRef}
                    >
                      <span className="text-xl font-bold text-foreground">{numPart}</span>
                      {unitPart && (
                        <span className="text-xs text-muted-foreground ml-1">{unitPart}</span>
                      )}
                    </span>
                  );
                }
              }
              
              // Standard value display
              return (
                <span 
                  className={`text-xl font-bold text-foreground font-mono mr-1 ${
                    hasWriteAccess ? 'cursor-pointer hover:bg-muted px-1 py-0.5 rounded' : ''
                  }`}
                  onClick={enterEditMode}
                  onKeyDown={(e) => { if (e.key === 'Enter' && hasWriteAccess) { e.preventDefault(); enterEditMode(); } }}
                  title={hasWriteAccess ? (t('parameterGrid.valueEditHint') as string) : (t('parameterGrid.readOnly') as string)}
                  role="button"
                  tabIndex={hasWriteAccess ? 0 : -1}
                  ref={valueSpanRef}
                >
                  {formattedValue}
                </span>
              );
            })()
          )
        )}
        
        {/* Unit display (non-time, non-editing) */}
        {!isTimeParameter(param) && param.unit && param.unit !== '1' && !isEditingValue && (
          <span className="text-xs text-muted-foreground ml-1">{param.unit}</span>
        )}
      </div>

      {/* Validation error and conflict UI */}
      {isEditingValue && (
        <div className="px-2 -mt-2 mb-2">
          {validationError && (
            <div id={`${param.originalName}-error`} className="text-xs text-destructive mt-1">
              {validationError}
            </div>
          )}
          {hasConflict && !validationError && (
            <div className="text-xs mt-1 flex items-center gap-2 text-warning">
              <i className="fas fa-exclamation-triangle" />
              <span>{t('parameterGrid.conflictUpdated')}</span>
              <button 
                className="underline" 
                onClick={() => { 
                  const current = computeCurrentDisplayValue(); 
                  setEditingValue(current); 
                  setHasConflict(false); 
                  setTimeout(() => inputRef.current?.focus(), 0); 
                }}
              >
                {t('parameterGrid.refresh')}
              </button>
              <button 
                className="underline" 
                onClick={() => { setHasConflict(false); handleValueSave(); }}
              >
                {t('parameterGrid.overwrite')}
              </button>
            </div>
          )}
          {isSaving && (
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <i className="fas fa-spinner fa-spin" /> {t('parameterGrid.saving')}
            </div>
          )}
        </div>
      )}

      {/* Footer with controls. Outlines were doubling the card frame; a
          single top divider plus a tinted background is enough to set the
          footer apart while staying visually quiet. */}
      <div
        className={
          'flex items-center justify-between px-2 py-1 mt-auto bg-muted border-t border-border'
        }
        style={{ margin: '0 -12px -11px -12px' }}
      >
        <div className="flex items-center flex-1 min-w-0">
          {/* Legend toggle */}
          <label className="flex items-center text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={param.show_in_legend}
              onChange={handleLegendToggle}
              className={
                'mr-1 h-3 w-3 text-info focus:ring-ring border-border rounded flex-shrink-0'
              }
            />
            <span className={'text-muted-foreground truncate'}>
              {t('parameterGrid.inLegend')}
            </span>
          </label>
        </div>
        
        {/* Reveal the four control icons only on hover (or focus-within for
            keyboard users). They were always-visible noise on every card —
            now the active value reads more clearly while the controls stay
            one motion away. The favourite star is a sticky exception: a
            favourited card keeps its star visible so the favourite state
            is still legible at a glance. */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {/* Delete button */}
          {onDeleteParameter && (
            <button
              onClick={() => onDeleteParameter(param.originalName)}
              className="p-0.5 text-muted-foreground hover:text-destructive rounded flex-shrink-0"
              title={t('parameterGrid.deleteParameter') as string}
            >
              <i className="fas fa-times text-xs" />
            </button>
          )}

          {/* Settings button */}
          <button
            onClick={handleEditClick}
            className="p-0.5 text-muted-foreground hover:text-foreground rounded flex-shrink-0"
            title={t('parameterGrid.editParameter') as string}
          >
            <i className="fas fa-cog text-xs" />
          </button>

          {/* Favorite toggle */}
          <button
            onClick={handleFavoriteClick}
            className="p-0.5 rounded flex-shrink-0 hover:text-foreground"
            title={isFavorite ? (t('parameterGrid.favoriteRemove') as string) : (t('parameterGrid.favoriteAdd') as string)}
          >
            <i className={`fas fa-star text-xs ${
              isFavorite ? 'text-warning' : 'text-muted-foreground'
            }`} />
          </button>

          {/* Hide button */}
          {onHide && (
            <button
              onClick={() => onHide(param.originalName)}
              className="p-0.5 text-muted-foreground hover:text-destructive rounded flex-shrink-0"
              title={t('parameterGrid.hideParameter') as string}
            >
              <i className="fas fa-eye-slash text-xs" />
            </button>
          )}
        </div>
        {/* Always-visible favourite indicator for cards that ARE favourited.
            Lives outside the hover-fade group so the user never loses sight
            of which parameters are pinned. Hidden when no card hover is
            active and the card is hover-revealed already. */}
        {isFavorite && (
          <i
            className="fas fa-star text-xs text-warning ml-1 flex-shrink-0 group-hover:hidden group-focus-within:hidden"
            aria-hidden="true"
            title={t('parameterGrid.favoriteRemove') as string}
          />
        )}
      </div>
    </div>
  );
});

ParameterCard.displayName = 'ParameterCard';

/**
 * Grid component for displaying parameter cards.
 * Supports drag-drop reordering, filtering, and search.
 */
const ParameterGrid: React.FC<ParameterGridProps> = React.memo(({
  parameters,
  isEditMode,
  searchTerm,
  filterAccess = 'all',
  onToggleFavorite,
  onToggleShowInLegend,
  onEditParameter,
  onReorderParameters,
  onParameterValueChange,
  categoryName,
}) => {
  // Drag and drop state
  const [draggedParam, setDraggedParam] = useState<string | null>(null);
  const [dragOverParam, setDragOverParam] = useState<string | null>(null);
  const dragCounter = useRef(0);
  
  // User preferences
  const [unfavoriteOpacity, setUnfavoriteOpacity] = useState<number>(DEFAULT_UNFAVORITE_OPACITY);
  const [settingsVersion, setSettingsVersion] = useState<number>(0);
  const [decimalSeparatorVersion, setDecimalSeparatorVersion] = useState<number>(0);
  
  const { t } = useTranslation();
  const { getUserPreferences, getParameterSettings, setHidden } = useLocalSettings();
  const { setPositionInCategory } = useLocalSettings() as any;
  const deviceId = useRigStore(state => state.deviceId);
  const { showSuccess, showError } = useNotificationHelpers();
  const { user } = useAuth();
  const canDeleteParameter = user?.role === 'developer' || user?.role === 'super_admin';
  
  // Load user preferences for unfavorite opacity
  useEffect(() => {
    const prefs = getUserPreferences();
    setUnfavoriteOpacity(prefs.unfavoriteOpacity || DEFAULT_UNFAVORITE_OPACITY);
  }, [getUserPreferences]);

  // Listen for local settings changes
  useEffect(() => {
    const handler = () => setSettingsVersion(v => v + 1);
    window.addEventListener(LOCAL_SETTINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(LOCAL_SETTINGS_CHANGED_EVENT, handler);
  }, []);

  // Listen for user preferences changes
  useEffect(() => {
    const handlePreferencesChange = (event: CustomEvent) => {
      if (event.detail?.unfavoriteOpacity !== undefined) {
        setUnfavoriteOpacity(event.detail.unfavoriteOpacity);
      }
    };
    window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, handlePreferencesChange as EventListener);
    return () => window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, handlePreferencesChange as EventListener);
  }, []);

  // Listen for decimal separator changes
  useEffect(() => {
    const handleDecimalSeparatorChange = () => {
      setDecimalSeparatorVersion(v => v + 1);
    };
    window.addEventListener(DECIMAL_SEPARATOR_CHANGED_EVENT, handleDecimalSeparatorChange);
    return () => window.removeEventListener(DECIMAL_SEPARATOR_CHANGED_EVENT, handleDecimalSeparatorChange);
  }, []);

  /**
   * Filters and sorts parameters based on search, access filter, and position.
   * Sorting: by position first, then alphabetically.
   */
  const sortedParameters = useMemo(() => {
    let filtered = parameters;
    
    // Filter out hidden parameters
    filtered = filtered.filter(p => !getParameterSettings(p.originalName).hidden);
    
    // Access level filter
    if (filterAccess !== 'all') {
      filtered = filtered.filter(p => {
        const z = getAccessString(p);
        if (filterAccess === 'writable') return z.includes('w');
        if (filterAccess === 'readable') return z.includes('r') && !z.includes('w');
        return true;
      });
    }

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(param => 
        param.displayName?.toLowerCase().includes(term) ||
        param.originalName.toLowerCase().includes(term) ||
        param.description?.toLowerCase().includes(term)
      );
    }
    
    // Sort by position, then alphabetically
    const paramsToSort = filtered === parameters ? [...filtered] : filtered;
    return paramsToSort.sort((a, b) => {
      const aPos = a.position === undefined ? Infinity : a.position;
      const bPos = b.position === undefined ? Infinity : b.position;
      
      if (aPos !== bPos) return aPos - bPos;
      
      const aName = getDisplayName(a);
      const bName = getDisplayName(b);
      return aName.localeCompare(bName);
    });
  }, [parameters, searchTerm, getParameterSettings, settingsVersion, filterAccess]);

  // Hide parameter handler
  const handleHide = useCallback((paramId: string) => {
    setHidden(paramId, true);
    setSettingsVersion(v => v + 1);
  }, [setHidden]);

  const handleDeleteParameter = useCallback(async (paramId: string) => {
    if (!canDeleteParameter) return;
    const confirmed = window.confirm(t('parameterGrid.deleteConfirm') as string);
    if (!confirmed) return;

    if (!deviceId) {
      showError(t('parameterGrid.deleteNoDevice') as string);
      return;
    }

    if (!realtimeDB) {
      showError(t('parameterGrid.deleteNoDatabase') as string);
      return;
    }

    try {
      await remove(ref(realtimeDB, `temporaer/${deviceId}/${paramId}`));
      showSuccess(t('parameterGrid.deleteSuccess') as string);
      setHidden(paramId, true);
      setSettingsVersion(v => v + 1);
    } catch (error) {
      console.error('[ParameterGrid] Failed to delete parameter node:', error);
      showError(t('parameterGrid.deleteFailed') as string);
    }
  }, [canDeleteParameter, deviceId, setHidden, showError, showSuccess, t]);

  // Count hidden parameters
  const hiddenCount = useMemo(() => {
    return parameters.reduce((acc, p) => acc + (getParameterSettings(p.originalName).hidden ? 1 : 0), 0);
  }, [parameters, getParameterSettings, settingsVersion]);

  const favoriteCount = useMemo(() => {
    return parameters.filter(p => p.favorite === FAVORITE_FLAG).length;
  }, [parameters]);

  // Unhide all parameters
  const unhideAll = useCallback(() => {
    parameters.forEach(p => {
      if (getParameterSettings(p.originalName).hidden) {
        setHidden(p.originalName, false);
      }
    });
  }, [parameters, getParameterSettings, setHidden]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, paramId: string) => {
    setDraggedParam(paramId);
    dragCounter.current = 0;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', paramId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedParam(null);
    setDragOverParam(null);
    dragCounter.current = 0;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetParamId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedParam || draggedParam === targetParamId) return;
    
    const draggedIndex = sortedParameters.findIndex(p => p.originalName === draggedParam);
    const targetIndex = sortedParameters.findIndex(p => p.originalName === targetParamId);
    
    if (draggedIndex === -1 || targetIndex === -1) {
      console.error('[ParameterGrid] Could not find parameter indices');
      return;
    }
    
    // Reorder array
    const newOrder = [...sortedParameters];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);
    
    const orderedParamIds = newOrder.map(p => p.originalName);
    onReorderParameters(orderedParamIds);
    
    // Persist positions to local storage
    try {
      const cat = categoryName?.trim() || 'uncategorized';
      orderedParamIds.forEach((paramId, index) => setPositionInCategory?.(paramId, cat, index));
    } catch {}
    
    setDraggedParam(null);
    setDragOverParam(null);
  }, [draggedParam, sortedParameters, onReorderParameters, categoryName, setPositionInCategory]);

  // Empty state
  if (sortedParameters.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <i className="fas fa-search text-2xl mb-3 opacity-50" />
        <p className="text-lg font-medium">{t('parameterGrid.emptyTitle')}</p>
        <p className="text-sm">
          {searchTerm.trim() 
            ? (t('parameterGrid.emptyFiltered', { query: searchTerm }) as string) 
            : t('parameterGrid.emptyConnect')}
        </p>
      </div>
    );
  }

  return (
    <div className="parameter-grid">
      {/* Edit mode notice */}
      {isEditMode && (
        <div className="bg-info/10 border-2 border-info/40 rounded p-2 mb-3">
          <div className="flex items-center">
            <i className="fas fa-info-circle text-info mr-2" />
            <span className="text-info-foreground text-xs">
              <strong>{t('parameterGrid.editMode')}</strong> {t('parameterGrid.editModeHint')}
            </span>
          </div>
        </div>
      )}

      {/* Parameter cards grid */}
      <div
        className="gap-3"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_MIN_COLUMN_WIDTH_PX}px, 1fr))`
        }}
      >
        {sortedParameters.map((param) => (
          <div
            key={param.originalName}
            className={dragOverParam === param.originalName ? 'ring-2 ring-primary ring-opacity-50' : ''}
            onDragEnter={() => draggedParam && setDragOverParam(param.originalName)}
            onDragLeave={() => setDragOverParam(null)}
          >
            <ParameterCard
              param={param}
              isEditMode={isEditMode}
              isDragging={draggedParam === param.originalName}
              isFavorite={param.favorite === FAVORITE_FLAG}
              unfavoriteOpacity={unfavoriteOpacity}
              onToggleFavorite={onToggleFavorite}
              onToggleShowInLegend={onToggleShowInLegend}
              onEditParameter={onEditParameter}
              onDeleteParameter={canDeleteParameter ? handleDeleteParameter : undefined}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onParameterValueChange={onParameterValueChange}
              onHide={handleHide}
              decimalSeparatorVersion={decimalSeparatorVersion}
            />
          </div>
        ))}
      </div>
      
      {/* Statistics footer */}
      <div className="mt-3 text-xs text-muted-foreground text-center">
        {t('parameterGrid.showing', { shown: sortedParameters.length, total: parameters.length })}
        {searchTerm.trim() && ` ${t('parameterGrid.filteredBy', { query: searchTerm })}`}
        {favoriteCount > 0 && (
          <span className="ml-2">
            • {t('parameterGrid.favoritesCount', { count: favoriteCount })}
          </span>
        )}
        {hiddenCount > 0 && (
          <span className="ml-2">
            • {t('parameterGrid.hiddenCount', { count: hiddenCount })}
            <button onClick={unhideAll} className="ml-2 text-info hover:underline">
              {t('parameterGrid.showAll')}
            </button>
          </span>
        )}
      </div>
    </div>
  );
});

ParameterGrid.displayName = 'ParameterGrid';

export default ParameterGrid;

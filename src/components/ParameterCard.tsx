import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { ParameterInfo } from '../types/firebase';
import { formatParameterValue } from '../utils/parameterTypes';
import { isTimeParameter } from '../utils/timeFormatting';

const DECIMAL_SEPARATOR_CHANGED_EVENT = 'decimalSeparatorChanged';
const DEFAULT_HEADER_COLOR = '#475569';
const DEFAULT_HEADER_TEXT_LIGHT = '#333333';
const DEFAULT_HEADER_TEXT_DARK = '#FFFFFF';
const CARD_MIN_HEIGHT_PX = 110;
const CARD_MAX_HEIGHT_PX = 120;
const NON_FAVORITE_OPACITY = 0.3;
const FAVORITE_FLAG = 1;

const getAccessString = (parameter: ParameterInfo) =>
  String((parameter as any).zugriff || '');

/**
 * Props for the ParameterCard component
 */
interface ParameterCardProps {
  /** Parameter metadata and configuration */
  parameter: ParameterInfo;
  /** Current live value of the parameter */
  currentValue?: number;
  /** Whether the card is in reorder/edit mode */
  isEditMode?: boolean;
  /** Whether this card is currently being dragged */
  isDragging?: boolean;
  /** Callback to toggle favorite status */
  onToggleFavorite: (paramId: string) => Promise<void>;
  /** Callback to toggle show in chart legend */
  onToggleShowInLegend: (paramId: string, showInLegend: boolean) => Promise<void>;
  /** Callback to open parameter settings editor */
  onEdit: (paramId: string) => void;
  /** Drag start handler for reordering */
  onDragStart?: (e: React.DragEvent, paramId: string) => void;
  /** Drag over handler for reordering */
  onDragOver?: (e: React.DragEvent) => void;
  /** Drop handler for reordering */
  onDrop?: (e: React.DragEvent, targetParamId: string) => void;
  /** Drag end handler for reordering */
  onDragEnd?: (e: React.DragEvent) => void;
}

/**
 * Determines if a color is light or dark based on perceived brightness.
 * Uses HSP color model for better perceptual accuracy.
 * @param color - Hex color string (e.g., '#FF0000') or rgb/rgba string
 * @returns true if the color is light, false if dark
 */
const isLightColor = (color: string | undefined): boolean => {
  if (!color) return true;
  
  let r: number, g: number, b: number;
  
  // Parse RGB/RGBA format
  if (color.startsWith('rgb')) {
    const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!match) return true;
    [r, g, b] = match.slice(1, 4).map(Number);
  } else {
    // Parse hex format
    const hex = color.replace('#', '');
    const bigint = parseInt(hex, 16);
    r = (bigint >> 16) & 255;
    g = (bigint >> 8) & 255;
    b = bigint & 255;
  }
  
  // Calculate perceived brightness using HSP model
  const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
  // MAGIC: 127.5 threshold keeps text readable across legacy palette
  return hsp > 127.5;
};

/**
 * Renders the parameter icon based on its type.
 * Supports: FontAwesome icons, emoji, legacy encoded unicode, and fallback.
 */
const ParameterIcon: React.FC<{ icon?: string; paramName: string }> = React.memo(({ icon, paramName }) => {
  const iconClasses = "mr-2 text-sm opacity-80 flex-shrink-0";
  
  // No icon - show default tag icon
  if (!icon || icon.trim() === '') {
    return <i className={`fas fa-tag ${iconClasses}`} />;
  }
  
  // Legacy encoded Unicode sequence (backward compatibility)
  if (typeof icon === 'string' && icon.includes('\\u{')) {
    try {
      const decodedIcon = icon.replace(/\\u\{([^}]+)\}/g, (_, hex) => {
        return String.fromCodePoint(parseInt(hex, 16));
      });
      return <span className={iconClasses}>{decodedIcon}</span>;
    } catch (error) {
      console.warn(`[ParameterCard] Failed to decode legacy icon for ${paramName}:`, icon, error);
      return <i className={`fas fa-tag ${iconClasses}`} />;
    }
  }
  
  // Check if it's a valid FontAwesome icon
  const isFontAwesome = typeof icon === 'string' && 
    icon.startsWith('fa-') && 
    /^fa-[a-zA-Z0-9-]+$/.test(icon) &&
    icon.length > 3 &&
    !/[\u{1F000}-\u{1F9FF}]/u.test(icon); // Exclude emoji unicode blocks
  
  if (isFontAwesome) {
    return <i className={`fas ${icon} ${iconClasses}`} />;
  }
  
  // Everything else (emoji, text) - render as span
  return <span className={iconClasses}>{icon}</span>;
});

ParameterIcon.displayName = 'ParameterIcon';

/**
 * Inner component for ParameterCard (before memoization).
 * Displays a single parameter with its value, controls, and metadata.
 */
const ParameterCardInner: React.FC<ParameterCardProps> = ({
  parameter,
  currentValue,
  isEditMode = false,
  isDragging = false,
  onToggleFavorite,
  onToggleShowInLegend,
  onEdit,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [decimalSeparatorVersion, setDecimalSeparatorVersion] = useState<number>(0);
  const { hasPermission, parameterViewScope } = useAuth();

  // Listen for decimal separator changes to force re-render of formatted values
  useEffect(() => {
    const handleDecimalSeparatorChange = () => {
      setDecimalSeparatorVersion(v => v + 1);
    };

    window.addEventListener(DECIMAL_SEPARATOR_CHANGED_EVENT, handleDecimalSeparatorChange);
    return () => {
      window.removeEventListener(DECIMAL_SEPARATOR_CHANGED_EVENT, handleDecimalSeparatorChange);
    };
  }, []);

  // Format parameter value with proper precision and divisor
  const formattedValue = useMemo(() => {
    return formatParameterValue(currentValue, parameter);
  }, [currentValue, parameter, decimalSeparatorVersion]);

  // Access permission checks
  const isReadable = useMemo(() => {
    return getAccessString(parameter).includes('r');
  }, [parameter]);
  
  const isWritable = useMemo(() => {
    return getAccessString(parameter).includes('w');
  }, [parameter]);
  
  // Determine if the current user can see this card based on role permissions
  const canSeeThisCard = useMemo(() => {
    const scope = parameterViewScope || 'all';
    if (hasPermission('parameter.view_all') || scope === 'all') return true;
    if (hasPermission('parameter.view_writable') || scope === 'writable') return isWritable;
    if (hasPermission('parameter.view_readable') || scope === 'readable') return isReadable && !isWritable;
    return true;
  }, [parameterViewScope, hasPermission, isReadable, isWritable]);

  // Calculate header text color based on background brightness
  const headerIsLight = useMemo(() => isLightColor(parameter.color), [parameter.color]);

  const headerStyle = useMemo(() => ({
    backgroundColor: parameter.color || DEFAULT_HEADER_COLOR,
    color: headerIsLight ? DEFAULT_HEADER_TEXT_LIGHT : DEFAULT_HEADER_TEXT_DARK,
  }), [parameter.color, headerIsLight]);

  // Handle favorite toggle with loading state
  const handleFavoriteToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isUpdating) return;
    
    setIsUpdating(true);
    try {
      await onToggleFavorite(parameter.originalName);
    } finally {
      setIsUpdating(false);
    }
  }, [parameter.originalName, onToggleFavorite, isUpdating]);

  // Handle legend visibility toggle
  const handleLegendToggle = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isUpdating) return;
    
    setIsUpdating(true);
    try {
      await onToggleShowInLegend(parameter.originalName, e.target.checked);
    } finally {
      setIsUpdating(false);
    }
  }, [parameter.originalName, onToggleShowInLegend, isUpdating]);

  // Handle edit button click
  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(parameter.originalName);
  }, [parameter.originalName, onEdit]);

  // Build CSS classes based on card state
  const cardClasses = useMemo(() => {
    const baseClasses = 'metric-card bg-card rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow p-3 flex flex-col';
    const stateClasses: string[] = [];
    
    // Non-favorite styling class (old behaviour)
    if (parameter.favorite !== 1) {
      stateClasses.push('non-favorite-card');
    }
    
    // Dragging state
    if (isDragging) {
      stateClasses.push('opacity-50 bg-muted');
    }
    
    // Edit mode shows drag cursor and dashed border
    if (isEditMode) {
      stateClasses.push('cursor-grab border-dashed border-primary');
    }
    
    return `${baseClasses} ${stateClasses.join(' ')}`;
  }, [parameter.favorite, isDragging, isEditMode]);

  // Don't render if user doesn't have permission to view this card
  if (!canSeeThisCard) return null;

  return (
    <div
      className={cardClasses}
      draggable={isEditMode}
      onDragStart={isEditMode ? (e) => onDragStart?.(e, parameter.originalName) : undefined}
      onDragOver={isEditMode ? onDragOver : undefined}
      onDrop={isEditMode ? (e) => onDrop?.(e, parameter.originalName) : undefined}
      onDragEnd={isEditMode ? onDragEnd : undefined}
      data-param-id={parameter.originalName}
      style={{ 
        minHeight: `${CARD_MIN_HEIGHT_PX}px`,
        maxHeight: `${CARD_MAX_HEIGHT_PX}px`,
        // Old behaviour: card opacity controlled via CSS variable
        // metric-card { opacity: var(--user-opacity, 1); }
        ['--user-opacity' as any]: parameter.favorite === FAVORITE_FLAG ? 1 : NON_FAVORITE_OPACITY,
      }}
    >
      {/* Header with colored background */}
      <div 
        className="flex justify-between items-center px-3 py-1.5 rounded-t"
        style={{
          ...headerStyle,
          // Old layout: header full-bleed over card padding
          margin: '-12px -12px 8px',
        }}
      >
        <div className="flex items-center min-w-0 flex-1">
          <ParameterIcon icon={parameter.icon} paramName={parameter.originalName} />
          
          <span 
            className="text-xs font-medium leading-tight break-words whitespace-normal"
            style={{ 
              fontSize: '11px',
              lineHeight: '1.2',
              maxHeight: '2.4em',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical'
            }}
            title={`${parameter.originalName} ${parameter.rangeString || ''}`.trim()}
          >
            {parameter.originalName}
            {parameter.rangeString && ` ${parameter.rangeString}`}
          </span>
          
          {/* Access level indicator (r/w/rw) */}
          {parameter.zugriff && (
            <span 
              className="ml-2 px-1 py-0.5 text-xs font-mono bg-white bg-opacity-20 rounded border border-white border-opacity-30 flex-shrink-0"
              title={`Access: ${parameter.zugriff === 'rw' ? 'read-write' : parameter.zugriff === 'r' ? 'read-only' : parameter.zugriff === 'w' ? 'write-only' : parameter.zugriff}`}
            >
              {parameter.zugriff}
            </span>
          )}
        </div>
        
        {/* Favorite toggle button */}
        <button
          onClick={handleFavoriteToggle}
          disabled={isUpdating}
          className="ml-2 px-1 py-1 rounded text-xs bg-white bg-opacity-10 hover:bg-opacity-20 
                     border border-white border-opacity-30 flex-shrink-0
                     disabled:opacity-50 disabled:cursor-not-allowed"
          title="Toggle favorite"
        >
          <i className={`${parameter.favorite === FAVORITE_FLAG ? 'fas fa-star text-yellow-300' : 'far fa-star opacity-70'}`} />
        </button>
      </div>

      {/* Value display area */}
      <div className="flex justify-end items-baseline px-2 mt-auto mb-2">
        <span className="text-xl font-bold text-card-foreground mr-1 font-mono [font-variant-numeric:tabular-nums]">
          {formattedValue}
        </span>
        <span className="text-xs text-muted-foreground">
          {!isTimeParameter(parameter) && parameter.unit && parameter.unit !== '1' ? parameter.unit : ''}
        </span>
      </div>

      {/* Footer with legend toggle and edit button */}
      <div
        className="flex justify-between items-center px-2 py-1 mt-auto bg-muted outline outline-1 outline-border -outline-offset-1"
        style={{ margin: '0 -12px -11px' }}
      >
        {/* Show in Legend checkbox */}
        <div className="flex items-center">
          <input
            type="checkbox"
            id={`legend-toggle-${parameter.originalName}`}
            checked={parameter.show_in_legend || false}
            onChange={handleLegendToggle}
            disabled={isUpdating}
            className="mr-2 h-3 w-3 text-primary focus:ring-primary border-border rounded-theme-sm
                       disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <label 
            htmlFor={`legend-toggle-${parameter.originalName}`}
            className="text-xs text-muted-foreground cursor-pointer select-none"
          >
            In Legend
          </label>
        </div>

        {/* Edit settings button */}
        <button
          onClick={handleEdit}
          className="p-1 text-muted-foreground hover:text-primary hover:bg-accent rounded-theme-sm"
          title={`Edit settings for ${parameter.originalName}`}
        >
          <i className="fas fa-cog text-xs" />
        </button>
      </div>

      {/* Loading overlay shown during async operations */}
      {isUpdating && (
        <div className="absolute inset-0 bg-card/50 flex items-center justify-center rounded-theme">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
};

/**
 * Custom comparison function for React.memo optimization.
 * Only re-renders when meaningful props change.
 */
const arePropsEqual = (prevProps: ParameterCardProps, nextProps: ParameterCardProps): boolean => {
  // Value change always triggers re-render
  if (prevProps.currentValue !== nextProps.currentValue) return false;
  
  // UI state changes
  if (prevProps.isEditMode !== nextProps.isEditMode) return false;
  if (prevProps.isDragging !== nextProps.isDragging) return false;
  
  // Parameter metadata changes
  const prev = prevProps.parameter;
  const next = nextProps.parameter;
  
  if (prev.originalName !== next.originalName) return false;
  if (prev.displayName !== next.displayName) return false;
  if (prev.unit !== next.unit) return false;
  if (prev.color !== next.color) return false;
  if (prev.favorite !== next.favorite) return false;
  if (prev.show_in_legend !== next.show_in_legend) return false;
  if (prev.divisor !== next.divisor) return false;
  if (prev.icon !== next.icon) return false;
  
  // Props are equal, skip re-render
  return true;
};

/**
 * Memoized ParameterCard component.
 * Displays a single parameter with live value, metadata, and controls.
 * Uses custom comparison to minimize re-renders.
 */
const ParameterCard = React.memo(ParameterCardInner, arePropsEqual);

ParameterCard.displayName = 'ParameterCard';

export default ParameterCard;

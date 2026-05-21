import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import type { ParameterInfo } from '../types/firebase';
import { getParameterDataType } from '../utils/parameterTypes';
import { TIME_FORMAT_OPTIONS, type TimeFormat, calculateTimeDivisor } from '../utils/timeFormatting';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
// Test alarm system - completely client-only with emergency functions
import { emergencyStopAllTests, forceCleanupStuckTests, testAlarmManager } from '../utils/testAlarmSystem';
import { firestoreDB } from '../lib/firebase';
import { doc as fsDoc, setDoc as fsSetDoc } from 'firebase/firestore';
import { useStoveStore } from '../store/useStoveStore';
import { useCategoryManager } from '../hooks/useCategoryManager';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface ParameterSettingsModalProps {
  isOpen: boolean;
  parameter: ParameterInfo | null;
  onClose: () => void;
  onSave: (paramId: string, settings: Partial<ParameterInfo>) => Promise<void>;
}

const DEFAULT_DECIMAL_PLACES = '2';
const DEFAULT_FORM = '0';
const DEFAULT_ZUGRIFF = 'r';
const DEFAULT_TIME_FORMAT: TimeFormat = 'ms-only';
const DEFAULT_TIME_INPUT_UNIT = 'ms';
const ALARM_VALIDATION_MESSAGE = 'Bitte Min- und Max-Alarmwerte angeben';
const DELETE_CATEGORY_CONFIRM_TEXT =
  'Möchten Sie wirklich die Kategorie "{category}" löschen?\n\nAlle Parameter aus dieser Kategorie werden zu "Ohne Kategorie" verschoben.';
const PARAMETER_SETTINGS_CHANGED_EVENT = 'parameterSettingsChanged';
const ALARM_TOAST_EVENT = 'alarm-toast';
// MAGIC: alarm test delta keeps threshold change noticeable but safe
const TEST_ALARM_DELTA_MIN = 100;
const TEST_ALARM_DELTA_RATIO = 0.05;
const TEST_ALARM_REVERT_DELAY_MS = 20000;

// MAGIC: curated palette chosen to match existing chart theme/colors
const COLOR_PALETTE = [
  '#d62728', '#2ca02c', '#1f77b4', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f',
  '#bcbd22', '#17becf', '#6b6ecf', '#b5cf6b', '#393b79', '#637939', '#ad494a', '#de9ed6',
  '#5254a3', '#8ca252', '#9c9ede', '#cedb9c', '#f7b6d2', '#ffbb78', '#c7c7c7', '#aec7e8'
];

// MAGIC: popular icon presets for quick selection
const POPULAR_EMOJIS = [
  '🌡️', '🔥', '❄️', '💨', '💧', '⚡', '⚙️', '🔧',
  '📊', '📈', '📉', '⚠️', '✅', '❌', '⏰', '📏'
];

// MAGIC: curated FontAwesome icon lists grouped by theme
const FONT_AWESOME_ICONS = [
  {
    category: 'Temperature & Fire',
    icons: [
      { icon: 'fa-thermometer-half', name: 'Thermometer' },
      { icon: 'fa-fire', name: 'Fire' },
      { icon: 'fa-snowflake', name: 'Snowflake' },
      { icon: 'fa-sun', name: 'Sun' },
      { icon: 'fa-moon', name: 'Moon' },
    ]
  },
  {
    category: 'Power & Energy',
    icons: [
      { icon: 'fa-bolt', name: 'Lightning' },
      { icon: 'fa-battery-full', name: 'Battery Full' },
      { icon: 'fa-battery-half', name: 'Battery Half' },
      { icon: 'fa-plug', name: 'Power Plug' },
      { icon: 'fa-power-off', name: 'Power' },
    ]
  },
  {
    category: 'Flow & Pressure',
    icons: [
      { icon: 'fa-wind', name: 'Wind' },
      { icon: 'fa-tint', name: 'Droplet' },
      { icon: 'fa-cloud', name: 'Cloud' },
      { icon: 'fa-fan', name: 'Fan' },
      { icon: 'fa-compress-arrows-alt', name: 'Pressure' },
    ]
  },
  {
    category: 'Control & Settings',
    icons: [
      { icon: 'fa-cog', name: 'Settings' },
      { icon: 'fa-cogs', name: 'Multiple Settings' },
      { icon: 'fa-sliders-h', name: 'Sliders' },
      { icon: 'fa-tools', name: 'Tools' },
      { icon: 'fa-wrench', name: 'Wrench' },
      { icon: 'fa-screwdriver', name: 'Screwdriver' },
    ]
  },
  {
    category: 'Status & Alerts',
    icons: [
      { icon: 'fa-check-circle', name: 'Success' },
      { icon: 'fa-exclamation-triangle', name: 'Warning' },
      { icon: 'fa-times-circle', name: 'Error' },
      { icon: 'fa-info-circle', name: 'Info' },
      { icon: 'fa-bell', name: 'Bell' },
      { icon: 'fa-shield-alt', name: 'Shield' },
    ]
  },
  {
    category: 'Data & Charts',
    icons: [
      { icon: 'fa-chart-line', name: 'Line Chart' },
      { icon: 'fa-chart-bar', name: 'Bar Chart' },
      { icon: 'fa-chart-pie', name: 'Pie Chart' },
      { icon: 'fa-chart-area', name: 'Area Chart' },
      { icon: 'fa-tachometer-alt', name: 'Dashboard' },
      { icon: 'fa-gauge', name: 'Gauge' },
    ]
  },
  {
    category: 'Time & Schedule',
    icons: [
      { icon: 'fa-clock', name: 'Clock' },
      { icon: 'fa-stopwatch', name: 'Stopwatch' },
      { icon: 'fa-calendar', name: 'Calendar' },
      { icon: 'fa-hourglass-half', name: 'Hourglass' },
      { icon: 'fa-history', name: 'History' },
    ]
  },
];

const ParameterSettingsModal: React.FC<ParameterSettingsModalProps> = ({
  isOpen,
  parameter,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentDeviceId = useStoveStore(state => state.deviceId);
  // Category management
  const { availableCategories: managedCategories, createCategory, renameCategory, deleteCategory } = useCategoryManager();
  
  // Category input state
  const [categoryInputValue, setCategoryInputValue] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [isRenamingCategory, setIsRenamingCategory] = useState(false);
  
  // Form state - removed displayName
  const [settings, setSettings] = useState({
    color: '',
    divisor: '',
    unit: '',
    form: DEFAULT_FORM,
    minValue: '',
    maxValue: '',
    yAxisID: '',
    position: '',
    icon: '',
    description: '',
    kategorie: '',
    zugriff: '',
    dataType: '',
    decimalPlaces: DEFAULT_DECIMAL_PLACES, // Default to 2 decimal places for float
    isTimeData: false,
    timeFormat: DEFAULT_TIME_FORMAT,
    timeInputUnit: DEFAULT_TIME_INPUT_UNIT as 'ms' | 's' | 'min' | 'h',
    isAlarmEnabled: false,
    alarmMinThreshold: '',
    alarmMaxThreshold: '',
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [showColorPalette, setShowColorPalette] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [iconTab, setIconTab] = useState<'emoji' | 'fa'>('emoji');
  
  // Developer test state
  const [isTestingAlarm, setIsTestingAlarm] = useState(false);

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  // Helper function to check if parameter is float type
  const isFloatType = useCallback(() => {
    if (!parameter) return false;
    
    // Check current form value first (for real-time UI updates)
    const currentFormDataType = settings.dataType.trim();
    if (currentFormDataType) {
      return currentFormDataType === 'float';
    }
    
    // If form is empty (Auto mode) - check saved value or auto-detect
    const savedDataType = (parameter as any).dataType;
    if (savedDataType) {
      return savedDataType === 'float';
    }
    
    // If no saved value - use auto-detection
    const autoDetectedType = getParameterDataType(parameter);
    return autoDetectedType === 'float';
  }, [parameter, settings.dataType]);

  // Initialize form when parameter changes
  useEffect(() => {
    if (parameter) {
      const initialZugriff = parameter.zugriff !== undefined ? parameter.zugriff : DEFAULT_ZUGRIFF;
      // Safe toString conversion with null checks
      const safeDivisor = parameter.divisor !== undefined && parameter.divisor !== null ? parameter.divisor.toString() : '';
      const safeForm = parameter.form !== undefined && parameter.form !== null ? parameter.form.toString() : DEFAULT_FORM;
      const safeMinValue = parameter.minValue !== undefined && parameter.minValue !== null ? parameter.minValue.toString() : '';
      const safeMaxValue = parameter.maxValue !== undefined && parameter.maxValue !== null ? parameter.maxValue.toString() : '';
      const safePosition = parameter.position !== undefined && parameter.position !== null && parameter.position !== Infinity ? parameter.position.toString() : '';
      setSettings({
        color: parameter.color || '',
        divisor: safeDivisor,
        unit: parameter.unit || '',
        form: safeForm,
        minValue: safeMinValue,
        maxValue: safeMaxValue,
        yAxisID: parameter.yAxisID || '',
        position: safePosition,
        icon: parameter.icon || '',
        description: parameter.description || '',
        kategorie: parameter.kategorie || '',
        zugriff: initialZugriff,
        dataType: (parameter as any).dataType || '',
        decimalPlaces: (parameter as any).decimalPlaces !== undefined ? (parameter as any).decimalPlaces.toString() : DEFAULT_DECIMAL_PLACES,
        isTimeData: Boolean((parameter as any).isTimeData),
        timeFormat: (parameter as any).timeFormat || DEFAULT_TIME_FORMAT,
        timeInputUnit: (parameter as any).timeInputUnit || DEFAULT_TIME_INPUT_UNIT,
        isAlarmEnabled: Boolean((parameter as any).isAlarmEnabled),
        alarmMinThreshold: (parameter as any).alarmMinThreshold !== undefined ? (parameter as any).alarmMinThreshold.toString() : '',
        alarmMaxThreshold: (parameter as any).alarmMaxThreshold !== undefined ? (parameter as any).alarmMaxThreshold.toString() : '',
      });
      const currentCategory = parameter.kategorie || '';
      setCategoryInputValue(currentCategory);
      setSelectedCategory(currentCategory || null);
    }
  }, [parameter]);

  // Handle input changes
  const handleInputChange = useCallback((field: string, value: string | boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  }, []);

  // Category handlers
  const handleCategorySelect = useCallback((category: string) => {
    setCategoryInputValue(category);
    setSelectedCategory(category);
    handleInputChange('kategorie', category);
  }, [handleInputChange]);

  const handleCategoryInputChange = useCallback((value: string) => {
    setCategoryInputValue(value);
    // Update the form state as well
    handleInputChange('kategorie', value);
  }, [handleInputChange]);

  const handleCreateCategory = useCallback(async () => {
    if (!categoryInputValue.trim()) return;
    setIsCreatingCategory(true);
    try {
      await createCategory(categoryInputValue.trim());
      setSelectedCategory(categoryInputValue.trim());
    } catch (error) {
      console.error('Failed to create category:', error);
    } finally {
      setIsCreatingCategory(false);
    }
  }, [categoryInputValue, createCategory]);

  const handleRenameCategory = useCallback(async () => {
    if (!selectedCategory || !categoryInputValue.trim() || categoryInputValue.trim() === selectedCategory) {
      return;
    }
    setIsRenamingCategory(true);
    try {
      await renameCategory(selectedCategory, categoryInputValue.trim());
      setSelectedCategory(categoryInputValue.trim());
    } catch (error) {
      console.error('Failed to rename category:', error);
    } finally {
      setIsRenamingCategory(false);
    }
  }, [selectedCategory, categoryInputValue, renameCategory]);

  const handleDeleteCategory = useCallback(async (categoryName: string) => {
    if (!categoryName) return;
    const confirmed = window.confirm(
      DELETE_CATEGORY_CONFIRM_TEXT.replace('{category}', categoryName)
    );
    if (!confirmed) return;
    try {
      await deleteCategory(categoryName);
      if (selectedCategory === categoryName) {
        setCategoryInputValue('');
        setSelectedCategory(null);
        handleInputChange('kategorie', '');
      }
    } catch (error) {
      console.error('Failed to delete category:', error);
    }
  }, [deleteCategory, selectedCategory, handleInputChange]);

  // Check if current input is different from selected category (for rename button)
  const canRename = selectedCategory && categoryInputValue.trim() && 
                   categoryInputValue.trim() !== selectedCategory &&
                   !managedCategories.includes(categoryInputValue.trim());

  // Check if we can create new category
  const canCreate = categoryInputValue.trim() && 
                   !managedCategories.includes(categoryInputValue.trim()) &&
                   !selectedCategory;

  // Handle save
  const handleSave = useCallback(async () => {
    if (!parameter) return;
    // Alarm validation: if alarm enabled, both thresholds must be provided
    if (settings.isAlarmEnabled) {
      const minMissing = settings.alarmMinThreshold.trim() === '';
      const maxMissing = settings.alarmMaxThreshold.trim() === '';
      if (minMissing || maxMissing) {
        console.error('[ParameterSettingsModal] ❌ Alarm enabled but thresholds missing');
        alert(ALARM_VALIDATION_MESSAGE);
        return;
      }
    }
    
    setIsSaving(true);
    try {
      // Convert form values to appropriate types and ONLY include changed values
      const updates: Partial<ParameterInfo> = {};
      
      // Handle text values - only if changed (removed displayName)
      // For time parameters, don't save unit field as it's handled by timeFormat
      if (!settings.isTimeData && settings.unit.trim() !== (parameter.unit || '')) {
        updates.unit = settings.unit.trim();
      }
      
      if (settings.description.trim() !== (parameter.description || '')) {
        updates.description = settings.description.trim();
      }
      
      // Only persist color if user provided a non-empty value and it actually changed
      const trimmedColor = settings.color.trim();
      if (trimmedColor !== '' && trimmedColor !== (parameter.color || '')) {
        updates.color = trimmedColor;
      }
      
      if (settings.yAxisID.trim() !== (parameter.yAxisID || '')) {
        updates.yAxisID = settings.yAxisID.trim();
      }
      
      if (settings.icon.trim() !== (parameter.icon || '')) {
        updates.icon = settings.icon.trim();
      }
      
      // Handle kategorie separately - use categoryInputValue instead of settings.kategorie
      const currentKategorie = (parameter as any).kategorie !== undefined ? (parameter as any).kategorie : '';
      const newKategorie = categoryInputValue.trim();
      if (newKategorie !== currentKategorie) {
        (updates as any).kategorie = newKategorie;
      }
      
      // Handle dataType separately
      const currentDataType = (parameter as any).dataType !== undefined ? (parameter as any).dataType : '';
      const newDataType = settings.dataType.trim();
      if (newDataType !== currentDataType) {
        (updates as any).dataType = newDataType;
      }
      
      // Handle decimalPlaces - depends on dataType
      const currentDecimalPlaces = (parameter as any).decimalPlaces !== undefined ? (parameter as any).decimalPlaces : null;
      
      if (newDataType === 'float' || (newDataType === '' && isFloatType())) {
        // For float types, handle decimalPlaces
        if (settings.decimalPlaces.trim() !== '') {
          const newDecimalPlaces = parseInt(settings.decimalPlaces, 10);
          if (!isNaN(newDecimalPlaces) && newDecimalPlaces !== currentDecimalPlaces) {
            (updates as any).decimalPlaces = newDecimalPlaces;
          }
        }
      } else if (newDataType === 'int' || newDataType === 'bool' || newDataType === 'string') {
        // For non-float types, remove decimalPlaces if it exists
        if (currentDecimalPlaces !== null && currentDecimalPlaces !== undefined) {
          (updates as any).decimalPlaces = null; // This will remove the field in Firestore
        }
      }
      
      // Handle numeric values - only if changed
      const currentDivisor = parameter.divisor !== undefined && parameter.divisor !== null ? parameter.divisor : undefined;
      if (settings.divisor.trim() !== '') {
        const newDivisor = parseFloat(settings.divisor);
        if (!isNaN(newDivisor) && newDivisor !== currentDivisor) {
          updates.divisor = newDivisor;
        }
      } else if (currentDivisor !== undefined) {
        // Clear divisor if form is empty and parameter had a value
        updates.divisor = undefined;
      }
      
      const currentForm = parameter.form !== undefined && parameter.form !== null ? parameter.form : 0;
      const newForm = parseInt(settings.form);
      if (!isNaN(newForm) && newForm !== currentForm) {
        updates.form = newForm;
      }
      
      const isClearingValue = (val: string) => {
        const v = val.trim();
        return v === '' || v === '-';
      };
      
      const currentMinValue = parameter.minValue !== undefined && parameter.minValue !== null ? parameter.minValue : undefined;
      if (!isClearingValue(settings.minValue)) {
        const newMinValue = parseFloat(settings.minValue);
        if (!isNaN(newMinValue) && newMinValue !== currentMinValue) {
          updates.minValue = newMinValue;
        }
      } else {
        // Explicitly clear min when empty or "-"
        if (currentMinValue !== undefined) {
          updates.minValue = null as any;
        }
      }
      
      const currentMaxValue = parameter.maxValue !== undefined && parameter.maxValue !== null ? parameter.maxValue : undefined;
      if (!isClearingValue(settings.maxValue)) {
        const newMaxValue = parseFloat(settings.maxValue);
        if (!isNaN(newMaxValue) && newMaxValue !== currentMaxValue) {
          updates.maxValue = newMaxValue;
        }
      } else {
        // Explicitly clear max when empty or "-"
        if (currentMaxValue !== undefined) {
          updates.maxValue = null as any;
        }
      }
      
      const currentPosition = parameter.position !== undefined && parameter.position !== null && parameter.position !== Infinity ? parameter.position : undefined;
      if (settings.position.trim() !== '') {
        const newPosition = parseInt(settings.position);
        if (!isNaN(newPosition) && newPosition !== currentPosition) {
          updates.position = newPosition;
        }
      } else if (currentPosition !== undefined) {
        updates.position = undefined;
      }
      
      // Handle zugriff - compare as strings
      const currentZugriff = parameter.zugriff !== undefined ? parameter.zugriff : DEFAULT_ZUGRIFF;
      const newZugriff = settings.zugriff;
      if (newZugriff !== currentZugriff) {
        updates.zugriff = newZugriff;
      }

      // Handle alarm settings
      const currentIsAlarmEnabled = Boolean((parameter as any).isAlarmEnabled);
      const newIsAlarmEnabled = settings.isAlarmEnabled;
      
      if (newIsAlarmEnabled !== currentIsAlarmEnabled) {
        (updates as any).isAlarmEnabled = newIsAlarmEnabled;
        
        if (!newIsAlarmEnabled) {
          // When disabling alarm mode, remove alarm-related fields
          (updates as any).alarmMinThreshold = null;
          (updates as any).alarmMaxThreshold = null;
          // Also emit a success recovery immediately (UI feedback)
          try {
            const evt = new CustomEvent(ALARM_TOAST_EVENT, { detail: { deviceId: (parameter as any).deviceId, parameterName: parameter.originalName, alarmType: 'recovered', resolved: true } });
            window.dispatchEvent(evt);
          } catch {}
        }
      }

      if (newIsAlarmEnabled) {
        // Handle alarm threshold values
        const currentAlarmMinThreshold = (parameter as any).alarmMinThreshold;
        const currentAlarmMaxThreshold = (parameter as any).alarmMaxThreshold;
        
        if (settings.alarmMinThreshold.trim() !== '') {
          const newAlarmMinThreshold = parseFloat(settings.alarmMinThreshold);
          if (!isNaN(newAlarmMinThreshold) && newAlarmMinThreshold !== currentAlarmMinThreshold) {
            (updates as any).alarmMinThreshold = newAlarmMinThreshold;
          }
        } else if (currentAlarmMinThreshold !== undefined) {
          (updates as any).alarmMinThreshold = null;
        }
        
        if (settings.alarmMaxThreshold.trim() !== '') {
          const newAlarmMaxThreshold = parseFloat(settings.alarmMaxThreshold);
          if (!isNaN(newAlarmMaxThreshold) && newAlarmMaxThreshold !== currentAlarmMaxThreshold) {
            (updates as any).alarmMaxThreshold = newAlarmMaxThreshold;
          }
        } else if (currentAlarmMaxThreshold !== undefined) {
          (updates as any).alarmMaxThreshold = null;
        }
      }

      // Handle time data settings
      const currentIsTimeData = Boolean((parameter as any).isTimeData);
      const newIsTimeData = settings.isTimeData;
      
      if (newIsTimeData !== currentIsTimeData) {
        (updates as any).isTimeData = newIsTimeData;
        
        if (!newIsTimeData) {
          // When disabling time mode, remove time-related fields (hard delete via saveMetadata)
          (updates as any).timeFormat = null;
          (updates as any).timeInputUnit = null;
        }
      }

      if (newIsTimeData) {
        // Ensure timeFormat and timeInputUnit are saved when enabling or if missing in Firestore
        const storedTimeFormat = (parameter as any).timeFormat;
        const storedTimeInputUnit = (parameter as any).timeInputUnit;
        const newTimeFormat = settings.timeFormat;
        const newTimeInputUnit = settings.timeInputUnit;

        if (storedTimeFormat === undefined || storedTimeFormat === null || storedTimeFormat !== newTimeFormat) {
          (updates as any).timeFormat = newTimeFormat;
        }

        if (storedTimeInputUnit === undefined || storedTimeInputUnit === null || storedTimeInputUnit !== newTimeInputUnit) {
          (updates as any).timeInputUnit = newTimeInputUnit;
        }
        
        // Auto-calculate divisor based on time settings
        const calculatedDivisor = calculateTimeDivisor(newTimeInputUnit as any, newTimeFormat as any);
        const currentDivisor = parameter.divisor || 1;
        if (calculatedDivisor !== currentDivisor) {
          updates.divisor = calculatedDivisor;
        }
      }

      if (Object.keys(updates).length > 0) {
        await onSave(parameter.originalName, updates);
        try {
          const event = new CustomEvent(PARAMETER_SETTINGS_CHANGED_EVENT, {
            detail: { parameterName: parameter.originalName, updates }
          });
          window.dispatchEvent(event);
        } catch (e) {
          console.warn('[ParameterSettingsModal] Failed to dispatch parameterSettingsChanged event:', e);
        }
        onClose();
      } else {
        onClose();
      }
    } catch (error) {
      console.error('[ParameterSettingsModal] ❌ Error saving parameter settings:', error);
    } finally {
      setIsSaving(false);
    }
  }, [parameter, settings, categoryInputValue, onSave, onClose, isFloatType]);

  // Derived validation state for Alarm thresholds
  const alarmValidationError = React.useMemo(() => {
    if (!settings.isAlarmEnabled) return '';
    const minMissing = settings.alarmMinThreshold.trim() === '';
    const maxMissing = settings.alarmMaxThreshold.trim() === '';
    return (minMissing || maxMissing) ? ALARM_VALIDATION_MESSAGE : '';
  }, [settings.isAlarmEnabled, settings.alarmMinThreshold, settings.alarmMaxThreshold]);

  const inputClass = 'w-full px-3 py-2 border border-border rounded bg-card text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary';

  const selectClass = inputClass;


  // Test alarm functions (developer only)
  const testAlarm = useCallback(async () => {
    if (!parameter || !user || user.role !== 'developer') return;
    setIsTestingAlarm(true);
    try {
      const paramId = parameter.originalName;
      const currentValueRaw = (useStoveStore.getState().currentData as any)?.[paramId];
      const currentValue = Number(currentValueRaw);
      if (!isFinite(currentValue)) {
        console.warn('[ParameterSettings] Cannot start test alarm: current value is not numeric');
        setIsTestingAlarm(false);
        return;
      }
      const originalMax = settings.alarmMaxThreshold?.trim?.() || '';
      const originalMaxNum = originalMax !== '' ? parseFloat(originalMax) : undefined;
      const delta = Math.max(TEST_ALARM_DELTA_MIN, Math.abs(currentValue) * TEST_ALARM_DELTA_RATIO);
      const newMax = currentValue - delta;
      if (!firestoreDB) throw new Error('Firestore not initialized');
      const ref = fsDoc(firestoreDB, 'masse_und_gewichte', paramId);
      await fsSetDoc(ref, { 'max-alarm': newMax, 'test-alarm-active': true }, { merge: true });
      try {
        const evt = new CustomEvent(PARAMETER_SETTINGS_CHANGED_EVENT, { detail: { parameterName: paramId, updates: { 'max-alarm': newMax } } });
        window.dispatchEvent(evt);
      } catch {}
      // Revert after 20s
      setTimeout(async () => {
        try {
          if (originalMaxNum !== undefined && !isNaN(originalMaxNum)) {
            await fsSetDoc(ref, { 'max-alarm': originalMaxNum, 'test-alarm-active': false }, { merge: true });
          } else {
            await fsSetDoc(ref, { 'max-alarm': currentValue + 1000, 'test-alarm-active': false }, { merge: true });
          }
          try {
            const evt2 = new CustomEvent(PARAMETER_SETTINGS_CHANGED_EVENT, { detail: { parameterName: paramId, updates: { 'max-alarm': originalMaxNum } } });
            window.dispatchEvent(evt2);
          } catch {}
        } catch (e) {
          console.warn('[ParameterSettings] TEST: revert failed:', e);
        } finally {
          setIsTestingAlarm(false);
        }
      }, TEST_ALARM_REVERT_DELAY_MS);
    } catch (error) {
      console.error('[ParameterSettings] TEST failed:', error);
      setIsTestingAlarm(false);
    }
  }, [parameter, user, settings.alarmMaxThreshold, firestoreDB]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      
      // Close color palette
      if (showColorPalette && !target.closest('.color-picker-section')) {
        setShowColorPalette(false);
      }
      
      // Close icon picker
      if (showIconPicker && !target.closest('.icon-picker-section')) {
        setShowIconPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showColorPalette, showIconPicker]);

  if (!isOpen || !parameter) return null;

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-md p-4 flex items-center justify-center z-50">
      <div className="bg-card text-foreground rounded-xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
        {/* Header - Fixed */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/70 dark:bg-muted/50">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t('parameterSettings.title')}</h2>
            <p className="text-sm text-muted-foreground mt-1 font-mono">
              {parameter.originalName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-destructive"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Visual Settings */}
            <div className="space-y-4">
              <h3 className={'text-lg font-medium text-foreground border-b border-border pb-2'}>
                {t('parameterSettings.sections.visual')}
              </h3>
              
              {/* Color */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="color-picker-section">
                  <label className={'block text-sm font-medium text-foreground mb-2'}>
                    {t('parameterSettings.fields.color')}
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={settings.color}
                      onChange={(e) => handleInputChange('color', e.target.value)}
                      className={inputClass}
                      placeholder="#1f77b4"
                    />
                    <div
                      className={'w-10 h-10 rounded border border-border cursor-pointer bg-card'}
                      style={{ backgroundColor: settings.color || '#1f77b4' }}
                      onClick={() => setShowColorPalette(!showColorPalette)}
                      title={t('parameterSettings.fields.chooseColor') as string}
                    />
                  </div>
                  
                  {/* Color Palette */}
                  {showColorPalette && (
                    <div className={'mt-2 p-3 border border-border rounded bg-muted'}>
                      <div className="grid grid-cols-8 gap-2">
                        {COLOR_PALETTE.map((color) => (
                          <div
                            key={color}
                            className={'w-8 h-8 rounded cursor-pointer border-2 border-border hover:border-primary'}
                            style={{ backgroundColor: color }}
                            onClick={() => {
                              handleInputChange('color', color);
                              setShowColorPalette(false);
                            }}
                            title={color}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Form Type */}
                <div>
                  <label className={'block text-sm font-medium text-foreground mb-2'}>
                    {t('parameterSettings.fields.lineType')}
                  </label>
                  <select
                    value={settings.form}
                    onChange={(e) => handleInputChange('form', e.target.value)}
                    className={selectClass}
                  >
                    <option value="0">{t('parameterSettings.fields.smoothLine')}</option>
                    <option value="1">{t('parameterSettings.fields.steppedLine')}</option>
                  </select>
                </div>
              </div>

              {/* Icon */}
              <div className="icon-picker-section">
                <label className={'block text-sm font-medium text-foreground mb-2'}>
                  {t('parameterSettings.fields.icon')}
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={settings.icon}
                    onChange={(e) => handleInputChange('icon', e.target.value)}
                    className={inputClass}
                    placeholder={t('parameterSettings.fields.iconPlaceholder') as string}
                  />
                  <button
                    type="button"
                    onClick={() => setShowIconPicker(!showIconPicker)}
                    className={'w-10 h-10 border border-border rounded hover:border-primary cursor-pointer bg-card flex items-center justify-center text-lg'}
                    title={t('parameterSettings.fields.chooseIcon') as string}
                  >
                    {settings.icon ? (
                      settings.icon.startsWith('fa-') ? (
                        <i className={`fas ${settings.icon} ${'text-foreground'}`}></i>
                      ) : (
                        <span>{settings.icon}</span>
                      )
                    ) : (
                      '🔍'
                    )}
                  </button>
                </div>
                
                {/* Icon Picker */}
                {showIconPicker && (
                    <div className={'mt-2 border border-border rounded bg-muted'}>
                    {/* Header with tabs */}
                      <div className="flex items-center justify-between p-3 border-b border-border">
                      <div className="flex space-x-1">
                        <button
                          type="button"
                          onClick={() => setIconTab('emoji')}
                            className={`px-3 py-1 text-xs font-medium rounded ${
                            iconTab === 'emoji'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground hover:bg-muted/80'
                          }`}
                        >
                          {t('parameterSettings.fields.emojiTab')} 😊
                        </button>
                        <button
                          type="button"
                          onClick={() => setIconTab('fa')}
                            className={`px-3 py-1 text-xs font-medium rounded ${
                            iconTab === 'fa'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground hover:bg-muted/80'
                          }`}
                        >
                          <i className="fas fa-icons mr-1"></i>{t('parameterSettings.fields.fontawesomeTab')}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handleInputChange('icon', '');
                          setShowIconPicker(false);
                        }}
                        className="text-xs text-destructive hover:text-destructive/80"
                      >
                        {t('parameterSettings.fields.clear')}
                      </button>
                    </div>
                    
                    {/* Content */}
                    <div className="p-3 max-h-64 overflow-y-auto">
                      {iconTab === 'emoji' ? (
                        <div>
                          <div className="mb-2">
                            <span className="text-xs font-medium text-foreground">{t('parameterSettings.fields.emojiPopular')}</span>
                          </div>
                          <div className="grid grid-cols-8 gap-1">
                            {POPULAR_EMOJIS.map((emoji, index) => (
                              <button
                                key={index}
                                type="button"
                                onClick={() => {
                                  handleInputChange('icon', emoji);
                                  setShowIconPicker(false);
                                }}
                                className={`w-8 h-8 rounded border cursor-pointer flex items-center justify-center text-sm ${
                                  settings.icon === emoji
                                    ? 'border-primary ring-1 ring-primary/60 bg-card'
                                    : 'border-border bg-card hover:border-primary'
                                }`}
                                title={emoji}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {FONT_AWESOME_ICONS.map((category) => (
                            <div key={category.category}>
                              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">
                                {category.category}
                              </h4>
                              <div className="grid grid-cols-5 gap-1">
                                {category.icons.map((iconItem) => (
                                  <button
                                    key={iconItem.icon}
                                    type="button"
                                    onClick={() => {
                                      handleInputChange('icon', iconItem.icon);
                                      setShowIconPicker(false);
                                    }}
                                    className={`w-10 h-10 rounded border cursor-pointer flex items-center justify-center ${
                                      settings.icon === iconItem.icon
                                        ? 'border-primary ring-1 ring-primary/60 bg-card'
                                        : 'border-border bg-card hover:border-primary'
                                    }`}
                                    title={iconItem.name}
                                  >
                                    <i className={`fas ${iconItem.icon} text-sm ${'text-foreground'}`}></i>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <div className="px-3 py-2 border-t border-border bg-muted/60">
                      <p className="text-xs text-muted-foreground">
                        💡 {t('parameterSettings.fields.emojiTip')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Data Settings */}
            <div className="space-y-4">
              <h3 className={'text-lg font-medium text-foreground border-b border-border pb-2'}>
                {t('parameterSettings.sections.data')}
              </h3>
              
              {/* Alarm Settings */}
              <div className="space-y-4 p-4 bg-muted border border-border rounded">
                <div className="mb-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.isAlarmEnabled}
                      onChange={(e) => handleInputChange('isAlarmEnabled', e.target.checked)}
                      className="mr-3 h-4 w-4 text-destructive focus:ring-destructive border-border rounded"
                    />
                    <span className="text-sm font-medium text-foreground">
                      {t('parameterSettings.fields.alarm')}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({t('parameterSettings.fields.alarmDescription')})
                    </span>
                  </label>
                </div>

                {/* Alarm Threshold Fields - only show when alarm is enabled */}
                {settings.isAlarmEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Min Threshold */}
                    <div>
                      <label className={'block text-sm font-medium text-foreground mb-2'}>
                        {t('parameterSettings.fields.alarmMinThreshold')}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={settings.alarmMinThreshold}
                        onChange={(e) => handleInputChange('alarmMinThreshold', e.target.value)}
                        className={`${inputClass} focus:ring-destructive focus:border-destructive`}
                        placeholder={t('parameterSettings.fields.alarmMinPlaceholder') as string}
                      />
                    </div>
                    
                    {/* Max Threshold */}
                    <div>
                      <label className={'block text-sm font-medium text-foreground mb-2'}>
                        {t('parameterSettings.fields.alarmMaxThreshold')}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={settings.alarmMaxThreshold}
                        onChange={(e) => handleInputChange('alarmMaxThreshold', e.target.value)}
                        className={`${inputClass} focus:ring-destructive focus:border-destructive`}
                        placeholder={t('parameterSettings.fields.alarmMaxPlaceholder') as string}
                      />
                    </div>
                  </div>
                )}
                {settings.isAlarmEnabled && alarmValidationError && (
                  <div className="text-xs text-destructive">
                    {alarmValidationError}
                  </div>
                )}
                
                {/* Developer Test Section */}
                {(user?.role === 'developer' || user?.role === 'super_admin') && settings.isAlarmEnabled && !alarmValidationError && (
                  <div className="mt-4 p-3 rounded-lg border border-primary/40 bg-primary/10">
                    <h4 className="text-sm font-medium text-primary mb-3">
                      Test Alarm System
                    </h4>

                    <p className="text-xs text-primary mb-3">
                      Test the alarm system with a 20-second simulated alarm. Other devices connected to the same device will also see this test.
                    </p>
                    
                    {/* Single Test Button */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={testAlarm}
                        disabled={isTestingAlarm}
                        className="px-4 py-2 text-sm font-medium bg-destructive text-destructive-foreground rounded border border-border disabled:opacity-60 flex items-center space-x-2"
                      >
                        {isTestingAlarm ? (
                          <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>Testing... (20s)</span>
                          </>
                        ) : (
                          <>
                            <span>Test Alarm</span>
                          </>
                        )}
                      </button>
                    </div>
                    
                    {isTestingAlarm && (
                      <div className="mt-3 text-xs text-primary text-center">
                        Test alarm active for 20 seconds. Check the red alarm button!
                      </div>
                    )}

                    {/* Emergency Controls */}
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex flex-col space-y-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const cleaned = forceCleanupStuckTests();
                            console.log(`[Emergency] Cleaned ${cleaned} stuck tests`);
                            // Also resolve Firestore test alarms for current device
                            try {
                              const deviceId = currentDeviceId || undefined;
                              const resolvedCount = await (testAlarmManager as any).resolveAllTestAlarmsFirestore?.(deviceId);
                              console.log(`[Emergency] Resolved ${resolvedCount} Firestore test alarms${deviceId ? ' for ' + deviceId : ''}`);
                            } catch {}
                          }}
                          className="px-2 py-1 text-xs text-warning bg-warning/10 border border-warning/40 rounded hover:brightness-95"
                        >
                          Clean Stuck Tests
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            emergencyStopAllTests();
                            console.log('[Emergency] All tests stopped');
                          }}
                          className="px-2 py-1 text-xs text-destructive bg-destructive/10 border border-destructive/40 rounded hover:brightness-95"
                        >
                          Emergency Stop All
                        </button>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Use these if test alarms get stuck or won't stop
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Time Data Checkbox */}
              <div className="mb-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.isTimeData}
                    onChange={(e) => handleInputChange('isTimeData', e.target.checked)}
                    className="mr-3 h-4 w-4 text-primary focus:ring-primary border-border rounded"
                  />
                  <span className="text-sm font-medium text-foreground">
                    Ist Zeitangabe
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    (Werte werden als Zeit angezeigt)
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Unit/Time Format */}
                <div>
                  <label className={'block text-sm font-medium text-foreground mb-2'}>
                    {settings.isTimeData ? 'Zeitformat' : t('parameterSettings.fields.unit')}
                  </label>
                  {settings.isTimeData ? (
                    <div className="space-y-2">
                      <select
                        value={settings.timeFormat}
                        onChange={(e) => handleInputChange('timeFormat', e.target.value)}
                        className={selectClass}
                      >
                        {TIME_FORMAT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          Eingehende Dateneinheit
                        </label>
                        <select
                          value={settings.timeInputUnit}
                          onChange={(e) => handleInputChange('timeInputUnit', e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary bg-card text-foreground"
                        >
                          <option value="ms">Millisekunden (ms)</option>
                          <option value="s">Sekunden (s)</option>
                          <option value="min">Minuten (min)</option>
                          <option value="h">Stunden (h)</option>
                        </select>
                        <p className="text-xs text-muted-foreground mt-1">
                          In welcher Einheit kommen die Rohdaten an (vor Divisor)
                        </p>
                      </div>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={settings.unit}
                      onChange={(e) => handleInputChange('unit', e.target.value)}
                      className={inputClass}
                      placeholder={t('parameterSettings.fields.unit') as string}
                    />
                  )}
                </div>
                
                {/* Divisor */}
                <div>
                  <label className={'block text-sm font-medium text-foreground mb-2'}>
                    {t('parameterSettings.fields.divisor')}
                    {settings.isTimeData && (
                      <span className="ml-2 text-xs text-muted-foreground">(automatisch berechnet)</span>
                    )}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={settings.isTimeData ? 
                      calculateTimeDivisor(settings.timeInputUnit as any, settings.timeFormat as any) : 
                      settings.divisor
                    }
                    onChange={(e) => handleInputChange('divisor', e.target.value)}
                    disabled={settings.isTimeData}
                    className={`w-full px-3 py-2 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-foreground ${
                      settings.isTimeData
                        ? 'bg-muted cursor-not-allowed opacity-75'
                        : 'bg-card'
                    }`}
                    placeholder="1"
                  />
                  {settings.isTimeData && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Wird automatisch basierend auf Zeiteinstellungen berechnet
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Min Value */}
                <div>
                  <label className={'block text-sm font-medium text-foreground mb-2'}>
                    {t('parameterSettings.fields.minValue')}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={settings.minValue}
                    onChange={(e) => handleInputChange('minValue', e.target.value)}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>
                
                {/* Max Value */}
                <div>
                  <label className={'block text-sm font-medium text-foreground mb-2'}>
                    {t('parameterSettings.fields.maxValue')}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={settings.maxValue}
                    onChange={(e) => handleInputChange('maxValue', e.target.value)}
                    className={inputClass}
                    placeholder="100"
                  />
                </div>
              </div>
            </div>

            {/* Organization Settings */}
            <div className="space-y-4">
              <h3 className={'text-lg font-medium text-foreground border-b border-border pb-2'}>
                {t('parameterSettings.sections.organization')}
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Enhanced Category Management */}
                <div className="space-y-3">
                  <label className={'block text-sm font-medium text-foreground mb-2'}>
                    {t('parameterSettings.fields.category')}
                  </label>
                  
                  {/* Category Input Field */}
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={categoryInputValue}
                      onChange={(e) => handleCategoryInputChange(e.target.value)}
                      className={inputClass}
                      placeholder="Kategoriename eingeben..."
                    />
                    
                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2">
                      {/* Create Category Button */}
                      {canCreate && (
                        <button
                          type="button"
                          onClick={handleCreateCategory}
                          disabled={isCreatingCategory}
                          className="px-3 py-1 text-sm bg-success text-success-foreground rounded border border-border disabled:opacity-60 flex items-center space-x-1"
                        >
                          {isCreatingCategory ? (
                            <>
                              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span>Erstelle...</span>
                            </>
                          ) : (
                            <>
                              <span>Erstellen</span>
                            </>
                          )}
                        </button>
                      )}
                      
                      {/* Rename Category Button */}
                      {canRename && (
                        <button
                          type="button"
                          onClick={handleRenameCategory}
                          disabled={isRenamingCategory}
                          className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded border border-border disabled:opacity-60 flex items-center space-x-1"
                        >
                          {isRenamingCategory ? (
                            <>
                              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span>Benenne um...</span>
                            </>
                          ) : (
                            <>
                              <span>Umbenennen</span>
                            </>
                          )}
                        </button>
                      )}
                      
                      {/* Clear Category Button */}
                      {categoryInputValue && (
                        <button
                          type="button"
                          onClick={() => {
                            setCategoryInputValue('');
                            setSelectedCategory(null);
                            handleInputChange('kategorie', '');
                          }}
                          className="px-3 py-1 text-sm bg-muted text-foreground border border-border rounded hover:bg-muted/80"
                        >
                          Leeren
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Category Dropdown */}
                  {managedCategories.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Wählen Sie eine bestehende Kategorie:
                      </label>
                      <div className="max-h-32 overflow-y-auto border border-border rounded bg-card">
                        {/* No Category Option */}
                        <div
                          onClick={() => {
                            setCategoryInputValue('');
                            setSelectedCategory(null);
                            handleInputChange('kategorie', '');
                          }}
                          className={`px-3 py-2 cursor-pointer hover:bg-muted flex items-center justify-between text-sm ${
                            !categoryInputValue ? 'bg-primary/10 text-primary' : 'text-foreground'
                          }`}
                        >
                          <span className="italic">{t('parameterSettings.fields.noCategory')}</span>
                        </div>
                        
                        {/* Category List */}
                        {managedCategories.map(cat => (
                          <div
                            key={cat}
                            className={`px-3 py-2 cursor-pointer hover:bg-muted flex items-center justify-between text-sm border-t border-border ${
                              categoryInputValue === cat ? 'bg-primary/10 text-primary' : 'text-foreground'
                            }`}
                          >
                            <span
                              onClick={() => handleCategorySelect(cat)}
                              className="flex-1"
                            >
                              {cat}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCategory(cat);
                              }}
                              className="ml-2 text-destructive hover:text-destructive/80"
                              title="Kategorie löschen"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Position */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('parameterSettings.fields.position')}
                  </label>
                  <input
                    type="number"
                    value={settings.position}
                    onChange={(e) => handleInputChange('position', e.target.value)}
                    className={inputClass}
                    placeholder={t('parameterSettings.fields.sortOrder') as string}
                  />
                </div>
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-border pb-2">
                {t('parameterSettings.sections.advanced')}
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Access Level */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('parameterSettings.fields.accessLevel')}
                  </label>
                  <select
                    value={settings.zugriff}
                    onChange={(e) => handleInputChange('zugriff', e.target.value)}
                    className={selectClass}
                  >
                    <option value="r">{t('parameterSettings.fields.accessReadOnly')}</option>
                    <option value="rw">{t('parameterSettings.fields.accessReadWrite')}</option>
                    <option value="admin">{t('parameterSettings.fields.accessAdmin')}</option>
                  </select>
                </div>
                
                {/* Data Type */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('parameterSettings.fields.dataType')}
                  </label>
                  <select
                    value={settings.dataType}
                    onChange={(e) => handleInputChange('dataType', e.target.value)}
                    className={selectClass}
                  >
                    <option value="">{t('parameterSettings.fields.dataAutoDetect')}</option>
                    <option value="float">{t('parameterSettings.fields.dataFloat')}</option>
                    <option value="int">{t('parameterSettings.fields.dataInt')}</option>
                    <option value="bool">{t('parameterSettings.fields.dataBool')}</option>
                    <option value="string">{t('parameterSettings.fields.dataString')}</option>
                  </select>
                </div>
              </div>

              {/* Decimal Places - only for float types */}
              {isFloatType() && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('parameterSettings.fields.decimalPlaces')}
                    <span className="text-xs text-muted-foreground ml-1">
                      {t('parameterSettings.fields.decimalPlacesHint')}
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="12"
                    value={settings.decimalPlaces}
                    onChange={(e) => handleInputChange('decimalPlaces', e.target.value)}
                    className={inputClass}
                    placeholder="2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('parameterSettings.fields.decimalPlacesHelp')}
                  </p>
                </div>
              )}

              {/* Y-Axis ID */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('parameterSettings.fields.yAxisId')}
                </label>
                  <input
                  type="text"
                  value={settings.yAxisID}
                  onChange={(e) => handleInputChange('yAxisID', e.target.value)}
                  className={inputClass}
                  placeholder={t('parameterSettings.fields.yAxisIdPlaceholder') as string}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('parameterSettings.fields.description')}
                </label>
                <textarea
                  value={settings.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={3}
                  className={`${inputClass} resize-none`}
                  placeholder={t('parameterSettings.fields.descriptionPlaceholder') as string}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Fixed */}
        <div className="px-6 py-4 border-t border-border flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 text-foreground bg-muted hover:bg-muted/80 border border-border rounded"
          >
            {t('parameterSettings.footer.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || (settings.isAlarmEnabled && (!!alarmValidationError))}
            className="w-full sm:w-auto px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded flex items-center justify-center"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-primary-foreground" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {t('parameterSettings.footer.saving')}
              </>
            ) : (
              t('parameterSettings.footer.saveChanges')
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ParameterSettingsModal; 
import { useCallback, useRef, useEffect } from 'react';
import { useStoveStore, useNotificationHelpers } from '../store/useStoveStore';
import { useParameterMetadata } from './useFirebase';
import { useLocalSettings } from './useLocalSettings';
import type { StoveData, ParameterInfo } from '../types';
import { formatParameterValue as formatValue } from '../utils/parameterTypes';

// MAGIC: values <= 25 get their own y-axis by legacy rules
const SMALL_PARAM_MAX_VALUE_THRESHOLD = 25;
const DEFAULT_PARAM_COLOR = '#7f7f7f';
const DEFAULT_PARAM_DIVISOR = 1;
const FALLBACK_POSITION = 9999;
const UNCATEGORIZED_CATEGORY = 'uncategorized';
const SYSTEM_KEY_PREFIX = '~~';
const SYSTEM_KEYS = new Set(['id_timestamp', 'TRIG1', '__historical']);
// MAGIC: used to avoid zero divisor and ensure sane ranges
const DEFAULT_MIN_FOR_STATUS = 0;
const DEFAULT_MAX_FOR_STATUS = 7;

// MAGIC: curated palette keeps legacy color ordering
const COLOR_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
  '#e377c2', '#7f7f7f', '#bcbd22', '#17becf', '#aec7e8', '#ffbb78',
  '#98df8a', '#ff9896', '#c5b0d5', '#c49c94', '#f7b6d2', '#c7c7c7',
  '#dbdb8d', '#9edae5', '#393b79', '#5254a3', '#6b6ecf', '#9c9ede',
  '#637939', '#8ca252', '#b5cf6b', '#cedb9c', '#8c6d31', '#bd9e39',
  '#e7ba52', '#e7cb94', '#843c39', '#ad494a', '#d6616b', '#e7969c',
  '#7b4173', '#a55194', '#ce6dbd', '#de9ed6'
];

// Cache for Firebase metadata like in legacy
const firebaseParameterMetadataCache: Record<string, any> = {};

// Base parameter definitions (exact match with legacy)
const baseParameterMetadata: Record<string, Partial<ParameterInfo>> = {
  T: { 
    displayName: "Temperature", 
    unit: "°C", 
    icon: "fa-thermometer-half", 
    defaultChart: true, 
    isInitiallyVisibleOnChart: true, 
    color: "#d62728", 
    divisor: 1, 
    description: "Main flue gas temperature.",
    minValue: 0,
    maxValue: 700
  },
  PL: { 
    displayName: "Screen Air", 
    unit: "%", 
    icon: "fa-wind", 
    defaultChart: true, 
    isInitiallyVisibleOnChart: true, 
    color: "#1f77b4", 
    divisor: 1, 
    description: "Primary air supply through the screen.",
    minValue: 0,
    maxValue: 100
  },
  SL: { 
    displayName: "Rear Air", 
    unit: "%", 
    icon: "fa-wind", 
    defaultChart: true, 
    isInitiallyVisibleOnChart: true, 
    color: "#2ca02c", 
    divisor: 1, 
    description: "Secondary air supply from the rear.",
    minValue: 0,
    maxValue: 100
  },
  P: { 
    displayName: "Performance", 
    unit: "%", 
    icon: "fa-tachometer-alt", 
    defaultChart: true, 
    isInitiallyVisibleOnChart: true, 
    color: "#ff7f0e", 
    divisor: 1, 
    description: "Calculated stove performance.",
    minValue: 0,
    maxValue: 100
  },
  N: { 
    displayName: "Reload Status", 
    unit: "", 
    icon: "fa-sync", 
    defaultChart: true, 
    isInitiallyVisibleOnChart: true, 
    color: "#9467bd", 
    divisor: 1, 
    form: 1, 
    description: "Status of the reloading process (0-7).",
    minValue: 0,
    maxValue: 7
  }
};

const defaultMetadataValues: Partial<ParameterInfo> = {
  displayName: "", // Will be set to originalName
  unit: "",
  description: "Parameter data",
  icon: "fa-tag",
  divisor: DEFAULT_PARAM_DIVISOR,
  minValue: undefined,
  maxValue: undefined,
  defaultChart: false,
  isInitiallyVisibleOnChart: false,
  form: 0,
  color: DEFAULT_PARAM_COLOR,
  favorite: 0,
  position: Infinity,
  show_in_legend: false,
  visible_on_chart: false
};

// (removed unused DEFAULT_COLORS)

export const useParameterDiscovery = () => {
  const deviceId = useStoveStore(state => state.deviceId);
  const setDiscoveredParameters = useStoveStore(state => state.setDiscoveredParameters);
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);
  const { showError, showInfo } = useNotificationHelpers();
  const { fetchMetadata, setupParameterListener } = useParameterMetadata();
  const { getAllParameterSettings, setColor, setPosition } = useLocalSettings();
  
  // Caching refs like legacy
  const processedParametersRef = useRef<Set<string>>(new Set());
  const lastDiscoveryTimeRef = useRef<number>(0);
  const colorIndexRef = useRef(Object.keys(baseParameterMetadata).length);
  // Log de-duplication for color assignments
  const loggedLocalColorRef = useRef<Set<string>>(new Set());
  const loggedFirebaseColorRef = useRef<Set<string>>(new Set());
  const loggedGeneratedColorRef = useRef<Set<string>>(new Set());
  // LEGACY: reserved for debug logging of color sources
  void loggedLocalColorRef;
  void loggedFirebaseColorRef;
  void loggedGeneratedColorRef;
  
  // Get next color - efficient like legacy
  const getNextAvailableColor = useCallback(() => {
    const usedColors = new Set(
      discoveredParameters.map(p => p.color?.toLowerCase()).filter(Boolean)
    );
    
    // Add base parameter colors to used set
    Object.values(baseParameterMetadata).forEach(base => {
      if (base.color) usedColors.add(base.color.toLowerCase());
    });
  
    for (let i = 0; i < COLOR_PALETTE.length; i++) {
      const candidateColor = COLOR_PALETTE[(colorIndexRef.current + i) % COLOR_PALETTE.length];
      if (!usedColors.has(candidateColor.toLowerCase())) {
        colorIndexRef.current = (colorIndexRef.current + i + 1) % COLOR_PALETTE.length;
        return candidateColor;
      }
    }
  
    // Fallback: random color
    // MAGIC: legacy fallback ensures a color even if palette is exhausted
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  }, [discoveredParameters]);

  // Reset discovery cache when disconnecting
  useEffect(() => {
    if (!deviceId) {
      processedParametersRef.current.clear();
      lastDiscoveryTimeRef.current = 0;
      // Clear Firebase metadata cache
      Object.keys(firebaseParameterMetadataCache).forEach(key => {
        delete firebaseParameterMetadataCache[key];
      });
    }
  }, [deviceId]);

  // Debug function to test Firestore connection
  const testFirestoreConnection = useCallback(async () => {
    showInfo('Testing Firestore connection...');
    
    try {
      // Test loading metadata for a basic parameter
      const testParam = 'T';
      const metadata = await fetchMetadata(testParam);
      
      if (metadata) {
        showInfo(`✅ Firestore works! Found metadata for ${testParam}: ${JSON.stringify(metadata)}`);
      } else {
        showInfo(`⚠️ No metadata found for ${testParam} in Firestore (this might be normal)`);
      }
      
    } catch (error) {
      console.error('[ParameterDiscovery] ❌ Firestore test failed:', error);
      showError(`❌ Firestore test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [fetchMetadata, showError, showInfo]);

  const parseParameterAsync = useCallback(async (rawParamName: string): Promise<ParameterInfo> => {
    // Check cache first (like legacy)
    const cached = firebaseParameterMetadataCache[rawParamName];
    let fbMeta = cached;
    
    if (!cached) {
      // RESTORED: Create listener for fast metadata updates
      try { 
        setupParameterListener(rawParamName);
      } catch (err) {
        console.warn(`[ParameterDiscovery] Failed to setup listener for ${rawParamName}:`, err);
      }

      // Fetch initial metadata in background (one-time)
      const meta = await fetchMetadata(rawParamName);
      if (meta && Object.keys(meta).length > 0) {
        firebaseParameterMetadataCache[rawParamName] = meta;
        fbMeta = meta;
      } else {
        firebaseParameterMetadataCache[rawParamName] = {}; // Cache that no metadata exists
        fbMeta = {} as any;
      }
    } else {
      fbMeta = cached;
    }

    // Start with defaults, then base metadata, then Firebase metadata
    const baseMeta = baseParameterMetadata[rawParamName] || {};
    
    const parsed: ParameterInfo = {
      ...defaultMetadataValues,
      ...baseMeta,
      originalName: rawParamName,
      displayName: rawParamName, // Always use the original Firebase parameter name with underscores
    } as ParameterInfo;

    // For base parameters, set show_in_legend to true and visible_on_chart based on isInitiallyVisibleOnChart
    if (baseMeta.defaultChart) {
      parsed.show_in_legend = true;
      parsed.visible_on_chart = baseMeta.isInitiallyVisibleOnChart !== undefined ? baseMeta.isInitiallyVisibleOnChart : false;
    }

    // Apply Firebase metadata if available
    if (fbMeta && Object.keys(fbMeta).length > 0) {
      // Skip setting displayName from Firebase - always use originalName
      if (fbMeta.einheit !== undefined) {
        parsed.unit = fbMeta.einheit;
      }
      const slLegacyUnit = fbMeta.einheitLegacy ?? (fbMeta as any).eimheit;
      if (rawParamName === 'SL' && slLegacyUnit !== undefined &&
          (parsed.unit === "" || parsed.unit === defaultMetadataValues.unit)) {
        parsed.unit = slLegacyUnit as string;
      }
      if (fbMeta.div !== undefined && !isNaN(parseFloat(fbMeta.div)) && parseFloat(fbMeta.div) !== 0) {
        parsed.divisor = parseFloat(fbMeta.div);
      }
      if (fbMeta.form !== undefined && !isNaN(parseInt(fbMeta.form, 10))) {
        parsed.form = parseInt(fbMeta.form, 10);
      }
      if (fbMeta.min !== undefined && !isNaN(parseFloat(fbMeta.min))) {
        parsed.minValue = parseFloat(fbMeta.min);
      }
      if (fbMeta.max !== undefined && !isNaN(parseFloat(fbMeta.max))) {
        parsed.maxValue = parseFloat(fbMeta.max);
      }
      if (fbMeta.was !== undefined && fbMeta.was !== null && fbMeta.was.toString().trim() !== "") {
        parsed.description = fbMeta.was.toString();
      }
      if (fbMeta.color !== undefined && fbMeta.color.toString().trim() !== "") {
        parsed.color = fbMeta.color.toString();
      }
      if (fbMeta.yAxisID !== undefined && fbMeta.yAxisID.toString().trim() !== "") {
        parsed.yAxisID = fbMeta.yAxisID.toString();
      }
      if (fbMeta.icon !== undefined && fbMeta.icon.toString().trim() !== "") {
        parsed.icon = fbMeta.icon.toString();
      }
      
      // NEW: Handle dataType field
      if ((fbMeta as any).dataType !== undefined && (fbMeta as any).dataType !== null) {
        const dataType = (fbMeta as any).dataType.toString().toLowerCase();
        if (['float', 'int', 'bool', 'string'].includes(dataType)) {
          (parsed as any).dataType = dataType as 'float' | 'int' | 'bool' | 'string';
        }
      }
      
      // Handle decimal places for float display
      if ((fbMeta as any).decimalPlaces !== undefined && (fbMeta as any).decimalPlaces !== null) {
        const decimalPlaces = parseInt((fbMeta as any).decimalPlaces, 10);
        if (!isNaN(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 12) {
          (parsed as any).decimalPlaces = decimalPlaces;
        }
      }
      
      // Handle access permissions (zugriff)
      if ((fbMeta as any).zugriff !== undefined && (fbMeta as any).zugriff !== null) {
        const zugriff = String((fbMeta as any).zugriff);
        (parsed as any).zugriff = zugriff;
      }
      
      // Handle category
      if ((fbMeta as any).kategorie !== undefined && (fbMeta as any).kategorie !== null) {
        const k = String((fbMeta as any).kategorie).trim();
        if (k !== "") {
          (parsed as any).kategorie = k;
        }
      }

      // Handle time formatting settings
      if ((fbMeta as any).isTimeData !== undefined) {
        (parsed as any).isTimeData = Boolean((fbMeta as any).isTimeData);
      }
      
      if ((fbMeta as any).timeFormat !== undefined && (fbMeta as any).timeFormat !== null) {
        const tf = (fbMeta as any).timeFormat;
        if (typeof tf === 'string' && tf.trim() !== "") {
          (parsed as any).timeFormat = tf;
        }
      }
      
      if ((fbMeta as any).timeInputUnit !== undefined && (fbMeta as any).timeInputUnit !== null) {
        const tiu = (fbMeta as any).timeInputUnit;
        if (typeof tiu === 'string' && tiu.trim() !== "") {
          (parsed as any).timeInputUnit = tiu;
        }
      }

      // Handle alarm settings from Firestore
      if ((fbMeta as any).alarm !== undefined) {
        (parsed as any).isAlarmEnabled = Boolean((fbMeta as any).alarm);
      }
      if ((fbMeta as any)['min-alarm'] !== undefined && (fbMeta as any)['min-alarm'] !== null) {
        const minA = parseFloat((fbMeta as any)['min-alarm']);
        if (!isNaN(minA)) {
          (parsed as any).alarmMinThreshold = minA;
        }
      }
      if ((fbMeta as any)['max-alarm'] !== undefined && (fbMeta as any)['max-alarm'] !== null) {
        const maxA = parseFloat((fbMeta as any)['max-alarm']);
        if (!isNaN(maxA)) {
          (parsed as any).alarmMaxThreshold = maxA;
        }
      }

      // IMPORTANT: Do NOT override local-only fields from Firestore
      // favorite/position/show_in_legend/visible_on_chart remain local
    }

    // Apply final formatting (like legacy)
    if (parsed.unit === "" && parsed.originalName.toUpperCase().includes("T")) {
      parsed.unit = "°C";
    }
    if (parsed.unit === "" && (parsed.originalName.toUpperCase().includes("L") || parsed.originalName.toUpperCase().includes("P"))) {
      parsed.unit = "%";
    }
    
    if (parsed.originalName === "N") {
      if (parsed.minValue === undefined) {
        parsed.minValue = DEFAULT_MIN_FOR_STATUS;
      }
      if (parsed.maxValue === undefined) {
        parsed.maxValue = DEFAULT_MAX_FOR_STATUS;
      }
    }
    
    if (parsed.divisor === undefined || parsed.divisor === 0 || isNaN(parsed.divisor)) {
      parsed.divisor = DEFAULT_PARAM_DIVISOR;
    }

    // Auto Y-axis for small values (like legacy)
    if (parsed.maxValue !== undefined && parsed.maxValue <= SMALL_PARAM_MAX_VALUE_THRESHOLD && 
        parsed.originalName !== 'N' &&
        (parsed.yAxisID === defaultMetadataValues.yAxisID || parsed.yAxisID === 'y' || parsed.yAxisID === 'y1') &&
        !(baseParameterMetadata[rawParamName] && 
          (baseParameterMetadata[rawParamName].yAxisID !== 'y' && baseParameterMetadata[rawParamName].yAxisID !== 'y1'))) {
      parsed.yAxisID = `y_ax_${parsed.originalName.toLowerCase().replace(/[^a-z0-9]/gi, '')}`;
      if (parsed.minValue === undefined) parsed.minValue = 0;
    }

    // Generate range string
    if (parsed.minValue !== undefined && parsed.maxValue !== undefined) {
      parsed.rangeString = `${parsed.minValue}..${parsed.maxValue}`;
    } else if (parsed.minValue !== undefined) {
      parsed.rangeString = `min ${parsed.minValue}`;
    } else if (parsed.maxValue !== undefined) {
      parsed.rangeString = `max ${parsed.maxValue}`;
    } else {
      parsed.rangeString = '';
    }

    // Assign color with correct priority: Firebase > localStorage > auto-generated
    if (!parsed.color || parsed.color === defaultMetadataValues.color) {
      // No color in Firebase - check localStorage as fallback
      const localSettings = getAllParameterSettings()[parsed.originalName];
      const localColor = localSettings?.color;
      
      if (localColor) {
        parsed.color = localColor;
      } else {
        const assigned = getNextAvailableColor();
        parsed.color = assigned;
        try { setColor(parsed.originalName, assigned); } catch {}
      }
    } else {
      try {
        const existingLocalColor = getAllParameterSettings()[parsed.originalName]?.color;
        if (existingLocalColor !== parsed.color) {
          setColor(parsed.originalName, parsed.color);
        }
      } catch {}
    }

    return parsed;
  }, [fetchMetadata, setupParameterListener, getNextAvailableColor, setColor, getAllParameterSettings]);

  const discoverParameters = useCallback(async (currentData: StoveData) => {
    if (!currentData || Object.keys(currentData).length === 0) {
      console.warn('[ParameterDiscovery] No data provided for discovery');
      return;
    }

    // Get local settings for this device
    const localSettings = getAllParameterSettings();

    // Analyze incoming parameters (exclude system keys)
    const incomingParamIds = Object.keys(currentData).filter(key =>
      !key.startsWith(SYSTEM_KEY_PREFIX) &&
      !SYSTEM_KEYS.has(key)
    );

    const existingParamIds = discoveredParameters.map(p => p.originalName);
    const newParamIds = incomingParamIds.filter(id => !existingParamIds.includes(id));

    if (newParamIds.length === 0) {
      // Apply local settings to existing parameters if needed
      const updatedParams = await Promise.all(discoveredParameters.map(async (param) => {
        const localSetting = localSettings[param.originalName];
        
        // Check if parameter needs metadata refresh (missing important fields)
        const needsRefresh = !param.unit || param.divisor === undefined || 
                           param.rangeString === '' || param.description === 'Parameter data';
        
        if (needsRefresh) {
          // Re-parse the parameter to get latest metadata
          const refreshedParam = await parseParameterAsync(param.originalName);
          
          // Preserve user-set values
          refreshedParam.show_in_legend = param.show_in_legend;
          refreshedParam.visible_on_chart = param.visible_on_chart;
          refreshedParam.favorite = param.favorite;
          refreshedParam.position = param.position;
          refreshedParam.color = param.color; // Keep user-selected color
          
          // Apply local settings if they exist
          if (localSetting) {
            if (localSetting.show_in_legend !== undefined) refreshedParam.show_in_legend = localSetting.show_in_legend;
            if (localSetting.visible_on_chart !== undefined) refreshedParam.visible_on_chart = localSetting.visible_on_chart;
            if (localSetting.favorite !== undefined) refreshedParam.favorite = localSetting.favorite;
            if (localSetting.position !== undefined) refreshedParam.position = localSetting.position;
            if (localSetting.color !== undefined) refreshedParam.color = localSetting.color;
          }
          
          return refreshedParam;
        }
        
        // Parameter doesn't need refresh, just apply local settings
        if (localSetting) {
          return {
            ...param,
            show_in_legend: localSetting.show_in_legend ?? param.show_in_legend,
            visible_on_chart: localSetting.visible_on_chart ?? param.visible_on_chart,
            favorite: localSetting.favorite ?? param.favorite,
            position: localSetting.position ?? param.position,
            color: localSetting.color ?? param.color,
          };
        }
        return param;
      }));
      
      // Check if any parameters were actually updated
      const hasChanges = updatedParams.some((param, index) => {
        const original = discoveredParameters[index];
        return param.displayName !== original.displayName ||
               param.unit !== original.unit ||
               param.divisor !== original.divisor ||
               param.minValue !== original.minValue ||
               param.maxValue !== original.maxValue ||
               param.rangeString !== original.rangeString ||
               param.show_in_legend !== original.show_in_legend ||
               param.visible_on_chart !== original.visible_on_chart ||
               param.favorite !== original.favorite ||
               param.position !== original.position ||
               param.color !== original.color;
      });
      
      if (hasChanges) {
        // Sort by position after applying local settings
        updatedParams.sort((a, b) => {
          const posA = a.position !== undefined && a.position !== Infinity ? a.position : FALLBACK_POSITION;
          const posB = b.position !== undefined && b.position !== Infinity ? b.position : FALLBACK_POSITION;
          if (posA !== posB) {
            return posA - posB;
          }
          // If positions are equal, sort alphabetically by display name
          const nameA = a.displayName || a.originalName;
          const nameB = b.displayName || b.originalName;
          return nameA.localeCompare(nameB);
        });
        
        setDiscoveredParameters(updatedParams);
      }
      
      return;
    }

    // Create new parameter configurations
    const newParameters: ParameterInfo[] = [];
    
    // Parse all new parameters in parallel to avoid sequential Firestore round-trips
    const parsedNewParams = await Promise.all(newParamIds.map((paramId) => parseParameterAsync(paramId)));

    parsedNewParams.forEach((parsedParam, idx) => {
      const paramId = newParamIds[idx];
      const localSetting = localSettings[paramId];
      if (localSetting) {
        if (localSetting.color !== undefined) parsedParam.color = localSetting.color;
        if (localSetting.position !== undefined) parsedParam.position = localSetting.position;
        if (localSetting.show_in_legend !== undefined) parsedParam.show_in_legend = localSetting.show_in_legend;
        if (localSetting.visible_on_chart !== undefined) parsedParam.visible_on_chart = localSetting.visible_on_chart;
        if (localSetting.favorite !== undefined) parsedParam.favorite = localSetting.favorite;
      } else {
        // Set default position for parameters without local settings and persist it
        parsedParam.position = discoveredParameters.length + newParameters.length;
        try { setPosition(parsedParam.originalName, parsedParam.position); } catch {}
      }
      newParameters.push(parsedParam);
    });

    // Apply local settings to existing parameters and add new ones
    const allParameters = [
      ...discoveredParameters.map(param => {
        const localSetting = localSettings[param.originalName];
        if (localSetting) {
          return {
            ...param,
            show_in_legend: localSetting.show_in_legend ?? param.show_in_legend,
            visible_on_chart: localSetting.visible_on_chart ?? param.visible_on_chart,
            favorite: localSetting.favorite ?? param.favorite,
            position: localSetting.position ?? param.position,
            color: localSetting.color ?? param.color,
          };
        }
        return param;
      }),
      ...newParameters
    ];

    // Sort by position
    allParameters.sort((a, b) => {
      const getPos = (p: ParameterInfo) => {
        const local = localSettings[p.originalName];
        const cat = ((p as any).kategorie && String((p as any).kategorie).trim() !== '')
          ? String((p as any).kategorie)
          : UNCATEGORIZED_CATEGORY;
        const catPos = local?.categoryPositions && local.categoryPositions[cat];
        const legacy = local?.position ?? p.position;
        const resolved = (catPos !== undefined ? catPos : legacy);
        return (resolved !== undefined && resolved !== Infinity) ? resolved : FALLBACK_POSITION;
      };
      const posA = getPos(a);
      const posB = getPos(b);
      if (posA !== posB) return posA - posB;
      const nameA = a.displayName || a.originalName;
      const nameB = b.displayName || b.originalName;
      return nameA.localeCompare(nameB);
    });

    setDiscoveredParameters(allParameters);
  }, [discoveredParameters, setDiscoveredParameters, getAllParameterSettings, parseParameterAsync, setPosition]);

  const clearParameterCache = useCallback((paramId: string) => {
    delete firebaseParameterMetadataCache[paramId];
    processedParametersRef.current.delete(paramId);
  }, []);

  const updateParameterCache = useCallback((paramId: string, metadata: any) => {
    firebaseParameterMetadataCache[paramId] = metadata;
    processedParametersRef.current.delete(paramId);
  }, []);

  // Reset cache when needed (like legacy)
  const resetDiscovery = useCallback(() => {
    processedParametersRef.current.clear();
    Object.keys(firebaseParameterMetadataCache).forEach(key => {
      delete firebaseParameterMetadataCache[key];
    });
    setDiscoveredParameters([]);
  }, [setDiscoveredParameters]);

  return {
    discoverParameters,
    resetDiscovery,
    testFirestoreConnection,
    clearParameterCache,
    updateParameterCache,
  };
};

export const useParameterFormatting = () => {
  const formatParameterValue = useCallback((rawValue: number | string | undefined, paramInfo: ParameterInfo | undefined | null): string => {
          // Use new data type utility with undefined protection
    return formatValue(rawValue, paramInfo);
  }, []);

  return { formatParameterValue };
};

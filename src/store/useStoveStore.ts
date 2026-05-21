import { create } from 'zustand';
import type {
  StoveData,
  DeviceConfig,
  DeviceMetadata,
  ParameterInfo,
  ParameterMetadata,
  ConnectionStatus,
  Notification,
} from '../types';

interface StoveState {
  deviceId: string | null;
  connectionStatus: ConnectionStatus;
  deviceExistence: 'unknown' | 'exists' | 'not_found';
  
  currentData: StoveData;
  deviceConfig: DeviceConfig;
  deviceMetadata: DeviceMetadata;
  
  discoveredParameters: ParameterInfo[];
  parameterMetadataCache: Record<string, ParameterMetadata>;
  
  isHistoricalMode: boolean;
  historicalTimestamps: string[];
  
  isEditMode: boolean;
  showDebugInfo: boolean;
  notifications: Notification[];
  
  // Category management
  primaryCategory: string; // "uncategorized" by default

  // Section ordering
  sectionOrder: string[];
  isSectionReorderMode: boolean;

  // Recently changed parameters to prevent immediate reversion
  recentlyChangedParams: Record<string, number>;

  // Error codes from konstant_app (single source of truth)
  errorData: { ecode?: number; ecode2?: number };
}

interface StoreActions {
  setDeviceId: (id: string | null) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setDeviceExistence: (status: 'unknown' | 'exists' | 'not_found') => void;
  
  updateCurrentData: (data: StoveData, skipParameters?: string[], isOptimisticUpdate?: boolean) => void;
  updateDeviceConfig: (config: DeviceConfig) => void;
  updateDeviceMetadata: (metadata: DeviceMetadata) => void;
  
  addDiscoveredParameter: (param: ParameterInfo) => void;
  setDiscoveredParameters: (params: ParameterInfo[]) => void;
  updateParameterMetadata: (paramId: string, metadata: ParameterMetadata) => void;
  
  setHistoricalMode: (enabled: boolean) => void;
  setHistoricalTimestamps: (timestamps: string[]) => void;
  setEditMode: (enabled: boolean) => void;
  toggleDebugInfo: () => void;
  
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  
  // Category management
  setPrimaryCategory: (category: string) => void;

  // Section ordering
  setSectionOrder: (order: string[]) => void;
  moveSectionUp: (sectionId: string) => void;
  moveSectionDown: (sectionId: string) => void;
  setSectionReorderMode: (enabled: boolean) => void;

  // Recently changed parameters management
  markParameterAsRecentlyChanged: (paramId: string) => void;
  clearRecentlyChangedParameter: (paramId: string) => void;

  // Complete state cleanup for device switching
  clearAllState: () => void;

  // Error data management
  setErrorData: (data: { ecode?: number; ecode2?: number }) => void;
}

type StoveStore = StoveState & StoreActions;

const generateId = () => Math.random().toString(36).substr(2, 9);

export const useStoveStore = create<StoveStore>((set, get) => ({
  deviceId: null,
  connectionStatus: 'offline',
  deviceExistence: 'unknown',
  currentData: {},
  deviceConfig: {},
  deviceMetadata: {},
  discoveredParameters: [],
  parameterMetadataCache: {},
  isHistoricalMode: false,
  historicalTimestamps: [],
  isEditMode: false,
  showDebugInfo: false,
  notifications: [],
  primaryCategory: 'uncategorized',
  
  // Section ordering
  sectionOrder: [],
  isSectionReorderMode: false,
  
  // Recently changed parameters to prevent immediate reversion
  recentlyChangedParams: {},

  // Error data
  errorData: {},

  setDeviceId: (id) => {
    if (!id) {
      // Reset all state when disconnecting - use complete cleanup
      const clearAllState = get().clearAllState;
      clearAllState();
    } else {
      set({ deviceId: id, deviceExistence: 'unknown' });
    }
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  setDeviceExistence: (status) => {
    set({ deviceExistence: status });
  },

  updateCurrentData: (data, skipParameters, isOptimisticUpdate = false) => {
    const { currentData, recentlyChangedParams } = get();
    const CHANGE_BLOCK_DURATION = 3000; // 3 seconds
    const now = Date.now();
    
    let filteredData = { ...data };
    
    // Auto-filter recently changed parameters from the registry
    const recentlyChangedParamIds = Object.keys(recentlyChangedParams).filter(
      paramId => now - recentlyChangedParams[paramId] < CHANGE_BLOCK_DURATION
    );
    
    // Clean up expired entries
    const expiredParams = Object.keys(recentlyChangedParams).filter(
      paramId => now - recentlyChangedParams[paramId] >= CHANGE_BLOCK_DURATION
    );
    
    if (expiredParams.length > 0) {
      const cleanedRecentlyChanged = { ...recentlyChangedParams };
      expiredParams.forEach(paramId => {
        delete cleanedRecentlyChanged[paramId];
      });
      set({ recentlyChangedParams: cleanedRecentlyChanged });
    }
    
    // Combine auto-detected and manually specified skip parameters
    const allSkipParameters = [...recentlyChangedParamIds, ...(skipParameters || [])];
    
    // Filter out recently changed parameters ONLY for non-optimistic updates
    if (!isOptimisticUpdate && allSkipParameters.length > 0) {
      allSkipParameters.forEach(paramId => {
        if (paramId in filteredData) {
          delete filteredData[paramId];
        }
      });
    }

    // For live Firebase snapshots we must replace state (not merge),
    // otherwise removed keys from /temporaer stay forever until page refresh.
    if (!isOptimisticUpdate) {
      const nextData: StoveData = { ...filteredData };

      // Preserve locally protected values for skipped parameters during cooldown.
      allSkipParameters.forEach(paramId => {
        if (paramId in currentData) {
          (nextData as any)[paramId] = (currentData as any)[paramId];
        }
      });

      set({ currentData: nextData });
      return;
    }

    // Optimistic local updates are partial by design, so merge them.
    const updatedData = { ...currentData, ...filteredData };
    set({ currentData: updatedData });
  },

  updateDeviceConfig: (config) => {
    const { deviceConfig } = get();
    const updatedConfig = { ...deviceConfig, ...config, d: true };
    set({ deviceConfig: updatedConfig });
  },

  updateDeviceMetadata: (metadata) => {
    const { deviceMetadata } = get();
    const updatedMetadata = { ...deviceMetadata, ...metadata };
    set({ deviceMetadata: updatedMetadata });
  },

  addDiscoveredParameter: (param) => {
    const { discoveredParameters } = get();
    
    const existingIndex = discoveredParameters.findIndex(
      p => p.originalName === param.originalName
    );
    
    let updatedParameters;
    if (existingIndex >= 0) {
      // Update existing parameter
      updatedParameters = discoveredParameters.map((p, i) => 
        i === existingIndex ? param : p
      );
    } else {
      // Add new parameter
      updatedParameters = [...discoveredParameters, param];
    }
    
    // FIXED: Sort exactly like legacy - position first, then alphabetical (NO favorite priority)
    updatedParameters.sort((a, b) => {
      // Position first (if set and not Infinity)
      if (a.position !== Infinity && b.position === Infinity) return -1;
      if (a.position === Infinity && b.position !== Infinity) return 1;
      if (a.position !== Infinity && b.position !== Infinity && a.position !== b.position) {
        return a.position - b.position;
      }
      
      // Then alphabetically by display name (NOT by favorite status)
      const aName = a.displayName || a.originalName;
      const bName = b.displayName || b.originalName;
      return aName.localeCompare(bName);
    });

    set({ discoveredParameters: updatedParameters });
  },

  setDiscoveredParameters: (params) => {
    set({ discoveredParameters: params });
  },

  // FIXED: Proper parameter metadata updates with NULL SAFETY
  updateParameterMetadata: (paramId, metadata) => {
    const { parameterMetadataCache, discoveredParameters } = get();
    

    
    // Update cache
    const updatedCache = {
      ...parameterMetadataCache,
      [paramId]: { ...parameterMetadataCache[paramId], ...metadata }
    };
    
    // Update discovered parameter if it exists
    const paramIndex = discoveredParameters.findIndex(p => p.originalName === paramId);
    let updatedParameters = discoveredParameters;
    
    if (paramIndex >= 0) {    
      const currentParam = discoveredParameters[paramIndex];
      
      // FIXED: Add comprehensive null safety for all metadata fields
      const updatedParam: any = {
        ...currentParam,
        // Apply metadata updates with proper field mapping and NULL SAFETY
        displayName: metadata.name !== undefined && metadata.name !== null ? 
                     metadata.name : currentParam.displayName,
        
        unit: metadata.einheit !== undefined && metadata.einheit !== null ?
              metadata.einheit :
              (paramId === 'SL' && (metadata.einheitLegacy ?? (metadata as any).eimheit) !== undefined &&
               (metadata.einheitLegacy ?? (metadata as any).eimheit) !== null ?
               (metadata.einheitLegacy ?? (metadata as any).eimheit) : currentParam.unit),
        
        // Preserve locally managed color; ignore Firestore color to avoid clobbering local settings
        color: currentParam.color,
        
        divisor: metadata.div !== undefined && metadata.div !== null && 
                 !isNaN(parseFloat(metadata.div.toString())) ? 
                 parseFloat(metadata.div.toString()) : currentParam.divisor,
        
        minValue: metadata.min !== undefined && metadata.min !== null && 
                  !isNaN(parseFloat(metadata.min.toString())) ? 
                  parseFloat(metadata.min.toString()) : currentParam.minValue,
        
        maxValue: metadata.max !== undefined && metadata.max !== null && 
                  !isNaN(parseFloat(metadata.max.toString())) ? 
                  parseFloat(metadata.max.toString()) : currentParam.maxValue,
        
        description: metadata.was !== undefined && metadata.was !== null ? 
                     metadata.was.toString().trim() : currentParam.description,
        
        form: metadata.form !== undefined && metadata.form !== null && 
              !isNaN(parseInt(metadata.form.toString(), 10)) ? 
              parseInt(metadata.form.toString(), 10) : currentParam.form,
        
        // Preserve locally managed favorite; ignore Firestore field
        favorite: currentParam.favorite,
        
        // Preserve locally managed position; ignore Firestore field
        position: currentParam.position,
        
        // Preserve locally managed legend visibility; ignore Firestore field
        show_in_legend: currentParam.show_in_legend,
        
        // Preserve locally managed chart visibility; ignore Firestore field
        visible_on_chart: currentParam.visible_on_chart,
        
        yAxisID: metadata.yAxisID !== undefined && metadata.yAxisID !== null ? 
                 metadata.yAxisID.toString() : currentParam.yAxisID,
        
        icon: metadata.icon !== undefined && metadata.icon !== null ? 
              metadata.icon.toString() : currentParam.icon,
        
        initialSuggestedMax: metadata.initialSuggestedMax !== undefined && 
                           metadata.initialSuggestedMax !== null &&
                           !isNaN(parseFloat(metadata.initialSuggestedMax.toString())) ? 
                           parseFloat(metadata.initialSuggestedMax.toString()) : currentParam.initialSuggestedMax,
        
        // Handle kategorie field for parameter categories
        kategorie: (metadata as any).kategorie !== undefined ? 
                   ((metadata as any).kategorie || undefined) : (currentParam as any).kategorie,
        
        // Handle zugriff field for access permissions  
        zugriff: (() => {
          const incomingZugriff = (metadata as any).zugriff;
          const currentZugriff = (currentParam as any).zugriff;
          
          return incomingZugriff !== undefined ? incomingZugriff : currentZugriff;
        })(),
        
        // Handle dataType field for data type specification
        dataType: (() => {
          const incomingDataType = (metadata as any).dataType;
          const currentDataType = (currentParam as any).dataType;
          const hasIncomingDataType = 'dataType' in metadata;
          
          // If dataType is explicitly present in metadata, use it
          // null and undefined both mean Auto mode
          if (hasIncomingDataType) {
            return (incomingDataType === null) ? undefined : incomingDataType;
          } else {
            return currentDataType;
          }
        })(),
        
        // Handle decimalPlaces field for float display precision
        decimalPlaces: (() => {
          const incomingDecimalPlaces = (metadata as any).decimalPlaces;
          const currentDecimalPlaces = (currentParam as any).decimalPlaces;
          const hasIncomingDecimalPlaces = 'decimalPlaces' in metadata;
          
          if (hasIncomingDecimalPlaces) {
            // If explicitly null - remove the field (for non-float types)
            if (incomingDecimalPlaces === null) {
              return undefined;
            }
            // If valid number - use it
            if (typeof incomingDecimalPlaces === 'number' && !isNaN(incomingDecimalPlaces)) {
              return incomingDecimalPlaces;
            }
            // If string that can be parsed
            if (typeof incomingDecimalPlaces === 'string') {
              const parsed = parseInt(incomingDecimalPlaces, 10);
              if (!isNaN(parsed) && parsed >= 0 && parsed <= 12) {
                return parsed;
              }
            }
          }
          
          return currentDecimalPlaces;
        })(),

        // Time-data related fields
        isTimeData: (() => {
          const hasIncoming = Object.prototype.hasOwnProperty.call(metadata as any, 'isTimeData');
          if (hasIncoming) {
            return Boolean((metadata as any).isTimeData);
          }
          return (currentParam as any).isTimeData;
        })(),
        timeFormat: (() => {
          const hasIncoming = Object.prototype.hasOwnProperty.call(metadata as any, 'timeFormat');
          if (hasIncoming) {
            const val = (metadata as any).timeFormat;
            return val === null || val === undefined ? undefined : String(val);
          }
          return (currentParam as any).timeFormat;
        })(),
        timeInputUnit: (() => {
          const hasIncoming = Object.prototype.hasOwnProperty.call(metadata as any, 'timeInputUnit');
          if (hasIncoming) {
            const val = (metadata as any).timeInputUnit;
            return val === null || val === undefined ? undefined : String(val);
          }
          return (currentParam as any).timeInputUnit;
        })(),

        // Alarm fields mapping
        isAlarmEnabled: (() => {
          const hasIncoming = Object.prototype.hasOwnProperty.call(metadata as any, 'alarm');
          if (hasIncoming) {
            return Boolean((metadata as any).alarm);
          }
          return (currentParam as any).isAlarmEnabled;
        })(),
        alarmMinThreshold: (() => {
          const hasIncoming = Object.prototype.hasOwnProperty.call(metadata as any, 'min-alarm');
          if (hasIncoming) {
            const v = (metadata as any)['min-alarm'];
            if (v === null || v === undefined) return undefined;
            const num = typeof v === 'string' ? parseFloat(v) : Number(v);
            return isNaN(num) ? (currentParam as any).alarmMinThreshold : num;
          }
          return (currentParam as any).alarmMinThreshold;
        })(),
        alarmMaxThreshold: (() => {
          const hasIncoming = Object.prototype.hasOwnProperty.call(metadata as any, 'max-alarm');
          if (hasIncoming) {
            const v = (metadata as any)['max-alarm'];
            if (v === null || v === undefined) return undefined;
            const num = typeof v === 'string' ? parseFloat(v) : Number(v);
            return isNaN(num) ? (currentParam as any).alarmMaxThreshold : num;
          }
          return (currentParam as any).alarmMaxThreshold;
        })(),
      };
      
      // Regenerate range string if min/max changed
      if ((metadata.min !== undefined && metadata.min !== null) || 
          (metadata.max !== undefined && metadata.max !== null)) {
        if (updatedParam.minValue !== undefined && updatedParam.maxValue !== undefined) {
          updatedParam.rangeString = `${updatedParam.minValue}..${updatedParam.maxValue}`;
        } else if (updatedParam.minValue !== undefined) {
          updatedParam.rangeString = `min ${updatedParam.minValue}`;
        } else if (updatedParam.maxValue !== undefined) {
          updatedParam.rangeString = `max ${updatedParam.maxValue}`;
        } else {
          updatedParam.rangeString = '';
        }
      }
      

      
      updatedParameters = discoveredParameters.map((p, i) => 
        i === paramIndex ? updatedParam : p
      );
      
      if (metadata.position !== undefined && metadata.position !== null && 
          currentParam.position !== updatedParam.position) {
        updatedParameters.sort((a, b) => {
          if (a.position !== Infinity && b.position === Infinity) return -1;
          if (a.position === Infinity && b.position !== Infinity) return 1;
          if (a.position !== Infinity && b.position !== Infinity && a.position !== b.position) {
            return a.position - b.position;
          }
          const aName = a.displayName || a.originalName;
          const bName = b.displayName || b.originalName;
          return aName.localeCompare(bName);
        });
      }
    } else {
      console.warn(`[Store] Parameter ${paramId} not found in discovered parameters`);
    }

    set({
      parameterMetadataCache: updatedCache,
      discoveredParameters: updatedParameters,
    });
  },

  setHistoricalMode: (enabled) => {
    set({ isHistoricalMode: enabled });
  },
  
  setHistoricalTimestamps: (timestamps) => {
    set({ historicalTimestamps: timestamps });
  },
  
  setEditMode: (enabled) => {
    set({ isEditMode: enabled });
  },

  toggleDebugInfo: () => {
    const { showDebugInfo } = get();
    set({ showDebugInfo: !showDebugInfo });
  },

  addNotification: (notification) => {
    const newNotification: Notification = {
      id: generateId(),
      timestamp: Date.now(),
      autoClose: true,
      ...notification
    };
    
    const { notifications } = get();
    set({ notifications: [...notifications, newNotification] });

    // Dispatch event for history component
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('notification-added', { detail: newNotification }));
    }
  },

  removeNotification: (id) => {
    const { notifications } = get();
    set({ notifications: notifications.filter(n => n.id !== id) });
  },

  clearNotifications: () => set({ notifications: [] }),
  
  setPrimaryCategory: (category) => {
    set({ primaryCategory: category });
  },

  setSectionOrder: (order) => {
    set({ sectionOrder: order });
  },
  moveSectionUp: (sectionId) => {
    const { sectionOrder } = get();
    const index = sectionOrder.indexOf(sectionId);
    if (index > 0) {
      const newOrder = [...sectionOrder];
      [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
      set({ sectionOrder: newOrder });
    }
  },
  moveSectionDown: (sectionId) => {
    const { sectionOrder } = get();
    const index = sectionOrder.indexOf(sectionId);
    if (index < sectionOrder.length - 1) {
      const newOrder = [...sectionOrder];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      set({ sectionOrder: newOrder });
    }
  },
  setSectionReorderMode: (enabled) => {
    set({ isSectionReorderMode: enabled });
  },

  // Recently changed parameters management
  markParameterAsRecentlyChanged: (paramId) => {
    const { recentlyChangedParams } = get();
    set({ recentlyChangedParams: { ...recentlyChangedParams, [paramId]: Date.now() } });
  },
  clearRecentlyChangedParameter: (paramId) => {
    const { recentlyChangedParams } = get();
    const newRecentlyChangedParams = { ...recentlyChangedParams };
    delete newRecentlyChangedParams[paramId];
    set({ recentlyChangedParams: newRecentlyChangedParams });
  },

  clearAllState: () => {
    set({
      deviceId: null,
      connectionStatus: 'offline',
      deviceExistence: 'unknown',
      currentData: {},
      deviceConfig: {},
      deviceMetadata: {},
      discoveredParameters: [],
      parameterMetadataCache: {},
      isHistoricalMode: false,
      historicalTimestamps: [],
      isEditMode: false,
      showDebugInfo: false,
      notifications: [],
      primaryCategory: 'uncategorized',
      sectionOrder: [],
      isSectionReorderMode: false,
      recentlyChangedParams: {},
      errorData: {},
    });
  },

  setErrorData: (data) => {
    set({ errorData: data });
  },
}));

// Export store to window for debug purposes
if (typeof window !== 'undefined') {
  (window as any).stoveStore = useStoveStore;
}

export const useNotificationHelpers = () => {
  const addNotification = useStoveStore(state => state.addNotification);
  
  return {
    showSuccess: (message: string, options?: { isAlarm?: boolean; deviceId?: string; parameterName?: string; duration?: number }) => {
      addNotification({ message, type: 'success', ...options });
    },
    showError: (message: string, options?: { isAlarm?: boolean; deviceId?: string; parameterName?: string; duration?: number }) => {
      addNotification({ message, type: 'error', ...options });
    },
    showWarning: (message: string, options?: { isAlarm?: boolean; deviceId?: string; parameterName?: string; duration?: number }) => {
      addNotification({ message, type: 'warning', ...options });
    },
    showInfo: (message: string, options?: { isAlarm?: boolean; deviceId?: string; parameterName?: string; duration?: number }) => {
      addNotification({ message, type: 'info', ...options });
    },
  };
};

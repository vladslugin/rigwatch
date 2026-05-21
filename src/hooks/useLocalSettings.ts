import { useCallback } from 'react';
import { useRigStore } from '../store/useRigStore';
import { defaultBaseParameterSettings, defaultParameterColors, defaultUserPreferences } from '../data/defaultSettings';

// Local settings structure - ONLY VISUAL SETTINGS
interface ParameterLocalSettings {
  show_in_legend?: boolean;
  visible_on_chart?: boolean;
  favorite?: number;
  position?: number;
  color?: string;
  hidden?: boolean;
  categoryPositions?: Record<string, number>;
}

interface DeviceSettings {
  parameters: Record<string, ParameterLocalSettings>;
  // Category management
  primaryCategory?: string;
}

interface LocalSettingsStorage {
  [deviceId: string]: DeviceSettings;
}

const STORAGE_KEY = 'rigwatch-local-settings';
const USER_PREFERENCES_KEY = 'rigwatch-user-preferences';

// User preferences (global settings)
interface UserPreferences {
  unfavoriteOpacity?: number;
  theme?: 'light' | 'dark' | 'auto';
  simplificationMode?: boolean;
  commandDelay?: number; // Delay in milliseconds between set commands (default: 500ms)
  newDesign?: boolean; // Beta: render Standard mode inside the new sidebar shell
}

export const useLocalSettings = () => {
  const deviceId = useRigStore(state => state.deviceId);
  const discoveredParameters = useRigStore(state => state.discoveredParameters);
  const setDiscoveredParameters = useRigStore(state => state.setDiscoveredParameters);

  // Get all settings from localStorage
  const getStorageData = useCallback((): LocalSettingsStorage => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('[LocalSettings] Failed to parse localStorage data:', error);
      return {};
    }
  }, []);

  // Save all settings to localStorage
  const saveStorageData = useCallback((data: LocalSettingsStorage) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('[LocalSettings] Failed to save to localStorage:', error);
    }
  }, []);

  // Get user preferences
  const getUserPreferences = useCallback((): UserPreferences => {
    try {
      const data = localStorage.getItem(USER_PREFERENCES_KEY);
      const base = data ? JSON.parse(data) : { unfavoriteOpacity: 0.3, commandDelay: 500 }; // default 500ms delay
      // Overlay per-tab simplificationMode from sessionStorage (do NOT share across tabs)
      try {
        const sessionSimple = sessionStorage.getItem('rigwatch-session-simplification-mode');
        if (sessionSimple !== null) {
          const s = sessionSimple.trim().toLowerCase();
          const v = (s === 'true' || s === '1' || s === 'yes' || s === 'ja');
          (base as UserPreferences).simplificationMode = v;
        }
      } catch {}
      return base;
    } catch (error) {
      console.error('[LocalSettings] Failed to parse user preferences:', error);
      return { unfavoriteOpacity: 0.3, commandDelay: 500 };
    }
  }, []);

  // Save user preferences
  const saveUserPreferences = useCallback((preferences: UserPreferences) => {
    try {
      // Persist all preferences EXCEPT simplificationMode (which should be per-tab)
      const { simplificationMode, ...rest } = preferences || {};
      localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(rest));
      // Persist per-tab simplificationMode to sessionStorage only
      if (typeof simplificationMode !== 'undefined') {
        try {
          sessionStorage.setItem('rigwatch-session-simplification-mode', String(Boolean(simplificationMode)));
        } catch {}
      }
      // Notify listeners for preference changes
      try {
        const event = new CustomEvent('userPreferencesChanged', {
          detail: preferences
        });
        window.dispatchEvent(event);
      } catch (e) {}
    } catch (error) {
      console.error('[LocalSettings] Failed to save user preferences:', error);
    }
  }, []);

  // Get settings for current device
  const getDeviceSettings = useCallback((): DeviceSettings => {
    if (!deviceId) return { parameters: {} };
    
    const allSettings = getStorageData();
    return allSettings[deviceId] || { parameters: {} };
  }, [deviceId, getStorageData]);

  // Get settings for specific parameter
  const getParameterSettings = useCallback((paramId: string): ParameterLocalSettings => {
    const deviceSettings = getDeviceSettings();
    return deviceSettings.parameters[paramId] || {};
  }, [getDeviceSettings]);

  // Save settings for specific parameter
  const saveParameterSettings = useCallback((paramId: string, settings: ParameterLocalSettings) => {
    if (!deviceId) {
      console.warn('[LocalSettings] No device ID available');
      return false;
    }

    try {
      const allSettings = getStorageData();
      
      // Initialize device settings if not exists
      if (!allSettings[deviceId]) {
        allSettings[deviceId] = { parameters: {} };
      }
      
      // Initialize parameter settings if not exists
      if (!allSettings[deviceId].parameters[paramId]) {
        allSettings[deviceId].parameters[paramId] = {};
      }
      
      // Update parameter settings
      allSettings[deviceId].parameters[paramId] = {
        ...allSettings[deviceId].parameters[paramId],
        ...settings
      };
      
      saveStorageData(allSettings);
      
      console.log(`[LocalSettings] Saved settings for ${paramId}:`, settings);

      // Notify listeners so UI can update immediately
      try {
        const event = new CustomEvent('localSettingsChanged', {
          detail: { deviceId, paramId, settings }
        });
        window.dispatchEvent(event);
      } catch (e) {
        // Ignore event dispatch errors in non-browser environments
      }
      return true;
    } catch (error) {
      console.error(`[LocalSettings] Failed to save settings for ${paramId}:`, error);
      return false;
    }
  }, [deviceId, getStorageData, saveStorageData]);

  // Toggle show in legend
  const toggleShowInLegend = useCallback((paramId: string, show: boolean) => {
    return saveParameterSettings(paramId, { show_in_legend: show });
  }, [saveParameterSettings]);

  // Toggle show in legend with initial visibility
  const toggleShowInLegendWithVisibility = useCallback((paramId: string, show: boolean, initialVisible = false) => {
    return saveParameterSettings(paramId, { 
      show_in_legend: show,
      visible_on_chart: show ? initialVisible : false
    });
  }, [saveParameterSettings]);

  // Toggle visible on chart
  const toggleVisibleOnChart = useCallback((paramId: string, visible: boolean) => {
    return saveParameterSettings(paramId, { visible_on_chart: visible });
  }, [saveParameterSettings]);

  // Toggle favorite
  const toggleFavorite = useCallback((paramId: string, favorite: number) => {
    return saveParameterSettings(paramId, { favorite });
  }, [saveParameterSettings]);

  // Set position
  const setPosition = useCallback((paramId: string, position: number) => {
    return saveParameterSettings(paramId, { position });
  }, [saveParameterSettings]);

  // Set position in category (scoped ordering)
  const setPositionInCategory = useCallback((paramId: string, categoryName: string | null | undefined, position: number) => {
    const categoryKey = (categoryName && categoryName.trim() !== '') ? categoryName : 'uncategorized';
    const current = getParameterSettings(paramId);
    const updatedCategoryPositions = {
      ...(current.categoryPositions || {}),
      [categoryKey]: position,
    };
    // Also keep legacy position field in sync for backward compatibility when needed
    return saveParameterSettings(paramId, { categoryPositions: updatedCategoryPositions, position });
  }, [getParameterSettings, saveParameterSettings]);

  // Set color
  const setColor = useCallback((paramId: string, color: string) => {
    return saveParameterSettings(paramId, { color });
  }, [saveParameterSettings]);

  // Set hidden flag (general visibility of parameter card)
  const setHidden = useCallback((paramId: string, hidden: boolean) => {
    return saveParameterSettings(paramId, { hidden });
  }, [saveParameterSettings]);

  const toggleHidden = useCallback((paramId: string) => {
    const current = getParameterSettings(paramId);
    return saveParameterSettings(paramId, { hidden: !current.hidden });
  }, [getParameterSettings, saveParameterSettings]);

  // Get all parameter settings for current device
  const getAllParameterSettings = useCallback((): Record<string, ParameterLocalSettings> => {
    const deviceSettings = getDeviceSettings();
    return deviceSettings.parameters;
  }, [getDeviceSettings]);

  // Clear all settings for current device
  const clearDeviceSettings = useCallback(() => {
    if (!deviceId) return false;

    try {
      const allSettings = getStorageData();
      delete allSettings[deviceId];
      saveStorageData(allSettings);
      
      console.log(`[LocalSettings] Cleared settings for device ${deviceId}`);
      return true;
    } catch (error) {
      console.error(`[LocalSettings] Failed to clear settings for device ${deviceId}:`, error);
      return false;
    }
  }, [deviceId, getStorageData, saveStorageData]);

  // RESET FUNCTIONS (only affect localStorage, not Firebase!)
  
  // Reset all visual settings to defaults
  const resetAllSettings = useCallback(() => {
    if (!deviceId) return false;

    try {
      console.log('[LocalSettings] Resetting ALL settings to defaults');
      
      // Update store with default settings
      const updatedParams = discoveredParameters.map(param => {
        const defaults = defaultBaseParameterSettings[param.originalName] || {
          ...defaultUserPreferences,
          color: defaultParameterColors[0]
        };
        
        return {
          ...param,
          show_in_legend: defaults.show_in_legend,
          visible_on_chart: defaults.visible_on_chart,
          favorite: defaults.favorite,
          position: defaults.position,
          color: defaults.color
        };
      });
      
      setDiscoveredParameters(updatedParams);
      
      // Clear localStorage
      clearDeviceSettings();
      
      console.log('[LocalSettings] All settings reset successfully');
      return true;
    } catch (error) {
      console.error('[LocalSettings] Failed to reset all settings:', error);
      return false;
    }
  }, [deviceId, discoveredParameters, setDiscoveredParameters, clearDeviceSettings]);

  // Reset only colors to defaults
  const resetColors = useCallback(() => {
    if (!deviceId) return false;

    try {
      console.log('[LocalSettings] Resetting colors to defaults');
      
      const updatedParams = discoveredParameters.map((param, index) => {
        const defaultColor = defaultBaseParameterSettings[param.originalName]?.color || 
                            defaultParameterColors[index % defaultParameterColors.length];
        
        // Save to localStorage
        saveParameterSettings(param.originalName, { color: defaultColor });
        
        return {
          ...param,
          color: defaultColor
        };
      });
      
      setDiscoveredParameters(updatedParams);
      
      console.log('[LocalSettings] Colors reset successfully');
      return true;
    } catch (error) {
      console.error('[LocalSettings] Failed to reset colors:', error);
      return false;
    }
  }, [deviceId, discoveredParameters, setDiscoveredParameters, saveParameterSettings]);

  // Reset only positions to defaults
  const resetPositions = useCallback(() => {
    if (!deviceId) return false;

    try {
      console.log('[LocalSettings] Resetting positions to defaults');
      
      const updatedParams = discoveredParameters.map(param => {
        const defaultPosition = defaultBaseParameterSettings[param.originalName]?.position ?? Infinity;
        
        // Save to localStorage
        saveParameterSettings(param.originalName, { position: defaultPosition });
        
        return {
          ...param,
          position: defaultPosition
        };
      });
      
      // Sort by position
      updatedParams.sort((a, b) => {
        const posA = a.position !== undefined && a.position !== Infinity ? a.position : 9999;
        const posB = b.position !== undefined && b.position !== Infinity ? b.position : 9999;
        return posA - posB;
      });
      
      setDiscoveredParameters(updatedParams);
      
      console.log('[LocalSettings] Positions reset successfully');
      return true;
    } catch (error) {
      console.error('[LocalSettings] Failed to reset positions:', error);
      return false;
    }
  }, [deviceId, discoveredParameters, setDiscoveredParameters, saveParameterSettings]);

  // Reset only favorites to defaults
  const resetFavorites = useCallback(() => {
    if (!deviceId) return false;

    try {
      console.log('[LocalSettings] Resetting favorites to defaults');
      
      const updatedParams = discoveredParameters.map(param => {
        const defaultFavorite = defaultBaseParameterSettings[param.originalName]?.favorite ?? 0;
        
        // Save to localStorage
        saveParameterSettings(param.originalName, { favorite: defaultFavorite });
        
        return {
          ...param,
          favorite: defaultFavorite
        };
      });
      
      setDiscoveredParameters(updatedParams);
      
      console.log('[LocalSettings] Favorites reset successfully');
      return true;
    } catch (error) {
      console.error('[LocalSettings] Failed to reset favorites:', error);
      return false;
    }
  }, [deviceId, discoveredParameters, setDiscoveredParameters, saveParameterSettings]);

  // Reset legend and visibility settings to defaults
  const resetParameterSettings = useCallback(() => {
    if (!deviceId) return false;

    try {
      console.log('[LocalSettings] Resetting parameter settings (legend/visibility) to defaults');
      
      const updatedParams = discoveredParameters.map(param => {
        const defaults = defaultBaseParameterSettings[param.originalName];
        const defaultShowInLegend = defaults?.show_in_legend ?? defaultUserPreferences.show_in_legend;
        const defaultVisibleOnChart = defaults?.visible_on_chart ?? defaultUserPreferences.visible_on_chart;
        
        // Save to localStorage
        saveParameterSettings(param.originalName, { 
          show_in_legend: defaultShowInLegend,
          visible_on_chart: defaultVisibleOnChart 
        });
        
        return {
          ...param,
          show_in_legend: defaultShowInLegend,
          visible_on_chart: defaultVisibleOnChart
        };
      });
      
      setDiscoveredParameters(updatedParams);
      
      console.log('[LocalSettings] Parameter settings reset successfully');
      return true;
    } catch (error) {
      console.error('[LocalSettings] Failed to reset parameter settings:', error);
      return false;
    }
  }, [deviceId, discoveredParameters, setDiscoveredParameters, saveParameterSettings]);

  // Export settings (for backup)
  const exportSettings = useCallback(() => {
    return getStorageData();
  }, [getStorageData]);

  // Import settings (for restore)
  const importSettings = useCallback((settings: LocalSettingsStorage) => {
    try {
      saveStorageData(settings);
      console.log('[LocalSettings] Settings imported successfully');
      return true;
    } catch (error) {
      console.error('[LocalSettings] Failed to import settings:', error);
      return false;
    }
  }, [saveStorageData]);

  // Get primary category for current device
  const getPrimaryCategory = useCallback((): string => {
    const deviceSettings = getDeviceSettings();
    return deviceSettings.primaryCategory || 'uncategorized';
  }, [getDeviceSettings]);

  // Save primary category for current device
  const savePrimaryCategory = useCallback((category: string) => {
    if (!deviceId) return;
    try {
      localStorage.setItem(`rigwatch-primary-category-${deviceId}`, category);
      console.log(`[LocalSettings] Saved primary category: ${category} for device ${deviceId}`);
    } catch (error) {
      console.error('[LocalSettings] Failed to save primary category:', error);
    }
  }, [deviceId]);

  // Section ordering
  const getSectionOrder = useCallback((): string[] => {
    if (!deviceId) return [];
    try {
      const saved = localStorage.getItem(`rigwatch-section-order-${deviceId}`);
      if (saved) {
        const order = JSON.parse(saved);
        console.log(`[LocalSettings] Loaded section order for ${deviceId}:`, order);
        return order;
      }
    } catch (error) {
      console.error('[LocalSettings] Failed to load section order:', error);
    }
    // Default order if nothing saved
    return ['rig-management', 'secondary-categories', 'main-and-airflow', 'charts'];
  }, [deviceId]);

  const saveSectionOrder = useCallback((order: string[]) => {
    if (!deviceId) return;
    try {
      localStorage.setItem(`rigwatch-section-order-${deviceId}`, JSON.stringify(order));
      console.log(`[LocalSettings] Saved section order for device ${deviceId}:`, order);
    } catch (error) {
      console.error('[LocalSettings] Failed to save section order:', error);
    }
  }, [deviceId]);

  return {
    getParameterSettings,
    saveParameterSettings,
    toggleShowInLegend,
    toggleShowInLegendWithVisibility,
    toggleVisibleOnChart,
    toggleFavorite,
    setPosition,
    setPositionInCategory,
    setColor,
    getAllParameterSettings,
    clearDeviceSettings,
    
    // Reset functions
    resetAllSettings,
    resetColors,
    resetPositions,
    resetFavorites,
    resetParameterSettings,
    
    exportSettings,
    importSettings,
    
    // Category management
    getPrimaryCategory,
    savePrimaryCategory,

    // Section ordering
    getSectionOrder,
    saveSectionOrder,

    // User preferences
    getUserPreferences,
    saveUserPreferences,

    // Visibility
    setHidden,
    toggleHidden,
  };
}; 
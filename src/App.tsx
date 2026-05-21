import * as React from 'react';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import AuthWrapper from './components/AuthWrapper';
import AdminPanel from './components/AdminPanel';
import MobileAdminPanel from './components/MobileAdminPanel';
import DevModeIndicator from './components/DevModeIndicator';
import ConnectionPanel from './components/ConnectionPanel';
import Web3ConnectionPanel from './components/web3/Web3ConnectionPanel';
import ParameterGrid from './components/ParameterGrid';
import MultiChartContainer from './components/MultiChartContainer';
import AirFlowDiagram from './components/AirFlowDiagram';
import ErrorBlock from './components/ErrorBlock';
import AlarmIndicator from './components/AlarmIndicator';
import RigManagementPanel from './components/RigManagementPanel';
import RigVitalsHero from './components/web3/RigVitalsHero';
import ProfitabilityCard from './components/web3/ProfitabilityCard';
import MiningAirflowVisualizer from './components/web3/MiningAirflowVisualizer';
import MiningHealthPanel from './components/web3/MiningHealthPanel';
import ParameterSettingsModal from './components/ParameterSettingsModal';
import ParameterListModal from './components/ParameterListModal';
import DevDebug from './components/DevDebug';
import RigInfoModal from './components/RigInfoModal';
import DisplayConfigurationModal, { type DisplayConfiguration } from './components/DisplayConfigurationModal';
import AppUpdateNotifier from './components/AppUpdateNotifier';
import CategoryBlock from './components/CategoryBlock';
import SectionWrapper from './components/SectionWrapper';
import SimpleModeLayout from './components/SimpleModeLayout';
import DealerModeLayout from './components/DealerModeLayout';
import ShellLayout from './components/ShellLayout';

import { useRigStore } from './store/useRigStore';
import { useFirebaseConnection, useParameterUpdates } from './hooks/useFirebase';
import { useParameterMetadata } from './hooks/useFirebase';
import { useParameterDiscovery } from './hooks/useParameterDiscovery';
import { useLocalSettings } from './hooks/useLocalSettings';
import { useCategoryManager } from './hooks/useCategoryManager';
import { useErrors } from './hooks/useErrors';
import { useIsMobile } from './hooks/useIsMobile';
import { useAuth } from './hooks/useAuth';
import type { ParameterInfo } from './types';
import { ChartRefContext } from './context/ChartRefContext';
import type { ChartDivElement } from './context/ChartRefContext';
import { TilingProvider } from './context/TilingContext';
import { getParameterDataType } from './utils/parameterTypes';
import { isTimeParameter } from './utils/timeFormatting';
import { useTranslation } from 'react-i18next';
import { useTheme } from './hooks/useTheme';
import GlobalParameterSearch from './components/GlobalParameterSearch';
import { useGlobalSearch } from './hooks/useGlobalSearch';
import { useParameterNavigation } from './hooks/useParameterNavigation';
import { useAlarmNavigation } from './hooks/useAlarmNavigation';
import { useAlarmNotifications } from './hooks/useAlarmNotifications';
import { useAppUpdates } from './hooks/useAppUpdates.tsx';
import { commandQueue } from './utils/commandQueue';
import { firestoreDB } from './lib/firebase';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc } from 'firebase/firestore';

const App: React.FC = () => {
  const displayConfigStorageKey = 'rigwatch-display-configuration-selected';
  const deviceId = useRigStore(state => state.deviceId);
  const connectionStatus = useRigStore(state => state.connectionStatus);
  const deviceExistence = useRigStore(state => state.deviceExistence);
  const setConnectionStatus = useRigStore(state => state.setConnectionStatus);
  const currentData = useRigStore(state => state.currentData);
  const deviceMetadata = useRigStore(state => state.deviceMetadata);
  const deviceConfig = useRigStore(state => state.deviceConfig);
  const discoveredParameters = useRigStore(state => state.discoveredParameters);
  const isEditMode = useRigStore(state => state.isEditMode);
  const isHistoricalMode = useRigStore(state => state.isHistoricalMode);
  const setEditMode = useRigStore(state => state.setEditMode);
  const setDiscoveredParameters = useRigStore(state => state.setDiscoveredParameters);
  const showDebugInfo = useRigStore(state => state.showDebugInfo);
  const toggleDebugInfo = useRigStore(state => state.toggleDebugInfo);
  const primaryCategory = useRigStore(state => state.primaryCategory);
  const setPrimaryCategory = useRigStore(state => state.setPrimaryCategory);
  const markParameterAsRecentlyChanged = useRigStore(state => state.markParameterAsRecentlyChanged);
  
  // Section ordering
  const sectionOrder = useRigStore(state => state.sectionOrder);
  const moveSectionUp = useRigStore(state => state.moveSectionUp);
  const moveSectionDown = useRigStore(state => state.moveSectionDown);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isDraggedOverMain, setIsDraggedOverMain] = useState(false);
  const [categoryRefreshKey, setCategoryRefreshKey] = useState(0);
  const [selectedDisplayConfigId, setSelectedDisplayConfigId] = useState('');
  const [displayConfigurations, setDisplayConfigurations] = useState<DisplayConfiguration[]>([]);
  const [isDisplayConfigModalOpen, setIsDisplayConfigModalOpen] = useState(false);
  const [displayConfigsLoaded, setDisplayConfigsLoaded] = useState(false);
  const lastAppliedDisplayConfigRef = useRef<string>('');
  
  // Simplification mode
  const [simplificationMode, setSimplificationMode] = useState(false);
  // RigWatch ships the web3 shell layout as the default — the legacy
  // ConnectionPanel + dashboard layout is kept as an opt-out for now.
  const [useNewDesign, setUseNewDesign] = useState(true);
  
  // Auth
  const { user, parameterViewScope, isLoading: isAuthLoading } = useAuth();
  const { t, i18n } = useTranslation();
  const { isDark } = useTheme();
  const [themeOverlayVisible, setThemeOverlayVisible] = useState(false);

  // Show a brief overlay when theme (or dark mode) changes to mask flicker
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setThemeOverlayVisible(true);
    const timer = setTimeout(() => setThemeOverlayVisible(false), 1200);
    return () => clearTimeout(timer);
  }, [isDark]);
  const currentTheme = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  const isNeo = currentTheme === 'neo-brutalism';

  useEffect(() => {
    const loadSimplificationMode = () => {
      try {
        const prefsStr = localStorage.getItem('rigwatch-user-preferences');
        const prefs = prefsStr ? JSON.parse(prefsStr) : {};
        setSimplificationMode(prefs.simplificationMode || false);
        // `newDesign` defaults to TRUE in RigWatch — the legacy layout
        // is opt-out via the Settings panel.
        setUseNewDesign(prefs.newDesign === false ? false : true);
      } catch (error) {
        console.error('[App] Failed to load simplificationMode:', error);
      }
    };

    loadSimplificationMode();

    const handlePreferencesChange = (event: CustomEvent) => {
      // `simplificationMode` is per-tab (sessionStorage) and broadcast on every save,
      // so we keep updating it. `newDesign` only appears in the event when the
      // toggle itself changes — guard against clobbering the other branch.
      if (event.detail && Object.prototype.hasOwnProperty.call(event.detail, 'simplificationMode')) {
        setSimplificationMode(event.detail.simplificationMode || false);
      }
      if (event.detail && Object.prototype.hasOwnProperty.call(event.detail, 'newDesign')) {
        setUseNewDesign(event.detail.newDesign || false);
      }
    };

    window.addEventListener('userPreferencesChanged', handlePreferencesChange as EventListener);
    return () => {
      window.removeEventListener('userPreferencesChanged', handlePreferencesChange as EventListener);
    };
  }, []);

  // Route-aware dealer mode: plain path-based split without React Router.
  const isDealerRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/haendler');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isAuthLoading) return;

    const dealerEnabled = user?.isDealer === true;
    const { search, hash } = window.location;
    const currentPath = window.location.pathname;

    if (dealerEnabled && !currentPath.startsWith('/haendler')) {
      window.history.replaceState({}, '', `/haendler${search}${hash}`);
    }
  }, [isAuthLoading, user?.isDealer]);

  useEffect(() => {
    if (!isDealerRoute) return;
    if ((i18n.resolvedLanguage || i18n.language) !== 'de') {
      i18n.changeLanguage('de').catch(() => {});
    }
  }, [isDealerRoute, i18n]);

  // Apply saved font family on app load
  useEffect(() => {
    const savedFontFamily = localStorage.getItem('rigwatch-font-family');
    if (savedFontFamily && savedFontFamily !== 'system-ui') {
      document.documentElement.style.setProperty('--custom-font-family', savedFontFamily);
      document.body.style.fontFamily = savedFontFamily;
    }
  }, []);

  useEffect(() => {
    try {
      const prefsStr = localStorage.getItem('rigwatch-user-preferences');
      const prefs = prefsStr ? JSON.parse(prefsStr) : {};
      const delay = prefs.commandDelay ?? 500;
      commandQueue.setDefaultDelay(delay);
    } catch (error) {
      console.error('[App] Failed to initialize command queue delay:', error);
    }
  }, []);

  // Parameter settings modal state
  const [editingParameter, setEditingParameter] = useState<ParameterInfo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Parameter list modal state
  const [isParameterListOpen, setIsParameterListOpen] = useState(false);

  // Rig info modal state
  const [isRigInfoModalOpen, setIsRigInfoModalOpen] = useState(false);



  // Admin panel state
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);

  const { connect } = useFirebaseConnection();
  const { updateParameter, triggerFirmwareUpdate, checkForUpdates } = useParameterUpdates();
  const { saveMetadata, setupParameterListener } = useParameterMetadata();
  const { discoverParameters, clearParameterCache, updateParameterCache } = useParameterDiscovery();

  
  const isMobile = useIsMobile();

  // Local (in-app) alarm notifications
  useAlarmNotifications();

  // App update notifications
  useAppUpdates();

  // Add local settings hook
  const { 
    toggleFavorite, 
    toggleShowInLegendWithVisibility,
    toggleVisibleOnChart,
    setPosition,
    setColor,
    setHidden,
    getParameterSettings,
    getPrimaryCategory,
    
    getSectionOrder,
    saveSectionOrder
  } = useLocalSettings();

  // Add category manager hook (without temporary categories for ParameterSettingsModal)
  const { availableCategories, updateParameterCategory, renameCategory } = useCategoryManager();
  
  // Add errors hook for conditional ErrorBlock rendering
  const { hasErrors } = useErrors();
  const [localSettingsVersion, setLocalSettingsVersion] = useState(0);

  // Display configurations (global)
  useEffect(() => {
    if (!firestoreDB) return;
    const configsQuery = query(collection(firestoreDB, 'display_configuration'));
    const unsubscribe = onSnapshot(configsQuery, (snapshot) => {
      setDisplayConfigsLoaded(true);
      const configs = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as { name?: string; hidden?: string[] };
        return {
          id: docSnap.id,
          name: data?.name || 'Unbenannt',
          hidden: Array.isArray(data?.hidden) ? data.hidden : [],
        };
      });
      setDisplayConfigurations(configs);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handler = () => setLocalSettingsVersion((v) => v + 1);
    window.addEventListener('localSettingsChanged', handler);
    return () => window.removeEventListener('localSettingsChanged', handler);
  }, []);

  // Restore selected display configuration from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(displayConfigStorageKey);
      if (saved) {
        setSelectedDisplayConfigId(saved);
      }
    } catch (error) {
      console.error('[DisplayConfig] Failed to load selected configuration:', error);
    }
  }, []);

  useEffect(() => {
    if (!selectedDisplayConfigId) return;
    const config = displayConfigurations.find((cfg) => cfg.id === selectedDisplayConfigId);
    if (!config) return;
    const hiddenSig = [...new Set(config.hidden || [])].sort().join('|');
    const paramIdsSig = [...new Set(discoveredParameters.map(p => p.originalName))].sort().join('|');
    const signature = `${selectedDisplayConfigId}::${hiddenSig}::${paramIdsSig}`;
    if (lastAppliedDisplayConfigRef.current === signature) return;
    lastAppliedDisplayConfigRef.current = signature;
    const hiddenSet = new Set(config.hidden || []);
    discoveredParameters.forEach((param) => {
      setHidden(param.originalName, hiddenSet.has(param.originalName));
    });
  }, [selectedDisplayConfigId, displayConfigurations, discoveredParameters, setHidden]);

  useEffect(() => {
    if (
      selectedDisplayConfigId &&
      displayConfigsLoaded &&
      !displayConfigurations.some((cfg) => cfg.id === selectedDisplayConfigId)
    ) {
      setSelectedDisplayConfigId('');
    }
  }, [selectedDisplayConfigId, displayConfigurations, displayConfigsLoaded]);

  useEffect(() => {
    try {
      if (selectedDisplayConfigId) {
        localStorage.setItem(displayConfigStorageKey, selectedDisplayConfigId);
      } else {
        localStorage.removeItem(displayConfigStorageKey);
      }
    } catch (error) {
      console.error('[DisplayConfig] Failed to persist selected configuration:', error);
    }
  }, [selectedDisplayConfigId]);

  useEffect(() => {
    if (!selectedDisplayConfigId) {
      lastAppliedDisplayConfigRef.current = '';
    }
  }, [selectedDisplayConfigId]);

  const handleCreateDisplayConfig = useCallback(async (name: string) => {
    if (!firestoreDB) return;
    try {
      const docRef = await addDoc(collection(firestoreDB, 'display_configuration'), {
        name,
        hidden: [],
        createdAt: new Date(),
        createdAtServer: serverTimestamp(),
      });
      setSelectedDisplayConfigId(docRef.id);
      setIsDisplayConfigModalOpen(true);
    } catch (error) {
      console.error('[DisplayConfig] Failed to create configuration:', error);
    }
  }, []);

  const handleRenameDisplayConfig = useCallback(async (configId: string, name: string) => {
    if (!firestoreDB) return;
    try {
      await updateDoc(doc(firestoreDB, 'display_configuration', configId), { name });
    } catch (error) {
      console.error('[DisplayConfig] Failed to rename configuration:', error);
    }
  }, []);

  const handleDeleteDisplayConfig = useCallback(async (configId: string) => {
    if (!firestoreDB) return;
    try {
      await deleteDoc(doc(firestoreDB, 'display_configuration', configId));
      if (selectedDisplayConfigId === configId) {
        setSelectedDisplayConfigId('');
      }
    } catch (error) {
      console.error('[DisplayConfig] Failed to delete configuration:', error);
    }
  }, [selectedDisplayConfigId]);

  const handleUpdateDisplayConfigHidden = useCallback(async (configId: string, hidden: string[]) => {
    if (!firestoreDB) return;
    try {
      await updateDoc(doc(firestoreDB, 'display_configuration', configId), { hidden });
    } catch (error) {
      console.error('[DisplayConfig] Failed to update configuration:', error);
    }
  }, []);

  const handleSelectDisplayConfig = useCallback((configId: string) => {
    setSelectedDisplayConfigId(configId);
  }, []);

  const handleToggleDisplayConfigParam = useCallback((
    configId: string,
    paramId: string,
    checked: boolean,
  ) => {
    const config = displayConfigurations.find((cfg) => cfg.id === configId);
    if (!config) return;
    const hiddenSet = new Set(config.hidden || []);
    if (checked) {
      hiddenSet.delete(paramId);
    } else {
      hiddenSet.add(paramId);
    }
    const hidden = Array.from(hiddenSet);
    handleUpdateDisplayConfigHidden(configId, hidden);
    setHidden(paramId, !checked);
  }, [displayConfigurations, handleUpdateDisplayConfigHidden, setHidden]);

  const handleSetAllDisplayConfigParams = useCallback((
    configId: string,
    checked: boolean,
  ) => {
    const hidden = checked ? [] : discoveredParameters.map((param) => param.originalName);
    handleUpdateDisplayConfigHidden(configId, hidden);
    discoveredParameters.forEach((param) => {
      setHidden(param.originalName, !checked);
    });
  }, [discoveredParameters, handleUpdateDisplayConfigHidden, setHidden]);

  const handleSetSectionDisplayConfigParams = useCallback((
    configId: string,
    paramIds: string[],
    checked: boolean,
  ) => {
    const config = displayConfigurations.find((cfg) => cfg.id === configId);
    if (!config) return;
    const hiddenSet = new Set(config.hidden || []);
    paramIds.forEach((paramId) => {
      if (checked) {
        hiddenSet.delete(paramId);
      } else {
        hiddenSet.add(paramId);
      }
      setHidden(paramId, !checked);
    });
    handleUpdateDisplayConfigHidden(configId, Array.from(hiddenSet));
  }, [displayConfigurations, handleUpdateDisplayConfigHidden, setHidden]);

  const handleSaveCurrentHiddenToConfig = useCallback(async () => {
    if (!selectedDisplayConfigId) return;
    const hidden = discoveredParameters
      .filter((param) => getParameterSettings(param.originalName).hidden)
      .map((param) => param.originalName);
    handleUpdateDisplayConfigHidden(selectedDisplayConfigId, hidden);
  }, [selectedDisplayConfigId, discoveredParameters, getParameterSettings, handleUpdateDisplayConfigHidden]);
  
  // State for temporary categories (shared with CategoriesModal)
  const [temporaryCategories, setTemporaryCategories] = useState<string[]>([]);
  
  // State for collapsed categories 
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const { isSearchOpen, closeSearch } = useGlobalSearch();
  const { navigateToParameter } = useParameterNavigation({
    onExpandCategory: (categoryName: string) => {
      setCollapsedCategories(prev => ({
        ...prev,
        [categoryName]: false
      }));
    }
  });

  const { navigateToAlarmParameter } = useAlarmNavigation({
    onExpandCategory: (categoryName: string) => {
      setCollapsedCategories(prev => ({
        ...prev,
        [categoryName]: false
      }));
    },
    onCloseNotificationHistory: () => {}
  });

  const handleCategoryExpand = useCallback((categoryName: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [categoryName]: false
    }));
  }, []);

  // Auto-highlight out-of-range parameters on every data update
  useEffect(() => {
    try {
      // Trigger via custom event so hook can respond, or call a function if exposed
      const event = new CustomEvent('rigwatch-auto-highlight-tick');
      window.dispatchEvent(event);
    } catch {}
  }, [currentData]);

  // Handle parameter selection from global search
  const handleParameterSelect = useCallback((paramId: string, categoryName: string) => {
    console.log(`[App] Parameter selected from search: ${paramId} in category ${categoryName}`);
    
    // Navigate to the parameter with highlight
    navigateToParameter(paramId, categoryName);
  }, [navigateToParameter]);

  // Handle alarm click from notifications
  const handleAlarmClick = useCallback(async (deviceId: string, parameterName: string) => {
    console.log(`[App] Alarm clicked: ${parameterName} on device ${deviceId}`);
    
    // Navigate to the alarm parameter with continuous highlighting
    await navigateToAlarmParameter(deviceId, parameterName);
  }, [navigateToAlarmParameter]);

  // Filter parameters for primary category
  const primaryCategoryParameters = useMemo(() => {
    if (primaryCategory === 'uncategorized') {
      return discoveredParameters.filter(param => {
        const kategorie = (param as any).kategorie;
        return !kategorie || kategorie.trim() === '';
      });
    } else {
      return discoveredParameters.filter(param => {
        const kategorie = (param as any).kategorie;
        return kategorie === primaryCategory;
      });
    }
  }, [discoveredParameters, primaryCategory]);

  // Get secondary categories (all categories except primary)
  const secondaryCategories = useMemo(() => {
    const categories = new Set<string>();
    
    // Add all real categories from parameters
    discoveredParameters.forEach(param => {
      const kategorie = (param as any).kategorie;
      if (kategorie && kategorie.trim() !== '') {
        categories.add(kategorie);
      }
    });
    
    // Add temporary categories
    temporaryCategories.forEach(tempCategory => {
      categories.add(tempCategory);
    });
    
    // Add uncategorized if it has parameters and is not primary
    const uncategorizedCount = discoveredParameters.filter(param => {
      const kategorie = (param as any).kategorie;
      return !kategorie || kategorie.trim() === '';
    }).length;
    
    if (uncategorizedCount > 0 && primaryCategory !== 'uncategorized') {
      categories.add('uncategorized');
    }
    
    // Remove primary category
    categories.delete(primaryCategory);
    
    return Array.from(categories).sort();
  }, [discoveredParameters, primaryCategory, temporaryCategories]);

  const visibleSecondaryCategories = useMemo(() => {
    const isInCategory = (param: ParameterInfo, categoryName: string) => {
      const kategorie = (param as any).kategorie;
      if (categoryName === 'uncategorized') {
        return !kategorie || String(kategorie).trim() === '';
      }
      return kategorie === categoryName;
    };
    return secondaryCategories.filter(categoryName =>
      discoveredParameters.some(param =>
        isInCategory(param, categoryName) && !getParameterSettings(param.originalName).hidden
      )
    );
  }, [secondaryCategories, discoveredParameters, getParameterSettings, localSettingsVersion]);

  // FIXED: Debounced parameter discovery to prevent infinite loops
  const discoveryTimeoutRef = useRef<number | null>(null);
  const lastProcessedKeysRef = useRef<string>('');
  const chartContainerRef = useRef<ChartDivElement | null>(null);

  // Auto-connect from URL (only once per session, and only if ?id= was present on first load)
  const autoConnectAttemptedRef = useRef(false);
  useEffect(() => {
    // Prevent multiple or late auto-connect attempts
    if (autoConnectAttemptedRef.current) return;

    const urlParams = new URLSearchParams(window.location.search);
    const urlDeviceId = urlParams.get('id');

    if (urlDeviceId && !deviceId) {
      console.log('[App] Auto-connecting to device from URL:', urlDeviceId);
      autoConnectAttemptedRef.current = true;
      connect(urlDeviceId).catch(console.error);
      return;
    }

    // If there is no ?id= in the URL on initial load, never auto-connect later in this session,
    // even if other parts of the UI add or change the URL parameters.
    if (!urlDeviceId) {
      autoConnectAttemptedRef.current = true;
    }
  }, [deviceId, connect]);

  // Load primary category when device connects
  useEffect(() => {
    if (deviceId) {
      const savedPrimaryCategory = getPrimaryCategory();
      console.log(`[App] Loading saved primary category for ${deviceId}: ${savedPrimaryCategory}`);
      setPrimaryCategory(savedPrimaryCategory);
    }
  }, [deviceId, getPrimaryCategory, setPrimaryCategory]);

  // Load section order when device connects
  useEffect(() => {
    if (deviceId) {
      const savedOrder = getSectionOrder();
      console.log(`[App] Loading saved section order for ${deviceId}:`, savedOrder);
      useRigStore.getState().setSectionOrder(savedOrder);
    }
  }, [deviceId, getSectionOrder]);

  // Listen for Firebase metadata updates to sync cache between tabs (debounced rediscovery)
  useEffect(() => {
    const pendingParams = new Set<string>();
    let debounceTimer: number | null = null;

    const flush = () => {
      debounceTimer = null;
      if (!currentData || pendingParams.size === 0) return;
      console.log(`[App] Applying ${pendingParams.size} metadata updates (debounced)`);
      pendingParams.clear();
      discoverParameters(currentData).catch(console.error);
    };

    const scheduleFlush = () => {
      if (debounceTimer != null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(flush, 250) as unknown as number;
    };

    const handleParameterUpdate = (event: CustomEvent) => {
      const { paramId, metadata } = event.detail;
      updateParameterCache(paramId, metadata);
      pendingParams.add(paramId);
      scheduleFlush();
    };

    window.addEventListener('parameterMetadataUpdated', handleParameterUpdate as EventListener);
    
    return () => {
      window.removeEventListener('parameterMetadataUpdated', handleParameterUpdate as EventListener);
      if (debounceTimer != null) {
        clearTimeout(debounceTimer);
      }
    };
  }, [updateParameterCache, discoverParameters, currentData]);

  // FIXED: Simplified and efficient parameter discovery like legacy
  useEffect(() => {
    if (!currentData || Object.keys(currentData).length === 0) return;

    // Skip discovery if we have __historical flag (historical data shouldn't trigger discovery)
    if (currentData.__historical) return;

    // Get current parameter keys (exclude system keys like legacy)
    const currentParamKeys = Object.keys(currentData)
      .filter(key => !key.startsWith('~~') && key !== 'id_timestamp' && key !== 'TRIG1' && key !== '__historical')
      .sort();

    // Check if we have any parameters that aren't discovered yet  
    const discoveredKeys = discoveredParameters.map(p => p.originalName).sort();
    const hasNewParameters = currentParamKeys.some(key => !discoveredKeys.includes(key));

    // Only trigger discovery if we have truly new parameters
    if (hasNewParameters) {
      console.log('[App] New parameters detected, triggering discovery');
      discoverParameters(currentData).catch(console.error);
    }
  }, [currentData, discoveredParameters, discoverParameters]);

  // Reset refs when device changes
  useEffect(() => {
    if (!deviceId) {
      lastProcessedKeysRef.current = '';
      if (discoveryTimeoutRef.current) {
        clearTimeout(discoveryTimeoutRef.current);
        discoveryTimeoutRef.current = null;
      }
    }
  }, [deviceId]);

  // Memoized check for data availability to prevent unnecessary re-runs
  const hasCurrentData = useMemo(() => {
    return Object.keys(currentData).length > 0;
  }, [Object.keys(currentData).length]); // Only depend on the count, not the actual data
  
  // Restore parameter overrides from localStorage - ONLY ONCE per device connection
  const restoreParameterOverrides = useCallback(() => {
    if (!deviceId) return;
    
    console.log(`[App] Checking for parameter overrides in localStorage (one-time restore)`);
    
    const overridesToApply: Record<string, number> = {};
    const now = Date.now();
    
    // Check all localStorage keys for this device
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`param_override_${deviceId}_`)) {
        try {
          const backupData = JSON.parse(localStorage.getItem(key) || '{}');
          
          // Check if backup is not expired
          if (backupData.expires && now < backupData.expires) {
            const paramId = key.replace(`param_override_${deviceId}_`, '');
            overridesToApply[paramId] = backupData.value;
            console.log(`[App] Found valid override for ${paramId}: ${backupData.value}`);
          } else {
            // Remove expired override
            localStorage.removeItem(key);
            console.log(`[App] Removed expired override: ${key}`);
          }
        } catch (error) {
          console.error(`[App] Error parsing localStorage backup for ${key}:`, error);
          localStorage.removeItem(key);
        }
      }
    }
    
    // Apply all valid overrides
    if (Object.keys(overridesToApply).length > 0) {
      console.log(`[App] Applying ${Object.keys(overridesToApply).length} parameter overrides:`, overridesToApply);
      useRigStore.getState().updateCurrentData(overridesToApply);
    }
  }, [deviceId]);

  // Restore parameter overrides from localStorage ONLY ONCE after device connection
  const hasRestoredOverrides = useRef<string | null>(null);
  useEffect(() => {
    if (deviceId && connectionStatus === 'online' && hasCurrentData && hasRestoredOverrides.current !== deviceId) {
      // Mark this device as having restored overrides
      hasRestoredOverrides.current = deviceId;
      
      // Delay to ensure parameters are discovered first
      setTimeout(() => {
        restoreParameterOverrides();
      }, 1000);
    }
    
    // Reset when device changes or disconnects
    if (!deviceId || connectionStatus !== 'online') {
      hasRestoredOverrides.current = null;
    }
  }, [deviceId, connectionStatus, hasCurrentData, restoreParameterOverrides]); // Use memoized data check

  // AlwaysSendData is now handled automatically - no user control needed

  const handleFirmwareUpdate = useCallback(async (force = false) => {
    console.log(`[App] Firmware update requested (force: ${force})`);
    
    if (force) {
      const confirmed = window.confirm(
        t('updates.confirmForceUpdate', 'Are you sure you want to force the firmware update? This might be unstable if no new version is explicitly available.')
      );
      if (!confirmed) {
        console.log('[App] Force firmware update cancelled by user');
        return;
      }
    }
    await triggerFirmwareUpdate(force);
  }, [triggerFirmwareUpdate, t]);

  const handleCheckForUpdates = useCallback(async () => {
    console.log('[App] Checking for firmware updates...');
    
    try {
      // Use the actual checkForUpdates function from Firebase hooks
      const hasUpdates = await checkForUpdates();
      console.log('[App] Update check completed. Updates available:', hasUpdates);
      
    } catch (error) {
      console.error('[App] Error checking for updates:', error);
    }
  }, [checkForUpdates]);

  const handleLoadHistoricalDataToChart = useCallback((historicalData: any, timestamp: string) => {
    console.log('[App] Loading historical data to chart:', timestamp);
    
    // Get chart reference and add historical data like legacy
    const chartComponent = document.querySelector('.realtime-chart-component');
    if (chartComponent && (chartComponent as any).addHistoricalDataToChart) {
      // Parse timestamp to get base timestamp
      const baseTimestamp = parseInt(timestamp);
      (chartComponent as any).addHistoricalDataToChart(historicalData, baseTimestamp);
      if ((chartComponent as any).clearMarkers) {
        (chartComponent as any).clearMarkers();
      }
    } else {
      console.warn('[App] Chart component not found or method not available');
    }
  }, []);

  const handleShowRigInfo = useCallback(() => {
    console.log('[App] Opening rig info modal');
    setIsRigInfoModalOpen(true);
  }, []);

  // UPDATED: Toggle favorite with localStorage
  const handleToggleFavorite = useCallback(async (paramId: string) => {
    const param = discoveredParameters.find(p => p.originalName === paramId);
    if (!param) {
      console.error(`[App] Parameter ${paramId} not found for favorite toggle`);
      return;
    }

    const newFavoriteState = param.favorite === 1 ? 0 : 1;
    console.log(`[App] Toggling favorite for ${paramId}: ${param.favorite} -> ${newFavoriteState}`);
    
    try {
      const success = toggleFavorite(paramId, newFavoriteState);
      if (success) {
        // Update store immediately for UI responsiveness
        const updatedParams = discoveredParameters.map(p => 
          p.originalName === paramId 
            ? { ...p, favorite: newFavoriteState }
            : p
        );
        setDiscoveredParameters(updatedParams);
        
        console.log(`[App] Successfully toggled favorite for ${paramId}`);
      } else {
        console.error(`[App] Failed to toggle favorite for ${paramId}`);
      }
    } catch (error) {
      console.error(`[App] Error toggling favorite for ${paramId}:`, error);
    }
  }, [discoveredParameters, toggleFavorite, setDiscoveredParameters]);

  // UPDATED: Toggle show in legend with localStorage
  const handleToggleShowInLegend = useCallback(async (paramId: string, showInLegend: boolean) => {
    const param = discoveredParameters.find(p => p.originalName === paramId);
    if (!param) {
      console.error(`[App] Parameter ${paramId} not found for legend toggle`);
      return;
    }

    console.log(`[App] Toggling legend for ${paramId}: ${param.show_in_legend} -> ${showInLegend}`);

    try {
      let initialVisibility = false;
      if (showInLegend) {
        // Base parameters respect their isInitiallyVisibleOnChart
        initialVisibility = param.defaultChart ? param.isInitiallyVisibleOnChart : false;
        console.log(`[App] Setting initial visibility for ${paramId}: ${initialVisibility} (isBase: ${param.defaultChart})`);
      }

      const success = toggleShowInLegendWithVisibility(paramId, showInLegend, initialVisibility);
      
      if (success) {
        // Update store immediately for UI responsiveness
        const updatedParams = discoveredParameters.map(p => 
          p.originalName === paramId 
            ? { ...p, show_in_legend: showInLegend, visible_on_chart: showInLegend ? initialVisibility : false }
            : p
        );
        setDiscoveredParameters(updatedParams);
        
        console.log(`[App] Successfully toggled legend for ${paramId}`);
      } else {
        console.error(`[App] Failed to toggle legend for ${paramId}`);
      }
    } catch (error) {
      console.error(`[App] Error toggling legend for ${paramId}:`, error);
    }
  }, [discoveredParameters, toggleShowInLegendWithVisibility, setDiscoveredParameters]);

  // UPDATED: Reorder parameters with localStorage
  const handleReorderParameters = useCallback((orderedParamIds: string[]) => {
    console.log(`[App] Reordering ${orderedParamIds.length} parameters:`, orderedParamIds);
    
    if (orderedParamIds.length === 0) {
      console.warn('[App] No parameters to reorder');
      return;
    }
    
    // Update positions in localStorage
    try {
      orderedParamIds.forEach((paramId, index) => {
        console.log(`[App] Setting position ${index} for parameter ${paramId}`);
        setPosition(paramId, index);
      });
      
      // Update store immediately for UI responsiveness
      const updatedParams = discoveredParameters.map(param => {
        const newIndex = orderedParamIds.indexOf(param.originalName);
        return newIndex !== -1 
          ? { ...param, position: newIndex }
          : param;
      });
      setDiscoveredParameters(updatedParams);
      
      console.log('[App] All parameter positions updated successfully');
    } catch (error) {
      console.error('[App] Failed to reorder parameters:', error);
    }
  }, [setPosition, discoveredParameters, setDiscoveredParameters]);

  const handleEditParameter = useCallback((paramId: string) => {
    const parameter = discoveredParameters.find(p => p.originalName === paramId);
    if (parameter) {
      console.log('[App] Opening edit modal for parameter:', paramId);
      
      // PERFORMANCE FIX: Create Firestore listener ONLY for the edited parameter
      // Instead of creating 100+ listeners for all parameters, subscribe only to the active one
      try {
        setupParameterListener(paramId);
        console.log('[App] Setup Firestore listener for parameter:', paramId);
      } catch (error) {
        console.warn('[App] Failed to setup parameter listener:', error);
      }
      
      setEditingParameter(parameter);
      setIsModalOpen(true);
    } else {
      console.error('[App] Parameter not found for editing:', paramId);
    }
  }, [discoveredParameters, setupParameterListener]);

  // UPDATED: Handle parameter settings save (keep Firebase for display names, colors, etc.)
  const handleParameterSave = useCallback(async (paramId: string, settings: Partial<ParameterInfo>) => {
    console.log('[App] Saving parameter settings for:', paramId, settings);
    
    const currentParam = discoveredParameters.find(p => p.originalName === paramId);
    console.log('[App] Current parameter state:', currentParam ? {
      displayName: currentParam.displayName,
      unit: currentParam.unit,
      divisor: currentParam.divisor,
      color: currentParam.color
    } : 'not found');
    
    try {
      // Persist and re-apply local visual settings (color/position/visibility/favorite) immediately
      const resolvedColor = (settings.color ?? currentParam?.color);
      const resolvedPosition = (settings.position ?? currentParam?.position);
      const resolvedShow = (settings as any).show_in_legend ?? currentParam?.show_in_legend ?? true;
      const resolvedVisible = (settings as any).visible_on_chart ?? currentParam?.visible_on_chart ?? false;
      const resolvedFavorite = (settings as any).favorite ?? currentParam?.favorite ?? 0;

      if (resolvedColor !== undefined) {
        try { setColor(paramId, String(resolvedColor)); } catch {}
      }
      if (typeof resolvedPosition === 'number' && isFinite(resolvedPosition)) {
        try { setPosition(paramId, resolvedPosition); } catch {}
      }
      try {
        toggleShowInLegendWithVisibility(paramId, !!resolvedShow, !!resolvedVisible);
        toggleVisibleOnChart(paramId, !!resolvedVisible);
      } catch {}
      try { toggleFavorite(paramId, Number(resolvedFavorite) || 0); } catch {}

      // Helper to apply metadata patches locally (for immediate UI feedback)
      const applyMetadataPatch = (patch: Partial<ParameterInfo>) => {
        const next = discoveredParameters.map(p => p.originalName === paramId ? { ...p, ...patch } : p);
        setDiscoveredParameters(next);
      };

      // Extract purely visual fields we keep locally
      const localOnlyUpdates: Partial<ParameterInfo> = {};
      if (settings.color !== undefined) localOnlyUpdates.color = settings.color;
      if (settings.position !== undefined) localOnlyUpdates.position = settings.position as any;
      if ((settings as any).show_in_legend !== undefined) localOnlyUpdates.show_in_legend = (settings as any).show_in_legend;
      if ((settings as any).visible_on_chart !== undefined) localOnlyUpdates.visible_on_chart = (settings as any).visible_on_chart;
      if ((settings as any).favorite !== undefined) localOnlyUpdates.favorite = (settings as any).favorite;

      // Apply local-only updates immediately and persist
      if (Object.keys(localOnlyUpdates).length > 0) {
        if (localOnlyUpdates.color !== undefined) {
          // Persist to localStorage via stable hook reference
          try { setColor(paramId, String(localOnlyUpdates.color)); } catch {}
        }
        if (localOnlyUpdates.position !== undefined && typeof localOnlyUpdates.position === 'number') {
          try { setPosition(paramId, localOnlyUpdates.position); } catch {}
        }
        if (localOnlyUpdates.show_in_legend !== undefined || localOnlyUpdates.visible_on_chart !== undefined) {
          const nextShow = localOnlyUpdates.show_in_legend ?? currentParam?.show_in_legend ?? true;
          const nextVisible = localOnlyUpdates.visible_on_chart ?? currentParam?.visible_on_chart ?? false;
          try { toggleShowInLegendWithVisibility(paramId, !!nextShow, !!nextVisible); } catch {}
          try { toggleVisibleOnChart(paramId, !!nextVisible); } catch {}
        }
        if (localOnlyUpdates.favorite !== undefined) {
          try { toggleFavorite(paramId, Number(localOnlyUpdates.favorite) || 0); } catch {}
        }
        // Optimistic store update
        const updated = discoveredParameters.map(p => p.originalName === paramId ? { ...p, ...localOnlyUpdates } : p);
        setDiscoveredParameters(updated);
      }

      // Remove local-only fields before Firestore save
      const { color, position, ...rest } = settings as any;

      // Handle category changes separately if present
      if ('kategorie' in rest) {
        const categoryValue = (rest as any).kategorie;
        await updateParameterCategory(paramId, categoryValue);
        const { kategorie, ...restSettings } = rest as any;
        if (Object.keys(restSettings).length > 0) {
          console.log('[App] Saving non-category settings to Firebase:', restSettings);
          const success = await saveMetadata(paramId, restSettings);
          if (success) {
            // Optimistic local patch for metadata (includes min/max/divisor/etc.)
            applyMetadataPatch({ ...restSettings, kategorie: categoryValue });
            console.log('[App] Firebase save successful, Firebase listener will update local state');
            console.log('[App] Parameter settings saved successfully');
            // Clear parameter cache to force reload of metadata
            clearParameterCache(paramId);
            // Trigger re-discovery of this specific parameter to apply new metadata
            if (currentData) {
              console.log('[App] Re-discovering parameter with new metadata');
              setTimeout(() => discoverParameters(currentData), 100);
            }
          } else {
            console.error('[App] Failed to save other parameter settings');
          }
        } else {
          // Only category changed -> update local immediately
          applyMetadataPatch({ kategorie: categoryValue });
        }
      } else {
        // Save remaining fields to Firebase
        if (Object.keys(rest).length > 0) {
          console.log('[App] Saving all settings to Firebase:', rest);
          const success = await saveMetadata(paramId, rest);
          if (success) {
            // Optimistic local patch for metadata (includes min/max/divisor/etc.)
            applyMetadataPatch(rest);
            console.log('[App] Firebase save successful, Firebase listener will update local state');
            console.log('[App] Parameter settings saved successfully');
            // Clear parameter cache to force reload of metadata
            clearParameterCache(paramId);
            // Trigger re-discovery of this specific parameter to apply new metadata
            if (currentData) {
              console.log('[App] Re-discovering parameter with new metadata');
              setTimeout(() => discoverParameters(currentData), 100);
            }
          } else {
            console.error('[App] Failed to save parameter settings');
          }
        }
      }
    } catch (error) {
      console.error('[App] Error saving parameter settings:', error);
    }
  }, [saveMetadata, updateParameterCategory, discoveredParameters, setDiscoveredParameters, setPosition, clearParameterCache, currentData, discoverParameters]);
  
  // Handle modal close
  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setEditingParameter(null);
  }, []);

    // Handle parameter value change (simplified like Terminal.tsx)
  const handleParameterValueChange = useCallback(async (paramId: string, newValue: string): Promise<boolean> => {
    console.log(`[App] handleParameterValueChange called for ${paramId} with value: "${newValue}"`);
    
    if (!deviceId) {
      console.error(`[App] No device connected`);
      return false;
    }

    // Parse value with comma/dot support for floats
    const normalizedInput = newValue.replace(',', '.'); // Replace comma with dot
    
    if (normalizedInput === '') {
      console.error(`[App] Empty value not allowed for parameter ${paramId}`);
      return false;
    }
    
    console.log(`[App] Sending parameter ${paramId} with value: ${normalizedInput}`);
    
    // Optimistic update: compute raw value for store and apply immediately
    try {
      const paramMeta = discoveredParameters.find(p => p.originalName === paramId);
      const dataType = getParameterDataType(paramMeta as any);
      const divisor = (paramMeta && typeof paramMeta.divisor === 'number' && !isNaN(paramMeta.divisor)) ? (paramMeta.divisor || 1) : 1;

      const previousRawValue = useRigStore.getState().currentData?.[paramId];

      // Only apply optimistic update for numeric/bool types
      if (dataType === 'bool' || dataType === 'int' || dataType === 'float' || dataType === 'uint64_t') {
        let optimisticRaw: number | boolean;
        if (dataType === 'bool') {
          const val = normalizedInput.trim().toLowerCase();
          optimisticRaw = (val === '1' || val === 'true' || val === 'yes' || val === 'on') ? 1 : 0;
        } else {
          const parsed = Number(normalizedInput);
          if (Number.isNaN(parsed)) {
            console.error(`[App] Invalid number for ${paramId}: ${normalizedInput}`);
            return false;
          }
          // For time parameters, the UI already sent RAW value (display value × divisor).
          // So we must NOT multiply by divisor again here.
          if (paramMeta && isTimeParameter(paramMeta as any)) {
            optimisticRaw = parsed;
          } else {
            const num = dataType === 'int' || dataType === 'uint64_t' ? Math.round(parsed) : parsed;
            optimisticRaw = num * divisor;
          }
        }

        // Mark as recently changed to avoid flicker from live updates
        markParameterAsRecentlyChanged(paramId);
        // Apply optimistically
        useRigStore.getState().updateCurrentData({ [paramId]: optimisticRaw } as any, undefined, true);

        try {
          // Send to backend
          const success = await updateParameter(paramId, normalizedInput);
          if (!success) {
            // Rollback to previous value
            useRigStore.getState().updateCurrentData({ [paramId]: previousRawValue } as any, undefined, true);
          }
          return success;
        } catch (err) {
          console.error(`[App] Error updating parameter ${paramId} value:`, err);
          // Rollback to previous value
          useRigStore.getState().updateCurrentData({ [paramId]: previousRawValue } as any, undefined, true);
          return false;
        }
      }

      // For string types, just send without optimistic store update
      try {
        const success = await updateParameter(paramId, normalizedInput);
        return success;
      } catch (err) {
        console.error(`[App] Error updating parameter ${paramId} value:`, err);
        return false;
      }
    } catch (optimisticError) {
      console.error('[App] Optimistic update failed to compute/apply:', optimisticError);
      // Fallback to non-optimistic path below
    }
    
    // Non-optimistic fallback (should rarely happen)
    try {
      const success = await updateParameter(paramId, normalizedInput);
      return success;
    } catch (error) {
      console.error(`[App] Error updating parameter ${paramId} value (fallback):`, error);
      return false;
    }
  }, [deviceId, updateParameter, discoveredParameters, markParameterAsRecentlyChanged]);

  // Handle drag & drop for main block
  const handleMainDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDraggedOverMain(true);
  }, []);

  const handleMainDragLeave = useCallback((e: React.DragEvent) => {
    // Only set isDraggedOver to false if we're actually leaving the entire component
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    // If mouse is still within the component bounds, don't hide the drag state
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return;
    }
    
    setIsDraggedOverMain(false);
  }, []);

  const handleMainDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggedOverMain(false);
    
    const paramId = e.dataTransfer.getData('text/plain');
    if (paramId && updateParameterCategory) {
      try {
        // Move to uncategorized (null)
        await updateParameterCategory(paramId, null);
        console.log(`[App] Moved parameter ${paramId} to uncategorized (main)`);
      } catch (error) {
        console.error('Failed to move parameter to main:', error);
      }
    }
  }, [updateParameterCategory]);

  // Force refresh of category components
  const forceCategoryRefresh = useCallback(() => {
    setCategoryRefreshKey(prev => prev + 1);
    console.log('[App] Forcing category refresh');
  }, []);

  // Wrapper for renameCategory with force refresh
  const handleRenameCategory = useCallback(async (oldName: string, newName: string) => {
    await renameCategory(oldName, newName);
    // Force refresh after successful rename
    forceCategoryRefresh();
  }, [renameCategory, forceCategoryRefresh]);

  // Section ordering handlers for ConnectionPanel
  const handleMoveSectionUp = useCallback((sectionId: string) => {
    console.log(`[App] Moving section up: ${sectionId}`);
    moveSectionUp(sectionId);
    // Save updated order to localStorage
    const currentOrder = useRigStore.getState().sectionOrder;
    saveSectionOrder(currentOrder);
  }, [moveSectionUp, saveSectionOrder]);

  const handleMoveSectionDown = useCallback((sectionId: string) => {
    console.log(`[App] Moving section down: ${sectionId}`);
    moveSectionDown(sectionId);
    // Save updated order to localStorage
    const currentOrder = useRigStore.getState().sectionOrder;
    saveSectionOrder(currentOrder);
  }, [moveSectionDown, saveSectionOrder]);

  // Memoized temporary categories handler to prevent infinite re-renders
  const handleTemporaryCategoriesChange = useCallback((categories: string[]) => {
    setTemporaryCategories(categories);
  }, []);

  // Handle category collapse state change
  const handleCategoryCollapseChange = useCallback((categoryName: string, isCollapsed: boolean) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [categoryName]: isCollapsed
    }));
  }, []);

  // Render sections in order
  const renderSectionInOrder = useCallback(() => {
    const defaultOrder = ['rig-management', 'secondary-categories', 'main-and-airflow', 'charts'];
    const currentOrder = sectionOrder.length > 0 ? sectionOrder : defaultOrder;
    
    const sectionComponents: Record<string, React.ReactElement | false> = {
      'rig-management': (
        <SectionWrapper
          key="rig-management"
          sectionId="rig-management"
          title={t('sections.rigManagement')}
          onMoveSectionUp={handleMoveSectionUp}
          onMoveSectionDown={handleMoveSectionDown}
        >
          <RigManagementPanel 
            onFirmwareUpdate={handleFirmwareUpdate}
            onCheckForUpdates={handleCheckForUpdates}
            onLoadHistoricalDataToChart={handleLoadHistoricalDataToChart}
            onShowRigInfo={handleShowRigInfo}
          />
        </SectionWrapper>
      ),
      'secondary-categories': visibleSecondaryCategories.length > 0 && (
        <SectionWrapper
          key="secondary-categories"
          sectionId="secondary-categories"
          title={t('sections.secondaryCategories')}
          onMoveSectionUp={handleMoveSectionUp}
          onMoveSectionDown={handleMoveSectionDown}
        >
          <div className="space-y-2 sm:space-y-3">
            {/* Calculate grid layout for secondary categories */}
            {(() => {
              const categoriesPerRow = Math.min(visibleSecondaryCategories.length, 3);
              const rows = Math.ceil(visibleSecondaryCategories.length / 3);
              // Responsive columns: phone=1, tablet=2, desktop (xl+) = 3
              const gridCols = categoriesPerRow === 1
                ? 'grid-cols-1'
                : categoriesPerRow === 2
                  ? 'grid-cols-1 sm:grid-cols-2'
                  : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';
              
              const categoryRows = [];
              for (let i = 0; i < rows; i++) {
                const startIndex = i * 3;
                const rowCategories = visibleSecondaryCategories.slice(startIndex, startIndex + 3);
                
                categoryRows.push(
                  <div key={`row-${i}`} className={`grid ${gridCols} gap-2 sm:gap-3`}>
                    {rowCategories.map(categoryName => (
                       <CategoryBlock
                         key={`${categoryName}-${categoryRefreshKey}`}
                         categoryName={categoryName}
                         parameters={discoveredParameters}
                         isEditMode={isEditMode}
                         onToggleFavorite={handleToggleFavorite}
                         onToggleShowInLegend={handleToggleShowInLegend}
                         onEditParameter={handleEditParameter}
                         onReorderParameters={handleReorderParameters}
                         onMoveParameterToCategory={updateParameterCategory}
                         onRenameCategory={handleRenameCategory}
                         onParameterValueChange={handleParameterValueChange}
                         isTemporary={temporaryCategories.includes(categoryName)}
                         onCollapseChange={handleCategoryCollapseChange}
                         isCollapsedExternal={collapsedCategories[categoryName]}
                       />
                     ))}
                  </div>
                );
              }
              
              return categoryRows;
            })()}
          </div>
        </SectionWrapper>
      ),
      'main-and-airflow': (
        <SectionWrapper
          key="main-and-airflow"
          sectionId="main-and-airflow"
          title={t('sections.mainAndAirflow')}
          onMoveSectionUp={handleMoveSectionUp}
          onMoveSectionDown={handleMoveSectionDown}
        >
          <div className="space-y-2 sm:space-y-3 xl:space-y-0 xl:grid xl:grid-cols-3 xl:gap-3">
            {/* Parameters Panel - Full width on mobile, 2/3 on desktop */}
            <div className="xl:col-span-2">
              <div 
                className={`bg-card rounded-theme overflow-hidden border-2 ${
                  isDraggedOverMain 
                    ? 'border-success bg-success/10' 
                    : 'border-border'
                }`} 
                data-section="data-parameters"
                onDragOver={handleMainDragOver}
                onDragLeave={handleMainDragLeave}
                onDrop={handleMainDrop}
              >
                {/* Mobile-responsive header */}
                <div 
                  className={`px-2 sm:px-3 py-2 rounded-t-theme ${
                    isDraggedOverMain 
                      ? 'bg-success text-success-foreground' 
                      : 'bg-section-header text-section-header-foreground'
                  }`}
                >
                  <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                    <h2 className="text-sm font-semibold flex items-center">
                      <div className="w-4 h-4 mr-2 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                        </svg>
                      </div>
                      <span>{primaryCategory === 'uncategorized' ? t('sections.main') : primaryCategory}</span>
                      <span className="ml-2 bg-success/20 text-success px-2 py-0.5 rounded text-xs font-medium">
                        {primaryCategoryParameters.length}
                      </span>
                      
                      {/* Removed inline "Drop here" hint */}
                    </h2>
                    
                    <div className="flex items-center space-x-2">

                      
                      <div className="relative flex-1 sm:flex-none">
                        <input
                          type="text"
                          placeholder={t('usersList.searchPlaceholder') as string}
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-7 pr-3 py-1.5 bg-card text-foreground border border-border text-xs w-full sm:w-32 md:w-36 placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring rounded-none shadow-[4px_4px_0_0_var(--border)]"
                        />
                          <svg className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      

                    </div>
                  </div>
                </div>

                <div className="p-2 sm:p-3 relative">
                  <ParameterGrid
                    parameters={primaryCategoryParameters}
                    isEditMode={isEditMode}
                    searchTerm={searchTerm}
                    filterAccess={parameterViewScope || 'all'}
                    onToggleFavorite={handleToggleFavorite}
                    onToggleShowInLegend={handleToggleShowInLegend}
                    onEditParameter={handleEditParameter}
                    onReorderParameters={handleReorderParameters}
                    onParameterValueChange={handleParameterValueChange}
                  />
                  
                  {/* Removed full-surface drag overlay to avoid covering tiles */}
                </div>
              </div>
            </div>

            {/* Air Flow and Errors Panel - Full width on mobile, 1/3 on desktop */}
            <div className="xl:col-span-1 space-y-2 sm:space-y-3">
              <div className="bg-card rounded overflow-hidden border-2 border-border">
                <div className="bg-section-header text-section-header-foreground px-3 py-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold flex items-center">
                    <span className="inline-flex w-4 h-4 mr-2 items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </span>
                    Display Configuration
                  </h2>
                </div>
                <div className="border-t border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedDisplayConfigId}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '__create__') {
                          setIsDisplayConfigModalOpen(true);
                          setSelectedDisplayConfigId('');
                          return;
                        }
                        if (value === '__divider__') {
                          return;
                        }
                        if (value) {
                          handleSelectDisplayConfig(value);
                        }
                      }}
                      className="w-full bg-card text-foreground border border-border text-xs px-2 py-1.5 rounded-none shadow-[4px_4px_0_0_var(--border)] focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
                      aria-label="Display Configuration"
                    >
                      <option value="__create__">Manage Configurations</option>
                      <option value="__divider__" disabled>----</option>
                      {selectedDisplayConfigId === '' && (
                        <option value="" disabled>
                          {displayConfigurations.length === 0 ? 'No Display Configurations' : 'Please select'}
                        </option>
                      )}
                      {displayConfigurations.map((config) => (
                        <option key={config.id} value={config.id}>
                          {config.name}
                        </option>
                      ))}
                    </select>
                    {selectedDisplayConfigId && (
                      <button
                        onClick={handleSaveCurrentHiddenToConfig}
                        className="px-2 py-1 bg-primary text-primary-foreground rounded-none border border-border shadow-[2px_2px_0_0_var(--border)] text-xs"
                        title="Aktuelle Auswahl speichern"
                        aria-label="Aktuelle Auswahl speichern"
                      >
                        ✓
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {useNewDesign ? (
                <MiningAirflowVisualizer />
              ) : (
                <AirFlowDiagram parameters={discoveredParameters} />
              )}
              {useNewDesign ? <MiningHealthPanel /> : <ErrorBlock />}
            </div>
          </div>
        </SectionWrapper>
      ),
      'charts': (
        <SectionWrapper
          key="charts"
          sectionId="charts"
          title={t('sections.charts')}
          onMoveSectionUp={handleMoveSectionUp}
          onMoveSectionDown={handleMoveSectionDown}
        >
          <MultiChartContainer
            parameters={discoveredParameters}
            isHistoricalMode={isHistoricalMode}
            deviceId={deviceId || ''}
            rigModel={deviceMetadata.rigname || 'N/A'}
            rigModelInfo={deviceMetadata.rig ? `Model #${deviceMetadata.rig}` : ''}
            parameterSet={deviceConfig.verz === '~' || !deviceConfig.verz ? 'Default' : deviceConfig.verz}
          />
        </SectionWrapper>
      )
    };
    
    return currentOrder.map(sectionId => sectionComponents[sectionId]).filter(Boolean);
  }, [
    sectionOrder, secondaryCategories, primaryCategoryParameters,
    discoveredParameters, isEditMode, searchTerm, isDraggedOverMain, categoryRefreshKey,
    temporaryCategories, primaryCategory, isHistoricalMode, deviceId, deviceMetadata,
    deviceConfig, hasErrors, handleToggleFavorite, handleToggleShowInLegend, handleEditParameter,
    handleReorderParameters, updateParameterCategory, handleRenameCategory,
    handleMainDragOver, handleMainDragLeave, handleMainDrop, setEditMode,
    handleMoveSectionUp, handleMoveSectionDown, handleTemporaryCategoriesChange,
    handleParameterValueChange, handleFirmwareUpdate, handleCheckForUpdates, handleLoadHistoricalDataToChart,
    handleShowRigInfo, t
  ]);

  // Clear drag state when edit mode is disabled
  useEffect(() => {
    if (!isEditMode) {
      setIsDraggedOverMain(false);
    }
  }, [isEditMode]);

  // Conditionally hide debug info on mobile
  useEffect(() => {
    if (isMobile && showDebugInfo) {
      toggleDebugInfo(); // Turn off debug info if on mobile and it's currently shown
    }
  }, [isMobile, showDebugInfo, toggleDebugInfo]);

  // Artificially transition from connecting → online after 5 s
  useEffect(() => {
    if (connectionStatus === 'connecting') {
      const tmr = setTimeout(() => setConnectionStatus('online'), 5000);
      return () => clearTimeout(tmr);
    }
  }, [connectionStatus, setConnectionStatus]);

  // Standard-mode body — kept in a variable so we can render it either inside
  // the classic full-bleed wrapper or inside the new sidebar shell without
  // duplicating the entire tree.
  const standardContent = (
        <>
          <DevModeIndicator />
          {themeOverlayVisible && (
            <div className="fixed inset-0 z-[1000] pointer-events-none flex flex-col" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
              <div className="flex-1 opacity-80"></div>
              <div className="h-1 bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all duration-[1100ms]" style={{ width: '100%' }} />
              </div>
            </div>
          )}
          <div className="min-h-screen bg-background transition-colors overflow-y-auto">
          <div className="max-w-full mx-auto px-1 sm:px-2 py-2 sm:py-3">
          {useNewDesign ? (
            <Web3ConnectionPanel
              onTemporaryCategoriesChange={handleTemporaryCategoriesChange}
              onOpenAdminPanel={() => setIsAdminPanelOpen(true)}
              onOpenParameterList={() => setIsParameterListOpen(true)}
              onAlarmClick={handleAlarmClick}
            />
          ) : (
            <ConnectionPanel
              onTemporaryCategoriesChange={handleTemporaryCategoriesChange}
              onOpenAdminPanel={() => setIsAdminPanelOpen(true)}
              onOpenParameterList={() => setIsParameterListOpen(true)}
              onAlarmClick={handleAlarmClick}
            />
          )}

          {deviceId && connectionStatus === 'online' && deviceExistence !== 'not_found' && (
            <div className="space-y-2 sm:space-y-3">
              {useNewDesign && <RigVitalsHero />}
              {useNewDesign && <ProfitabilityCard />}
              {renderSectionInOrder()}

              {/* Connection Status Info - Mobile responsive */}
              {currentData.id_timestamp && (
                <div className="bg-card rounded-theme border-2 border-border p-2">
                  <div className="flex flex-col space-y-1 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 text-xs text-muted-foreground">
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-status-online rounded mr-2 animate-pulse" />
                      <span>{t('status.liveDataActive')}</span>
                    </div>
                    <span className="text-xs">
                      {new Intl.DateTimeFormat(i18n.language || 'en', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      }).format(new Date(currentData.id_timestamp * 1000))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty State when not connected — hidden in new design because
              Web3ConnectionPanel already shows its own centred hero card. */}
          {!deviceId && !useNewDesign && (
            <div className="bg-card rounded-theme border-2 border-border p-6 text-center">
              <div className="w-16 h-16 bg-muted rounded-theme mx-auto mb-4 flex items-center justify-center">
                <img 
                  src={`${isDark ? '/logo.svg' : '/logo.svg'}`}
                  alt="RigWatch Logo" 
                  className="w-8 h-8"
                />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">{t('app.welcome')}</h3>
              <p className="text-muted-foreground mb-4">
                {user?.role === 'pending' 
                  ? t('app.pendingApproval')
                  : t('app.connectDevice')
                }
              </p>
              <p className="text-sm text-muted-foreground">
                {user?.role === 'pending'
                  ? t('app.underReview')
                  : t('app.enterFirebaseId')
                }
              </p>
            </div>
          )}

          {/* Connecting State */}
          {deviceId && connectionStatus === 'connecting' && (
            <div className="bg-card rounded-theme border-2 border-border p-6 text-center">
              <svg className="animate-spin w-8 h-8 text-primary mx-auto mb-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V2C5.373 2 2 5.373 2 10h2zm2 5.291A7.962 7.962 0 014 12H2c0 3.042 1.135 5.824 3 7.938l1-0.647z" />
              </svg>
              <h3 className="text-xl font-semibold text-foreground mb-2">{t('app.connecting')}</h3>
              <p className="text-muted-foreground">
                {t('app.establishing', { id: deviceId })}
              </p>
            </div>
          )}

          {/* Not Found State (overrides offline/empty panels) */}
          {deviceExistence === 'not_found' && (
            <div className="bg-card rounded-theme border-2 border-border p-6 text-center">
              <div className="w-16 h-16 bg-destructive/10 rounded-theme mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">{t('app.deviceNotFoundTitle')}</h3>
              <p className="text-muted-foreground mb-1">
                {t('app.deviceNotFound', { id: deviceId || '' })}
              </p>
              <p className="text-muted-foreground mb-4 text-sm">
                {t('app.deviceNotFoundHint')}
              </p>
            </div>
          )}

          {/* Error State */}
          {deviceId && connectionStatus === 'offline' && deviceExistence !== 'not_found' && (
            <div className="bg-card rounded-theme border-2 border-border p-6 text-center">
              <div className="w-16 h-16 bg-destructive/10 rounded-theme mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-destructive" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">{t('app.connectionFailed')}</h3>
              <p className="text-muted-foreground mb-4">
                {t('app.unableToConnect', { id: deviceId })}
              </p>
              <button
                onClick={() => {
                  if (deviceId) {
                    connect(deviceId);
                  }
                }}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-theme border-b-2 border-primary/80 hover:bg-primary/90"
              >
                {t('app.tryAgain')}
              </button>
            </div>
          )}
        </div>

        <AlarmIndicator onExpandCategory={handleCategoryExpand} />
        
        {/* Parameter Settings Modal */}
        <ParameterSettingsModal
          isOpen={isModalOpen}
          parameter={editingParameter}
          onClose={handleModalClose}
          onSave={handleParameterSave}
        />

        {/* Parameter List Modal */}
        <ParameterListModal
          isOpen={isParameterListOpen}
          onClose={() => setIsParameterListOpen(false)}
          parameters={discoveredParameters}
          availableCategories={availableCategories}
          onUpdateParameter={handleParameterSave}
        />

        {/* Display Configuration Modal */}
        <DisplayConfigurationModal
          isOpen={isDisplayConfigModalOpen}
          onClose={() => setIsDisplayConfigModalOpen(false)}
          parameters={discoveredParameters}
          configurations={displayConfigurations}
          selectedConfigId={selectedDisplayConfigId}
          onSelectConfig={handleSelectDisplayConfig}
          onCreateConfig={handleCreateDisplayConfig}
          onRenameConfig={handleRenameDisplayConfig}
          onDeleteConfig={handleDeleteDisplayConfig}
          onToggleParam={handleToggleDisplayConfigParam}
          onSetAll={handleSetAllDisplayConfigParams}
          onSetSection={handleSetSectionDisplayConfigParams}
        />

        {/* Rig Info Modal */}
        <RigInfoModal
          isOpen={isRigInfoModalOpen}
          onClose={() => setIsRigInfoModalOpen(false)}
        />



        {/* Conditional Admin Panel Rendering */}
        {isMobile ? (
          <MobileAdminPanel
            isOpen={isAdminPanelOpen}
            onClose={() => setIsAdminPanelOpen(false)}
          />
        ) : (
          <AdminPanel
            isOpen={isAdminPanelOpen}
            onClose={() => setIsAdminPanelOpen(false)}
          />
        )}

        {/* Development Debug Panel */}
        {showDebugInfo && (
          <div className="fixed bottom-4 left-4 bg-popover/90 text-popover-foreground p-4 rounded-theme text-xs max-w-sm border-2 border-border shadow-theme-lg">
            <h4 className="font-bold mb-2">Debug Info</h4>
            <div className="space-y-1">
              <p>Device ID: {deviceId || 'None'}</p>
              <p>Status: {connectionStatus}</p>
              <p>Parameters: {discoveredParameters.length}</p>
              <p>Data Keys: {Object.keys(currentData).length}</p>
              <p>Edit Mode: {isEditMode ? 'On' : 'Off'}</p>
              <p>Historical: {isHistoricalMode ? 'On' : 'Off'}</p>
              <p>Search: {searchTerm || 'None'}</p>
              <p>Visible: {discoveredParameters.filter(p => p.visible_on_chart).length}</p>
              <p>In Legend: {discoveredParameters.filter(p => p.show_in_legend).length}</p>
            </div>
          </div>
        )}
        
        {/* Development Debug Info */}
        <DevDebug />

        {/* Global Parameter Search */}
        <GlobalParameterSearch
          isOpen={isSearchOpen}
          onClose={closeSearch}
          parameters={discoveredParameters}
          onParameterSelect={handleParameterSelect}
        />

        {/* App Update Notifier */}
        <AppUpdateNotifier />
        </div>
        </>
  );

  return (
    <TilingProvider>
    <AuthWrapper>
      {/* Dealer route has highest priority */}
      {isDealerRoute ? (
        <DealerModeLayout />
      ) : simplificationMode ? (
        <SimpleModeLayout />
      ) : useNewDesign ? (
        <ShellLayout>
          <ChartRefContext.Provider value={chartContainerRef}>
            {standardContent}
          </ChartRefContext.Provider>
        </ShellLayout>
      ) : (
        // Classic complex interface
        <ChartRefContext.Provider value={chartContainerRef}>
          {standardContent}
        </ChartRefContext.Provider>
      )}
    </AuthWrapper>
    </TilingProvider>
  );
};

export default App;
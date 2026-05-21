import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRigStore } from '../store/useRigStore';
import { useParameterVariants } from '../hooks/useFirebase';
import { useTranslation } from 'react-i18next';
import { startDebugMonitoring } from '../utils/debugExport';
import type { ThemeName } from '../hooks/useTheme';

interface ParameterVariantsPanelProps {
  className?: string;
}

const ParameterVariantsPanel: React.FC<ParameterVariantsPanelProps> = ({ className = '' }) => {
  const deviceId = useRigStore(state => state.deviceId);
  const currentData = useRigStore(state => state.currentData);
  const { t, i18n } = useTranslation();
  const [themeName, setThemeName] = useState<ThemeName>('default');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => {
      const next = (document.documentElement.dataset.theme as ThemeName) || 'default';
      setThemeName(next);
    };
    const observer = new MutationObserver(handler);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    handler();
    return () => observer.disconnect();
  }, []);
  const isNeo = themeName === 'neo-brutalism';
  
  const [selectedVariant, setSelectedVariant] = useState<string>('');
  const [newVariantName, setNewVariantName] = useState<string>('');
  const [availableVariants, setAvailableVariants] = useState<string[]>([]);
  const [variantInfo, setVariantInfo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOverwriting, setIsOverwriting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportData, setExportData] = useState<string>('');
  const [debugMode, setDebugMode] = useState(false);
  const [useTakeparams, setUseTakeparams] = useState(true); // Default to true for fast loading
  
  const discoveredParameters = useRigStore(state => state.discoveredParameters);

  const hasCurrentData = currentData && Object.keys(currentData).length > 0;
  const currentParameterCount = Object.keys(currentData || {}).length;
  
  // Calculate writable parameters count for current status
  const writableParameterCount = useMemo(() => {
    if (!currentData || !discoveredParameters.length) return 0;
    
    return Object.keys(currentData).filter(paramId => {
      const paramInfo = discoveredParameters.find(p => p.originalName === paramId);
      const zugriff = paramInfo?.zugriff;
      return zugriff && zugriff.includes('w');
    }).length;
  }, [currentData, discoveredParameters]);

  const { 
    loadVariantList, 
    getVariantsWithInfo,
    saveVariant, 
    loadVariant, 
    deleteVariant, 
    getVariantInfo, 
    exportVariant 
  } = useParameterVariants() as any;

  // Helper function to get full variant data for debug
  const getVariantData = useCallback(async (variantName: string): Promise<any> => {
    try {
      const { ref, get } = await import('firebase/database');
      const { realtimeDB } = await import('../lib/firebase');
      
      if (!realtimeDB) {
        throw new Error('Database not initialized');
      }

      const variantRef = ref(realtimeDB, `entwicklung/parameter/${variantName}`);
      const snapshot = await get(variantRef);

      if (snapshot.exists()) {
        return snapshot.val();
      }
      return null;
    } catch (error) {
      console.error('[ParameterVariants] Failed to get variant data:', error);
      return null;
    }
  }, []);

  // Load available variants when device connects
  useEffect(() => {
    let cancelled = false;
    if (deviceId) {
      getVariantsWithInfo().then(({ list, infoMap }: { list: string[]; infoMap: Record<string, any> }) => {
        if (cancelled) return;
        setAvailableVariants(list);
        if (!selectedVariant && list.length > 0) {
          setVariantInfo(infoMap[list[0]] || null);
        }
      }).catch(console.error);
    } else {
      setAvailableVariants([]);
      setSelectedVariant('');
      setVariantInfo(null);
    }
    return () => { cancelled = true; };
  }, [deviceId, getVariantsWithInfo]);

  // Load variant info when selection changes
  useEffect(() => {
    let cancelled = false;
    if (selectedVariant && deviceId) {
      // Try fast path via cached batch
      getVariantInfo(selectedVariant).then((info: any) => {
        if (!cancelled) setVariantInfo(info);
      }).catch(console.error);
    } else {
      setVariantInfo(null);
    }
    return () => { cancelled = true; };
  }, [selectedVariant, deviceId, getVariantInfo]);

  const handleLoadVariant = useCallback(async () => {
    if (!selectedVariant || !deviceId) {
      console.warn('[ParameterVariants] No variant selected or no device');
      return;
    }

    setIsLoading(true);
    
    try {
      // Load the variant using selected method
      const success = await loadVariant(selectedVariant, useTakeparams);
      if (success && debugMode) {
        const variantData = await getVariantData(selectedVariant);
        if (variantData) {
          startDebugMonitoring(deviceId, selectedVariant, variantData).catch(error => {
            console.error('[ParameterVariants] Debug monitoring failed:', error);
          });
        }
      }
    } catch (error) {
      console.error('[ParameterVariants] Failed to load variant:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedVariant, deviceId, loadVariant, useTakeparams, debugMode, getVariantData]);

  const handleSaveVariant = useCallback(async () => {
    const trimmedName = newVariantName.trim();
    if (!trimmedName) {
      console.warn('[ParameterVariants] No variant name provided');
      return;
    }

    if (trimmedName.startsWith('~')) {
      console.warn('[ParameterVariants] Invalid variant name (starts with ~)');
      return;
    }

    setIsSaving(true);
    
    try {
      const success = await saveVariant(trimmedName);
      if (success) {
        setNewVariantName('');
        // Refresh variant list
        const variants = await loadVariantList();
        setAvailableVariants(variants);
        setSelectedVariant(trimmedName); // Auto-select the new variant
      }
    } catch (error) {
      console.error('[ParameterVariants] Failed to save variant:', error);
    } finally {
      setIsSaving(false);
    }
  }, [newVariantName, saveVariant, loadVariantList]);

  const handleOverwriteVariant = useCallback(async () => {
    if (!selectedVariant) {
      console.warn('[ParameterVariants] No variant selected for overwriting');
      return;
    }

    const confirmed = window.confirm(t('parameterVariants.overwriteConfirm', { name: selectedVariant }) as string);
    if (!confirmed) {
      return;
    }

    setIsOverwriting(true);
    
    try {
      const success = await saveVariant(selectedVariant);
      if (success) {
        // Refresh variant info
        const info = await getVariantInfo(selectedVariant);
        setVariantInfo(info);
      }
    } catch (error) {
      console.error('[ParameterVariants] Failed to overwrite variant:', error);
    } finally {
      setIsOverwriting(false);
    }
  }, [selectedVariant, saveVariant, getVariantInfo, t]);

  const handleDeleteVariant = useCallback(async () => {
    if (!selectedVariant) {
      console.warn('[ParameterVariants] No variant selected for deletion');
      return;
    }

    const confirmed = window.confirm(t('parameterVariants.deleteConfirm', { name: selectedVariant }) as string);
    if (!confirmed) {
      return;
    }

    try {
      const success = await deleteVariant(selectedVariant);
      if (success) {
        setSelectedVariant('');
        setVariantInfo(null);
        // Refresh variant list
        const variants = await loadVariantList();
        setAvailableVariants(variants);
      }
    } catch (error) {
      console.error('[ParameterVariants] Failed to delete variant:', error);
    }
  }, [selectedVariant, deleteVariant, loadVariantList, t]);

  const handleExportVariant = useCallback(async () => {
    if (!selectedVariant) return;

    try {
      const jsonData = await exportVariant(selectedVariant);
      if (jsonData) {
        setExportData(jsonData);
        setShowExportModal(true);
        // Removed automatic clipboard copying - user can copy manually if needed
      }
    } catch (error) {
      console.error('[ParameterVariants] Failed to export variant:', error);
    }
  }, [selectedVariant, exportVariant]);

  if (!deviceId) {
    return (
      <div className={isNeo ? `rig-section bg-muted border-2 border-border rounded p-3 ${className}` : `rig-section bg-muted/30 border border-border rounded-xl p-3 shadow-theme-sm ${className}`}>
        <h3 className="flex items-center text-foreground mb-3 text-sm font-semibold border-b border-border pb-2">
          <div className={isNeo ? 'w-8 h-8 bg-muted rounded flex items-center justify-center mr-2 border border-border' : 'w-8 h-8 bg-muted rounded-full flex items-center justify-center mr-2 border border-border'}>
          <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14-4H5m14 8H5m14 4H5" />
            </svg>
          </div>
          <span>{t('parameterVariants.title')}</span>
        </h3>
        <div className="rig-section-content">
          <div className={isNeo ? 'bg-card rounded p-4 border border-border' : 'bg-card rounded-xl p-4 border border-border shadow-theme-sm'}>
            <div className="text-center text-muted-foreground">
              <div className={isNeo ? 'w-12 h-12 bg-muted rounded mx-auto mb-2 flex items-center justify-center' : 'w-12 h-12 bg-muted rounded-xl mx-auto mb-2 flex items-center justify-center'}>
                <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground mb-1">{t('parameterVariants.noDevice')}</p>
              <p className="text-xs text-muted-foreground">{t('parameterVariants.connectPrompt')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={isNeo ? `rig-section bg-muted border-2 border-border rounded p-3 ${className}` : `rig-section bg-muted/30 border border-border rounded-xl p-3 shadow-theme-sm ${className}`}>
      <h3 className="flex items-center text-foreground mb-3 text-sm font-semibold border-b border-border pb-2">
        <div className={isNeo ? 'w-8 h-8 bg-muted rounded flex items-center justify-center mr-2 border border-border' : 'w-8 h-8 bg-muted rounded-full flex items-center justify-center mr-2 border border-border'}>
          <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14-4H5m14 8H5m14 4H5" />
          </svg>
        </div>
        <span>{t('parameterVariants.title')}</span>
        <div className="ml-auto text-xs text-muted-foreground">
          {t('parameterVariants.savedCount', { count: availableVariants.length })}
        </div>
      </h3>
      
      <div className="rig-section-content">
        <div className="parameter-variants-container space-y-3">
            
            {/* Current Status - Simplified */}
            <div className={isNeo ? 'bg-card rounded p-2 border-l-2 border-info' : 'bg-card rounded-lg p-2 border-l-2 border-info border border-border'}>
              <div className="text-xs text-info">
                {t('parameterVariants.parametersSummary', { total: currentParameterCount, writable: writableParameterCount })}
              </div>
            </div>

            {/* Variant Selector with Info Panel Layout */}
            <div className="parameter-variants-selector pt-3 border-t border-border">
              <div className="flex items-center gap-1 mb-2">
                <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="text-xs font-medium text-foreground">{t('parameterVariants.selectModel')}</span>
              </div>

              {/* List and Info Panel Side by Side */}
              <div className="flex gap-3">
                {/* Variants List - 60% width */}
                <div className="flex-none w-3/5">
                  <select
                    id="parameter-variants"
                    value={selectedVariant}
                    onChange={(e) => setSelectedVariant(e.target.value)}
                    className={isNeo ? 'w-full h-44 px-2 py-1.5 border border-border rounded text-xs bg-muted text-foreground focus:border-primary focus:ring-1 focus:ring-primary' : 'w-full h-44 px-2 py-1.5 border border-border rounded-lg text-xs bg-muted text-foreground focus:border-primary focus:ring-1 focus:ring-primary'}
                    size={9}
                    disabled={isLoading || availableVariants.length === 0}
                  >
                    <option value="" disabled hidden={availableVariants.length > 0}>
                      {availableVariants.length === 0 ? t('parameterVariants.noneSaved') : ''}
                    </option>
                    {availableVariants.map((variant) => (
                      <option key={variant} value={variant}>
                        {variant}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Variant Info Panel - 40% width */}
                <div className="flex-1">
                  {selectedVariant ? (
                    <div className="h-44 bg-card rounded-md p-2 border border-border overflow-y-auto">
                      <div className="text-[10px] text-muted-foreground">
                        <div className="font-medium text-foreground mb-2 text-center border-b border-border pb-1">
                          {selectedVariant}
                        </div>
                        {variantInfo ? (
                          // New model with metadata
                          <div className="space-y-1.5">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t('parameterVariants.created')}:</span>
                              <span className="font-medium text-foreground">{new Date(variantInfo.created_at).toLocaleDateString(i18n.language)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t('parameterVariants.device')}:</span>
                              <span className="font-medium text-foreground">{variantInfo.device_model}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Version:</span>
                              <span className="font-medium text-foreground">v{variantInfo.device_version}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Parameters:</span>
                              <span className="font-medium text-foreground">{variantInfo.writable_parameters_saved || variantInfo.parameter_count || 0}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Settings:</span>
                              <span className="font-medium text-foreground">{variantInfo.settings_count || 0}</span>
                            </div>
                            {variantInfo.total_parameters_available && (
                              <div className="text-xs opacity-75 text-center pt-1 border-t border-border text-muted-foreground">
                                {t('parameterVariants.totalAvailable', { count: variantInfo.total_parameters_available })}
                              </div>
                            )}
                          </div>
                        ) : (
                          // Old model without metadata
                          <div className="space-y-1.5 text-center">
                            <div className="text-warning font-medium">{t('parameterVariants.legacy')}</div>
                            <div className="text-xs opacity-75 text-muted-foreground">{t('parameterVariants.legacyOnly')}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="h-44 bg-muted rounded-md border-2 border-dashed border-border flex items-center justify-center">
                      <div className="text-[10px] text-muted-foreground text-center">
                        <div className="w-6 h-6 bg-card border border-border rounded mx-auto mb-1 flex items-center justify-center">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        Select a model<br/>to view details
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Controls */}
            <div className="parameter-variants-controls space-y-3 pt-3 border-t border-border">
              {/* Primary Actions - Main buttons for selected variant */}
              {selectedVariant && (
                <div className={isNeo ? 'bg-card rounded p-3 border-l-2 border-info/60 border border-border' : 'bg-card rounded-lg p-3 border-l-2 border-info border border-border shadow-theme-xs'}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1">
                      <svg className="w-3 h-3 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="text-xs font-medium text-info">Model Actions</span>
                    </div>
                    
                    {/* Fast Load & Debug Toggles */}
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useTakeparams}
                          onChange={(e) => setUseTakeparams(e.target.checked)}
                          className={isNeo ? 'w-3 h-3 text-success bg-muted border-border rounded focus:ring-2 focus:ring-success' : 'w-3 h-3 text-success bg-muted border-border rounded focus:ring-success focus:ring-2'}
                        />
                        <span className="text-xs text-success font-medium">Schnell Laden (takeparams)</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={debugMode}
                          onChange={(e) => setDebugMode(e.target.checked)}
                          className={isNeo ? 'w-3 h-3 text-info bg-muted border-border rounded focus:ring-2 focus:ring-info' : 'w-3 h-3 text-info bg-muted border-border rounded focus:ring-info focus:ring-2'}
                        />
                        <span className="text-xs text-info font-medium">Debug</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      onClick={handleLoadVariant}
                      disabled={isLoading}
                      className={isNeo ? 'px-2 py-1.5 bg-primary text-primary-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center' : 'px-2 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center shadow-theme-xs'}
                    >
                      {isLoading ? (
                        <>
                          <svg className="animate-spin w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          {t('parameterVariants.loadingModel')}
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Load
                        </>
                      )}
                    </button>
                    
                    <button
                      onClick={handleOverwriteVariant}
                      disabled={isOverwriting || !hasCurrentData || writableParameterCount === 0}
                      className={isNeo ? 'px-2 py-1.5 bg-warning text-warning-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center' : 'px-2 py-1.5 bg-warning text-warning-foreground rounded-lg hover:bg-warning/80 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center shadow-theme-xs'}
                      title={writableParameterCount === 0 ? (t('parameterVariants.noWritableTitle') as string) : (t('parameterVariants.overwriteHint') as string)}
                    >
                      {isOverwriting ? (
                        <>
                          <svg className="animate-spin w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          {t('parameterVariants.overwriting')}
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                          </svg>
                          {t('parameterVariants.overwrite')}
                        </>
                      )}
                    </button>
                  </div>

                  {/* Secondary Actions */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleExportVariant}
                      className={isNeo ? 'px-2 py-1.5 bg-muted text-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95 text-xs font-medium flex items-center justify-center' : 'px-2 py-1.5 bg-muted text-foreground rounded-lg hover:bg-accent text-xs font-medium flex items-center justify-center border border-border shadow-theme-xs'}
                    >
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      {t('parameterVariants.export')}
                    </button>
                    <button
                      onClick={handleDeleteVariant}
                      className={isNeo ? 'px-2 py-1.5 bg-destructive text-destructive-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95 text-xs font-medium flex items-center justify-center' : 'px-2 py-1.5 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/80 text-xs font-medium flex items-center justify-center shadow-theme-xs'}
                    >
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      {t('parameterVariants.delete')}
                    </button>
                  </div>
                </div>
              )}

              {/* Divider before Save Section */}
              <div className="border-t border-border my-3"></div>

              {/* Save New Model */}
              <div className={isNeo ? 'parameter-save-container bg-card rounded p-3 border-l-2 border-success/60 border border-border' : 'parameter-save-container bg-card rounded-lg p-3 border-l-2 border-success border border-border shadow-theme-xs'}>
                <div className="flex items-center gap-1 mb-2">
                  <svg className="w-3 h-3 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span className="text-xs font-medium text-success">{t('parameterVariants.saveAsNew')}</span>
                </div>
                
                {writableParameterCount === 0 && hasCurrentData && (
                  <div className={isNeo ? 'text-xs text-warning bg-muted border-l-2 border-warning/60 rounded p-2 mb-2' : 'text-xs text-warning bg-muted border-l-2 border-warning rounded p-2 mb-2'}>
                    {t('parameterVariants.noWritableHint')}
                  </div>
                )}
                
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newVariantName}
                    onChange={(e) => setNewVariantName(e.target.value)}
                    placeholder={t('parameterVariants.newNamePlaceholder') as string}
                    className={isNeo ? 'flex-1 px-2 py-1.5 border border-border rounded text-xs bg-card text-foreground placeholder-muted-foreground focus:border-success focus:ring-1 focus:ring-success' : 'flex-1 px-2 py-1.5 border border-border rounded-lg text-xs bg-card text-foreground placeholder-muted-foreground focus:border-success focus:ring-1 focus:ring-success'}
                    disabled={isSaving || !hasCurrentData || writableParameterCount === 0}
                  />
                  <button
                    onClick={handleSaveVariant}
                    disabled={!newVariantName.trim() || isSaving || !hasCurrentData || writableParameterCount === 0}
                    className={isNeo ? 'px-2 py-1.5 bg-success text-success-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center whitespace-nowrap' : 'px-2 py-1.5 bg-success text-success-foreground rounded-lg hover:bg-success/80 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center whitespace-nowrap shadow-theme-xs'}
                    title={writableParameterCount === 0 ? (t('parameterVariants.noWritableTitle') as string) : ''}
                  >
                    {isSaving ? (
                      <>
                        <svg className="animate-spin w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {t('parameterVariants.savingModel')}
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                        Save
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowExportModal(false)}>
          <div className={isNeo ? 'bg-card rounded p-6 max-w-2xl w-full mx-4 max-h-96 overflow-hidden border-2 border-border shadow-theme-lg' : 'bg-card rounded-xl p-6 max-w-2xl w-full mx-4 max-h-96 overflow-hidden border border-border shadow-theme-lg'} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-semibold text-foreground">{t('parameterVariants.exportTitle')}</h4>
              <button
                onClick={() => setShowExportModal(false)}
                className={isNeo ? 'text-muted-foreground hover:text-destructive' : 'text-muted-foreground hover:text-foreground'}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-muted-foreground mb-2">
                {t('parameterVariants.exportHint')}
              </p>
              <textarea
                value={exportData}
                readOnly
                className="w-full h-48 px-3 py-2 border border-border rounded-md text-xs font-mono bg-muted text-foreground resize-none"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowExportModal(false)}
                className={isNeo ? 'px-4 py-2 bg-primary text-primary-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95 text-sm' : 'px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/80 text-sm shadow-theme-xs'}
              >
                {t('actions.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ParameterVariantsPanel; 
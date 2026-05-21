import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ThemeName } from '../hooks/useTheme';
import HistoricalDataPanel from './HistoricalDataPanel';
import ParameterVariantsPanel from './ParameterVariantsPanel';
import RigEventLog from './web3/RigEventLog';
import { useRigStore } from '../store/useRigStore';
import { useRigModel } from '../hooks/useFirebase';
import { useRigComment } from '../hooks/useRigComment';
import { useTranslation } from 'react-i18next';
import { formatDateWithUserTimezone } from '../utils/timezone';

import { useAuth } from '../hooks/useAuth';
import { useLocalSettings } from '../hooks/useLocalSettings';

interface RigManagementPanelProps {
  onFirmwareUpdate: (force?: boolean) => void;
  onCheckForUpdates?: () => void;
  onLoadHistoricalDataToChart?: (historicalData: any, timestamp: string) => void;
  onShowRigInfo?: () => void;
  className?: string;
}

const RigManagementPanel: React.FC<RigManagementPanelProps> = ({
  onFirmwareUpdate,
  onCheckForUpdates,
  onLoadHistoricalDataToChart,
  onShowRigInfo,
  className = ''
}) => {
  const deviceId = useRigStore(state => state.deviceId);
  const connectionStatus = useRigStore(state => state.connectionStatus);
  const deviceMetadata = useRigStore(state => state.deviceMetadata);
  const deviceConfig = useRigStore(state => state.deviceConfig);
  const showDebugInfo = useRigStore(state => state.showDebugInfo);
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const { getUserPreferences } = useLocalSettings();
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    if (typeof document === 'undefined') return 'default';
    return (document.documentElement.dataset.theme as ThemeName) || 'default';
  });
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

  const { getRigModelName, getRigModelData, cachedModelName, cachedModelData } = useRigModel();
  const { comment: rigComment, hasComment } = useRigComment();

  
  const [rigModelName, setRigModelName] = useState<string>('-');
  const [rigModelData, setRigModelData] = useState<any>(null);
  const [alternativeUpdateFile, setAlternativeUpdateFile] = useState<string>('');
  const [isAlternativeUpdating, setIsAlternativeUpdating] = useState(false);
  const [, setSimplificationMode] = useState<boolean>(false);

  // Initialize and subscribe to simplification mode preference
  useEffect(() => {
    const applyFromPrefs = () => {
      try {
        const prefs = getUserPreferences();
        setSimplificationMode(!!prefs.simplificationMode);
      } catch (e) {}
    };
    applyFromPrefs();
    const handler = (e: any) => {
      const newValue = e?.detail?.simplificationMode;
      if (newValue === true || newValue === false) {
        setSimplificationMode(newValue);
      } else {
        applyFromPrefs();
      }
    };
    window.addEventListener('userPreferencesChanged', handler as EventListener);
    return () => {
      window.removeEventListener('userPreferencesChanged', handler as EventListener);
    };
  }, [getUserPreferences]);

  // Alternative update function
  const handleAlternativeUpdate = useCallback(async () => {
    const trimmedFileName = alternativeUpdateFile.trim();
    if (!trimmedFileName) {
      console.warn('[RigManagement] No update filename provided');
      return;
    }

    if (!deviceId) {
      console.error('[RigManagement] No device connected');
      return;
    }

    setIsAlternativeUpdating(true);
    
    try {
      const { queueCommand } = await import('../utils/commandQueue');
      
      const updateCommand = `update ${trimmedFileName}`;
      await queueCommand(deviceId, updateCommand);
      
      // Clear the input field after successful send
      setAlternativeUpdateFile('');
      
    } catch (error) {
      console.error('[RigManagement] Failed to send alternative update command:', error);
    } finally {
      setIsAlternativeUpdating(false);
    }
  }, [deviceId, alternativeUpdateFile]);

  const handleSearchFirebaseNodes = useCallback(async () => {
    if (!deviceId) return;
    
    try {
      const { ref, get } = await import('firebase/database');
      const { realtimeDB } = await import('../lib/firebase');
      
      if (!realtimeDB) {
        console.error('[RigManagement] Firebase not initialized');
        return;
      }
      
      const nodesToCheck = ['temporaer', 'konstant', 'konstant_app', 'entwicklung', 'historien'];
      
      for (const nodeName of nodesToCheck) {
        try {
          const nodeRef = ref(realtimeDB, `${nodeName}/${deviceId}`);
          const snapshot = await get(nodeRef);
          
          if (snapshot.exists()) {
            const data = snapshot.val();
            const searchInObject = (obj: any, path = '') => {
              Object.entries(obj || {}).forEach(([key, value]) => {
                const fullPath = path ? `${path}.${key}` : key;
                if (typeof value === 'object' && value !== null) {
                  searchInObject(value, fullPath);
                }
              });
            };
            searchInObject(data);
          }
        } catch (error) {
          console.error(`[RigManagement] Error checking ${nodeName}:`, error);
        }
      }
      
    } catch (error) {
      console.error('[RigManagement] Firebase search error:', error);
    }
  }, [deviceId]);

  const handleTestRigModel = useCallback(async () => {
    await getRigModelName();
  }, [getRigModelName]);

  // Inline editing for versu / verst
  const [editingField, setEditingField] = useState<'versu' | 'verst' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSavingField, setIsSavingField] = useState(false);
  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const startEdit = useCallback((field: 'versu' | 'verst', currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue === '—' ? '' : currentValue);
    setTimeout(() => editInputRef.current?.focus(), 50);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!deviceId || !editingField) return;
    setIsSavingField(true);
    try {
      const { ref, update } = await import('firebase/database');
      const { realtimeDB } = await import('../lib/firebase');
      if (!realtimeDB) return;
      await update(ref(realtimeDB, `konstant_app/${deviceId}`), { [editingField]: editValue.trim() });
      setEditingField(null);
      setEditValue('');
    } catch (e) {
      console.error('[RigManagement] Failed to save field:', e);
    } finally {
      setIsSavingField(false);
    }
  }, [deviceId, editingField, editValue]);

  // Derived rig information for UI (Subversion, letzte Anmeldung, Online Status)
  const versionVariantRaw = (deviceMetadata as any)?.versu;
  const versionVariant =
    typeof versionVariantRaw === 'string'
      ? versionVariantRaw.trim() || '—'
      : versionVariantRaw != null
      ? String(versionVariantRaw).trim() || '—'
      : '—';

  const lastLoginTs =
    deviceMetadata && typeof (deviceMetadata as any).tsfc === 'number'
      ? (deviceMetadata as any).tsfc
      : undefined;

  const lastLoginStr = lastLoginTs
    ? formatDateWithUserTimezone(lastLoginTs * 1000, i18n.language || 'de', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const onlineStatusLabel =
    connectionStatus === 'online'
      ? t('rigInfo.statusOnline')
      : connectionStatus === 'offline'
      ? t('rigInfo.statusOffline')
      : t('rigInfo.statusUnknown');

  // Update rig model only when article number or cache changes
  useEffect(() => {
    // Always prefer cached values (instant)
    if (cachedModelName && cachedModelName !== 'Unknown Model') {
      setRigModelName(cachedModelName);
    }
    if (cachedModelData) {
      setRigModelData(cachedModelData);
    }

    // If cache is missing, fetch once
    if ((!cachedModelName || cachedModelName === 'Unknown Model') || !cachedModelData) {
      let cancelled = false;
      (async () => {
        const [modelName, modelData] = await Promise.all([
          getRigModelName(),
          getRigModelData()
        ]);
        if (!cancelled) {
          setRigModelName(modelName || '-');
          setRigModelData(modelData);
        }
      })();
      return () => { cancelled = true; };
    }
  }, [deviceMetadata.a, cachedModelName, cachedModelData, getRigModelName, getRigModelData]);

  if (!deviceId || connectionStatus !== 'online') {
    return (
      <div className={`bg-card rounded-xl border border-border p-4 shadow-theme-sm ${className}`}>
        <h2 className="text-lg font-bold text-foreground mb-3 flex items-center">
          <svg className="w-5 h-5 mr-2 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" />
          </svg>
          {t('rig.panelTitle')}
        </h2>
        
        <div className="text-center text-muted-foreground py-8">
          <div className="w-12 h-12 bg-muted rounded-xl mx-auto mb-3 flex items-center justify-center">
            <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">{t('rig.connectPrompt')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-card rounded-xl border border-border overflow-hidden shadow-theme-sm ${className}`}>
      {/* Clean minimalist header */}
      <div className="bg-section-header text-section-header-foreground px-3 py-2">
        <h2 className="text-sm font-semibold flex items-center">
          {/* Simple clean icon */}
            <div className="w-4 h-4 mr-2 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" />
              </svg>
            </div>
          <span>{t('rig.panelTitle')}</span>
        </h2>
      </div>
      
      <div className="p-3">
        {/* On 13"-class laptops (lg breakpoint = 1024–1535 px) the 3-col grid
            squeezed each card down to ~330 px — too narrow for the firmware
            block. We now show 2 columns on those laptops and only switch to
            3 columns on real desktop monitors (2xl ≥ 1536 px). */}
        <div className="rig-management-grid grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
          {/* Rig Info Section */}
          <div
            className="rig-section bg-muted/30 border border-border rounded-xl p-3 shadow-theme-sm"
          >
            <h3
              className={
                isNeo
                  ? 'flex items-center text-foreground mb-3 text-sm font-semibold border-b border-border pb-2'
                  : 'flex items-center text-foreground mb-3 text-sm font-semibold border-b border-border pb-2'
              }
            >
              <div
                className={
                  isNeo
                    ? 'w-7 h-7 bg-info/10 rounded-full flex items-center justify-center mr-2'
                    : 'w-7 h-7 bg-info/10 rounded-full flex items-center justify-center mr-2'
                }
              >
              <svg
                className="w-4 h-4 text-info"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" />
              </svg>
              </div>
              <span>{t('rig.info')}</span>
            </h3>

            {/* Enhanced Model Info Block.
                The outer "rig-section" already provides a border + shadow,
                so this inner card was double-fencing the content. Drop the
                border/shadow here — only the rounded background remains as
                a subtle group surface. */}
            <div
              className={
                isNeo
                  ? 'bg-card rounded-xl p-3 mb-3'
                  : 'bg-card rounded-xl p-3 mb-3'
              }
            >
              <div className="flex flex-col sm:flex-row gap-3">
                {rigModelData?.img_url && (
                  <div className="flex-shrink-0">
                    <div className="relative">
                      <img
                        src={rigModelData.img_url}
                        alt={rigModelData?.name || 'Rig'}
                        className={
                          isNeo
                            ? 'w-20 h-20 object-contain rounded-xl border border-border bg-card shadow-theme-xs'
                            : 'w-20 h-20 object-contain rounded-xl border border-border bg-card shadow-theme-xs'
                        }
                      />
                    </div>
                  </div>
                )}

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4
                        className={
                          isNeo
                            ? 'text-lg font-bold text-foreground leading-tight cursor-default'
                            : 'text-lg font-bold text-foreground leading-tight cursor-default'
                        }
                        title={hasComment ? rigComment : undefined}
                      >
                        {rigModelData?.name || rigModelName || t('rig.unknown')}
                        {hasComment && (
                          <span className="ml-2 inline-flex items-center">
                            <svg className="w-4 h-4 text-info" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                            </svg>
                          </span>
                        )}
                      </h4>

                      {(rigModelData?.article_number || rigModelData?.software_id) && (
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {rigModelData?.article_number && (
                            <span className="text-xs bg-info/10 text-info px-2 py-1 rounded font-medium">
                              #{rigModelData.article_number}
                            </span>
                          )}
                          {rigModelData?.software_id && (
                            <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">
                              {t('rig.softwareId', { id: rigModelData.software_id })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick info rows. Tinted background already separates
                      the block from the surrounding card; the previous
                      border was a third frame in the same column. */}
                  <div className="flex flex-col text-[11px] gap-1.5 bg-muted/40 rounded-lg p-2">
                    {/* Subversion — editable */}
                    <div className="group flex justify-between items-center gap-2">
                      <span className="text-muted-foreground shrink-0">Subversion:</span>
                      {editingField === 'versu' ? (
                        <div className="flex items-center gap-1 flex-1 justify-end">
                          <input
                            ref={editInputRef as React.RefObject<HTMLInputElement>}
                            type="text"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            disabled={isSavingField}
                            className="w-28 px-1.5 py-0.5 rounded border text-[11px] focus:outline-none focus:ring-1 bg-card border-border text-foreground focus:ring-ring"
                          />
                          <button onClick={saveEdit} disabled={isSavingField} className="text-success hover:opacity-80 disabled:opacity-40" title="Save">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button onClick={cancelEdit} disabled={isSavingField} className="text-muted-foreground hover:opacity-80 disabled:opacity-40" title="Cancel">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-foreground font-medium">{versionVariant}</span>
                          <button
                            onClick={() => startEdit('versu', versionVariant)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                            title="Edit"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Version — editable */}
                    <div className="group flex items-start gap-2 min-w-0">
                      <span className="text-muted-foreground shrink-0">Version:</span>
                      {editingField === 'verst' ? (
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          <textarea
                            ref={editInputRef as React.RefObject<HTMLTextAreaElement>}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter' && e.ctrlKey) saveEdit(); }}
                            disabled={isSavingField}
                            rows={3}
                            className="w-full px-1.5 py-0.5 rounded border text-[11px] resize-y focus:outline-none focus:ring-1 bg-card border-border text-foreground focus:ring-ring"
                          />
                          <div className="flex items-center gap-1">
                            <button onClick={saveEdit} disabled={isSavingField} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-white transition-colors disabled:opacity-40 bg-primary hover:bg-primary/80">
                              {isSavingField ? '...' : '✓ Save'}
                            </button>
                            <button onClick={cancelEdit} disabled={isSavingField} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors disabled:opacity-40 bg-muted text-muted-foreground hover:bg-muted/80">
                              ✗ Cancel
                            </button>
                            <span className="text-[10px] text-muted-foreground ml-1">Ctrl+Enter</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1 min-w-0 flex-1">
                          <span
                            className="text-foreground font-medium whitespace-normal break-words leading-snug min-w-0"
                            title={(deviceMetadata as any).verst || t('rig.unknown')}
                          >
                            {(deviceMetadata as any).verst || t('rig.unknown')}
                          </span>
                          <button
                            onClick={() => startEdit('verst', (deviceMetadata as any).verst || '')}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                            title="Edit"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Last Login:</span>
                      <span className="text-foreground font-medium">{lastLoginStr}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Online Status:</span>
                      <span className="text-foreground font-medium">{onlineStatusLabel}</span>
                    </div>
                  </div>

                  {!rigModelData && (
                    <p className="text-xs text-muted-foreground">{t('rig.modelInfoUnavailable')}</p>
                  )}

                  {/* Quick Actions */}
                  <div className="flex flex-wrap gap-2">
                    {rigModelData?.technical_data_url && (
                      <a
                        href={rigModelData.technical_data_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-info/10 hover:bg-info/20 text-info rounded-md transition-colors touch-manipulation"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {t('rig.technicalData')}
                      </a>
                    )}
                    {rigModelData?.replacement_instructions_url && (
                      <a
                        href={rigModelData.replacement_instructions_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-success/10 hover:bg-success/20 text-success rounded-md transition-colors touch-manipulation"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        {t('rig.manual')}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Always available Info button */}
            <div className="mb-3">
              <button
                onClick={onShowRigInfo}
                className={
                  isNeo
                    ? 'w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm bg-info/10 hover:bg-info/20 text-info rounded-xl transition-colors border border-info/30 font-medium shadow-theme-xs'
                    : 'w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm bg-info/10 hover:bg-info/20 text-info rounded-xl transition-colors border border-info/30 font-medium shadow-theme-xs'
                }
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('rig.rigInfoButton')}
              </button>
            </div>

            {/* AI Analysis moved to RigInfoModal for better integration */}

            <div className="rig-section-content">
              <div className="info-grid space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="info-item bg-card border border-border p-2.5 rounded-lg text-xs shadow-theme-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <svg className="w-3 h-3 text-info" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z" />
                          </svg>
                          <span className="font-medium text-muted-foreground">
                            {t('rig.parameterSet')}
                          </span>
                        </div>
                        <span className="font-semibold text-foreground">
                          {deviceConfig.verz === '~' || !deviceConfig.verz ? t('rig.default') : deviceConfig.verz}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="info-item bg-card border border-border p-2.5 rounded-lg text-xs shadow-theme-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                          <svg className="w-3 h-3 text-success" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13 7H7v6h6V7z" />
                            <path fillRule="evenodd" d="M7 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1h2a2 2 0 012 2v2h1a1 1 0 110 2h-1v2h1a1 1 0 110 2h-1v2a2 2 0 01-2 2h-2v1a1 1 0 11-2 0v-1H9v1a1 1 0 11-2 0v-1H5a2 2 0 01-2-2v-2H2a1 1 0 110-2h1V9H2a1 1 0 010-2h1V5a2 2 0 012-2h2V2a1 1 0 012 0v1h2V2zM5 5h10v10H5V5z" clipRule="evenodd" />
                          </svg>
                          <span className="font-medium text-muted-foreground">
                            {t('rig.firmwareVersion')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {deviceMetadata.vers || t('rig.unknown')}
                          </span>
                          {deviceMetadata.v && (
                            <span className="px-2 py-0.5 bg-warning/10 text-warning rounded text-xs font-medium">
                              {t('rig.updateAvailable')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Debug Tools - Only visible when showDebugInfo is enabled */}
                  {showDebugInfo && (
                    <div className="info-item bg-card border border-border p-2.5 rounded-lg text-xs transition-all duration-200 hover:shadow-theme-sm sm:col-span-2">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-1 mb-1">
                            <svg className="w-3 h-3 text-info" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                            </svg>
                            <span className="font-medium text-muted-foreground">
                              {t('rig.debugTools')}
                            </span>
                          </div>
                          <div className="flex gap-1 sm:gap-2 flex-wrap">
                            <button
                              onClick={handleTestRigModel}
                              className="px-2 py-1.5 text-xs bg-info/10 hover:bg-info/20 text-info rounded transition-colors touch-manipulation"
                              title={t('rig.testModelTitle') as string}
                            >
                              🧪 {t('rig.testModel')}
                            </button>
                            <button
                              onClick={handleSearchFirebaseNodes}
                              className="px-2 py-1.5 text-xs bg-success/10 hover:bg-success/20 text-success rounded transition-colors touch-manipulation"
                            >
                              🔍 {t('rig.searchNodes')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Device Controls - Always send data checkbox hidden (set automatically) */}
                <div className="space-y-2 pt-2 border-t border-border">
                  {/* Always send data checkbox hidden - handled automatically */}

                  {/* Firmware Update - Always visible with enhanced styling */}
                  <div className="space-y-2">
                    {/* Unified status indicator: show exactly one state */}
                    {deviceMetadata.f !== undefined && deviceMetadata.f > 0 && deviceMetadata.f < 100 ? (
                      <div className="px-3 py-2 bg-info/10 text-info rounded-lg text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{t('rig.updatingFirmware')}</span>
                          <span className="font-bold">{deviceMetadata.f}%</span>
                        </div>
                        <div className="w-full bg-info/20 rounded h-1.5">
                          <div 
                            className="bg-info h-1.5 rounded" 
                            style={{ width: `${deviceMetadata.f}%` }}
                          ></div>
                        </div>
                      </div>
                    ) : deviceMetadata.v ? (
                      // The tinted background already conveys the warning
                      // colour; the additional 1-px border just added noise
                      // alongside the ~6 other framed elements in the column.
                      <div className="px-3 py-2 bg-warning/10 text-warning text-xs rounded-lg flex items-center">
                        <svg className="w-4 h-4 mr-2 text-warning" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.667-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">{t('rig.updateAvailable')}</span>
                      </div>
                    ) : (
                      <div className="px-3 py-2 bg-success/10 text-success rounded-lg text-xs flex items-center">
                        <svg className="w-4 h-4 mr-2 text-success" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">
                          {t('rig.upToDate')}
                        </span>
                      </div>
                    )}
                    
                    {/* Compact update controls — primary action becomes a
                        small button; secondary (force / alternative) tuck
                        into a chevron-expandable section so the panel
                        stops feeling button-heavy. */}
                    <div className="space-y-2">
                      {deviceMetadata.v ? (
                        <button
                          onClick={() => hasPermission('rigs.check_updates') && onFirmwareUpdate(false)}
                          disabled={!hasPermission('rigs.check_updates')}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-xs font-medium transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          {t('rig.installUpdate')}
                        </button>
                      ) : (
                        hasPermission('rigs.check_updates') && (
                          <button
                            onClick={() => onCheckForUpdates?.()}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-success/30 bg-success/10 text-success hover:bg-success/15 text-xs font-medium transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {t('rig.checkUpdates')}
                          </button>
                        )
                      )}

                      {(hasPermission('rigs.force_update') || hasPermission('rigs.alternative_update')) && (
                        <details className="rounded-md border border-border/60 bg-card/40 overflow-hidden group">
                          <summary className="cursor-pointer list-none px-3 py-1.5 flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                            <span className="inline-flex items-center gap-1.5">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                              </svg>
                              <span>Advanced firmware actions</span>
                            </span>
                            <span className="text-[8px] transition-transform group-open:rotate-180">▾</span>
                          </summary>

                          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/40">
                            {hasPermission('rigs.force_update') && (
                              <button
                                onClick={() => onFirmwareUpdate(true)}
                                className="w-full inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 text-[11px] font-medium transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                {t('rig.forceUpdate')}
                              </button>
                            )}

                            {hasPermission('rigs.alternative_update') && (
                              <div className="flex gap-1.5">
                                <input
                                  type="text"
                                  value={alternativeUpdateFile}
                                  onChange={(e) => setAlternativeUpdateFile(e.target.value)}
                                  placeholder={t('rig.updateFilenamePlaceholder') as string}
                                  className="flex-1 px-2 py-1 rounded-md border border-border bg-card text-[11px] text-foreground placeholder-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/40 transition-colors"
                                  disabled={isAlternativeUpdating}
                                />
                                <button
                                  onClick={() => handleAlternativeUpdate()}
                                  disabled={!alternativeUpdateFile.trim() || isAlternativeUpdating}
                                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-info/30 bg-info/10 text-info hover:bg-info/15 disabled:opacity-50 text-[11px] font-medium transition-colors"
                                >
                                  {isAlternativeUpdating ? (
                                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                  ) : t('rig.update')}
                                </button>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Event Log — replaces the legacy historical timestamp picker with
              a mining-flavoured event timeline (firmware rollouts, pool
              switches, thermal alerts, share rejection spikes, etc.). */}
          <div className="rounded-2xl bg-card border border-border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 rounded-md bg-primary/15 items-center justify-center">
                  <svg className="h-3.5 w-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
                <div>
                  <div className="text-sm font-semibold text-foreground">Event Log</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Last 14 days · controller emit
                  </div>
                </div>
              </div>
              <span className="pill pill-online">
                <span className="dot dot-online" />
                live
              </span>
            </div>
            <RigEventLog />
          </div>

          {/* Legacy timestamp selector — gated to developers in case raw
              historical bucket loading is still needed for debugging. */}
          {hasPermission('rigs.models_manage') && (
            <details className="rounded-xl bg-card/40 border border-border/60 overflow-hidden">
              <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Raw historical buckets (dev)
              </summary>
              <div className="px-4 pb-4">
                <HistoricalDataPanel className="" onLoadHistoricalDataToChart={onLoadHistoricalDataToChart} />
              </div>
            </details>
          )}

          {/* Rig Models Section (advanced) — legacy parameter-snapshot panel,
              gated to developer mode. The fleet-by-model breakdown lives in
              FleetInventoryPanel on the pre-connect screen. */}
          {hasPermission('rigs.models_manage') && (
            <details className="rounded-xl bg-card/40 border border-border/60 overflow-hidden">
              <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Parameter snapshots (dev)
              </summary>
              <div className="px-4 pb-4">
                <ParameterVariantsPanel className="" />
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
};

export default RigManagementPanel; 
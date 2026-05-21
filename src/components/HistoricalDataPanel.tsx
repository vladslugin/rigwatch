import React, { useState, useEffect, useCallback, useContext } from 'react';
import { useRigStore } from '../store/useRigStore';
import { useHistoricalData } from '../hooks/useFirebase';
import { ChartRefContext } from '../context/ChartRefContext';
import type { ChartDivElement } from '../context/ChartRefContext';
import { useTranslation } from 'react-i18next';
import { formatHistoricalDateWithUserTimezone } from '../utils/timezone';
import { useTimezoneRefresh } from '../hooks/useTimezoneRefresh';
import TimezoneSettingsModal from './TimezoneSettingsModal';
import type { ThemeName } from '../hooks/useTheme';

interface HistoricalDataPanelProps {
  className?: string;
  onLoadHistoricalDataToChart?: (historicalData: any, timestamp: string) => void;
}

// MAGIC: list size is fixed for consistent scroll UX in the selector
const HISTORICAL_SELECT_SIZE = 10;

const getSectionClassName = (isNeo: boolean, className: string) =>
  isNeo
    ? `rig-section bg-muted border-2 border-border rounded p-3 ${className}`
    : `rig-section bg-muted/30 border border-border rounded-xl p-3 shadow-theme-sm ${className}`;

const getHeaderClassName = (isNeo: boolean) =>
  isNeo
    ? 'flex items-center justify-between text-foreground mb-3 text-sm font-semibold border-b border-border pb-2'
    : 'flex items-center justify-between text-foreground mb-3 text-sm font-semibold border-b border-border pb-2';

const getIconWrapperClassName = (isNeo: boolean) =>
  isNeo
    ? 'w-8 h-8 bg-info/10 rounded flex items-center justify-center mr-2'
    : 'w-8 h-8 bg-info/10 rounded-full flex items-center justify-center mr-2';

const getIconClassName = (isNeo: boolean) =>
  isNeo ? 'w-4 h-4 text-info' : 'w-4 h-4 text-info';

const getTimezoneButtonClassName = (isNeo: boolean) =>
  isNeo
    ? 'w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded'
    : 'w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg';

const getContentCardClassName = (isNeo: boolean) =>
  isNeo
    ? 'bg-card rounded p-3 border border-border'
    : 'bg-card rounded-xl p-3 border border-border shadow-theme-sm';

const HistoricalDataPanel: React.FC<HistoricalDataPanelProps> = ({ className = '', onLoadHistoricalDataToChart }) => {
  const deviceId = useRigStore(state => state.deviceId);
  const isHistoricalMode = useRigStore(state => state.isHistoricalMode);
  const setHistoricalMode = useRigStore(state => state.setHistoricalMode);
  const historicalTimestamps = useRigStore(state => state.historicalTimestamps);
  const chartRef = useContext(ChartRefContext);
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
  
  const [selectedTimestamp, setSelectedTimestamp] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasLoadedTimestamps, setHasLoadedTimestamps] = useState(false);
  const [showTimezoneSettings, setShowTimezoneSettings] = useState(false);
  
  const { loadHistoricalTimestamps, loadHistoricalData, deleteHistoricalData, clearHistoricalMode } = useHistoricalData();
  const timezoneRefreshKey = useTimezoneRefresh();
  const handleOpenTimezoneSettings = () => setShowTimezoneSettings(true);

  // Load available timestamps when device connects - FIXED: no infinite loop
  useEffect(() => {
    if (deviceId && !isHistoricalMode && !hasLoadedTimestamps) {
      setHasLoadedTimestamps(true);
      (loadHistoricalTimestamps as any)(deviceId).catch(() => setHasLoadedTimestamps(false));
    }
  }, [deviceId, isHistoricalMode, hasLoadedTimestamps, loadHistoricalTimestamps]);

  // Reset when device changes
  useEffect(() => {
    if (!deviceId) {
      setHasLoadedTimestamps(false);
      setSelectedTimestamp('');
    }
  }, [deviceId]);

  // Auto-select first timestamp when they load
  useEffect(() => {
    if (historicalTimestamps.length > 0 && !selectedTimestamp) {
      setSelectedTimestamp(historicalTimestamps[0]);
    }
  }, [historicalTimestamps, selectedTimestamp]);

  const handleLoadHistoricalData = useCallback(async () => {
    if (!selectedTimestamp) {
      console.warn('[HistoricalData] No timestamp selected');
      return;
    }

    console.log('[HistoricalData] Loading historical data for timestamp:', selectedTimestamp);
    setIsLoading(true);
    
    try {
      const historicalData = await loadHistoricalData(selectedTimestamp);
      if (historicalData) {
        // Legacy behavior: DO NOT enter historical mode
        // Just notify that data was loaded into chart
        console.log('[HistoricalData] Successfully loaded historical data into chart');
        // Keep the button available for loading other logs
        // Keep selectedTimestamp so user can see what's currently loaded
        if (onLoadHistoricalDataToChart) {
          onLoadHistoricalDataToChart(historicalData, selectedTimestamp);
        }
      }
    } catch (error) {
      console.error('[HistoricalData] Failed to load historical data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedTimestamp, loadHistoricalData, onLoadHistoricalDataToChart]);

  const handleDeleteHistoricalData = useCallback(async () => {
    if (!selectedTimestamp) {
      return;
    }

    const isConfirmed = window.confirm('Sind Sie sicher, dass Sie die ausgewählten Daten löschen möchten?');
    if (!isConfirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      const deleted = await deleteHistoricalData(selectedTimestamp);
      if (deleted) {
        // Force re-selection from updated list (auto-select effect picks first available).
        setSelectedTimestamp('');
      }
    } finally {
      setIsDeleting(false);
    }
  }, [selectedTimestamp, deleteHistoricalData]);

  const handleReturnToLive = useCallback(() => {
    console.log('[HistoricalData] Returning to live data');

    const chartElement = chartRef?.current as ChartDivElement | null;

    // Prefer the full "back to live" path which restores the live data backup.
    if ((chartElement as any)?.backToLive) {
      (chartElement as any).backToLive();
    } else {
      // Fallback for cases where the chart is not yet mounted
      if (chartElement?.clearChartData) chartElement.clearChartData();
      if (chartElement?.clearMarkers) chartElement.clearMarkers();
    }

    clearHistoricalMode();
    setHistoricalMode(false);
    setSelectedTimestamp('');
  }, [clearHistoricalMode, setHistoricalMode, chartRef]);

  // Format timestamp for display - includes timezoneRefreshKey for reactivity
  const formatTimestamp = useCallback((timestamp: string): string => {
    try {
      const date = new Date(parseInt(timestamp) * 1000);
      return formatHistoricalDateWithUserTimezone(date, i18n.language || 'en', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return timestamp;
    }
  }, [i18n.language, timezoneRefreshKey]); // Re-run when timezone changes

  if (!deviceId) {
    return (
      <div className={getSectionClassName(isNeo, className)}>
        <h3 className={getHeaderClassName(isNeo)}>
          <div className="flex items-center">
            <div className={getIconWrapperClassName(isNeo)}>
              <svg className={getIconClassName(isNeo)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span>{t('historical.title')}</span>
          </div>
          <button onClick={handleOpenTimezoneSettings} className={getTimezoneButtonClassName(isNeo)} title="Timezone Settings">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </h3>
        <div className="rig-section-content">
          <div className={isNeo ? 'bg-card rounded p-4 border border-border' : 'bg-card rounded-xl p-4 border border-border shadow-theme-sm'}>
            <div className="text-center text-muted-foreground">
              <div className="w-12 h-12 bg-muted rounded-xl mx-auto mb-2 flex items-center justify-center">
                <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground mb-1">{t('historical.noDevice')}</p>
              <p className="text-xs text-muted-foreground">{t('historical.connectPrompt')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={getSectionClassName(isNeo, className)}>
      <h3 className={getHeaderClassName(isNeo)}>
        <div className="flex items-center">
          <div className={getIconWrapperClassName(isNeo)}>
            <svg className={getIconClassName(isNeo)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span>{t('historical.title')}</span>
        </div>
        <button onClick={handleOpenTimezoneSettings} className={getTimezoneButtonClassName(isNeo)} title="Timezone Settings">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </h3>
      
      <div className="rig-section-content">
        <div className={getContentCardClassName(isNeo)}>
          <div className="historical-data-container space-y-3">
            {/* Historical Data Selector */}
            <div className="historical-data-selector">
              <div className="flex items-center gap-1 mb-2">
                <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <label htmlFor="historical-data-select" className="text-xs font-medium text-foreground">
                  {t('historical.available')}
                </label>
              </div>
              <select
                id="historical-data-select"
                value={selectedTimestamp}
                onChange={(e) => setSelectedTimestamp(e.target.value)}
                className="w-full px-2 py-1.5 border border-border rounded-lg text-xs bg-muted text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                size={HISTORICAL_SELECT_SIZE}
                disabled={isLoading || isDeleting}
              >
                {historicalTimestamps.length === 0 ? (
                  <option value="" disabled>
                    {isLoading ? t('historical.loading') : t('historical.none')}
                  </option>
                ) : (
                  historicalTimestamps.map((timestamp) => (
                    <option key={timestamp} value={timestamp}>
                      {formatTimestamp(timestamp)}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Controls */}
            <div className="historical-data-controls grid grid-cols-1 gap-2">
              <button
                onClick={handleLoadHistoricalData}
                disabled={!selectedTimestamp || isLoading || isDeleting}
                className={isNeo ? 'w-full px-3 py-2 bg-primary text-primary-foreground rounded-none border border-border shadow-[4px_4px_0_0_var(--border)] hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center' : 'w-full px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center shadow-theme-xs'}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin w-3 h-3 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {t('actions.loading')}
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {t('historical.loadToChart')}
                  </>
                )}
              </button>

              <button
                onClick={handleDeleteHistoricalData}
                disabled={!selectedTimestamp || isLoading || isDeleting}
                className={isNeo ? 'w-full px-3 py-2 bg-destructive text-destructive-foreground rounded-none border border-border shadow-[4px_4px_0_0_var(--border)] hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center' : 'w-full px-3 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/80 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center shadow-theme-xs'}
              >
                <svg className="w-3 h-3 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8" />
                </svg>
                {isDeleting ? t('actions.loading') : 'Delete'}
              </button>
              
              <button
                onClick={handleReturnToLive}
                className={isNeo ? 'w-full px-3 py-2 bg-destructive text-destructive-foreground rounded-none border border-border shadow-[4px_4px_0_0_var(--border)] hover:brightness-95 text-xs font-medium flex items-center justify-center' : 'w-full px-3 py-2 bg-muted text-foreground rounded-lg hover:bg-accent text-xs font-medium flex items-center justify-center border border-border shadow-theme-xs'}
              >
                <svg className="w-3 h-3 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
                </svg>
                {t('historical.backToLive')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Timezone Settings Modal */}
      <TimezoneSettingsModal
        isOpen={showTimezoneSettings}
        onClose={() => setShowTimezoneSettings(false)}
      />
    </div>
  );
};

export default HistoricalDataPanel;

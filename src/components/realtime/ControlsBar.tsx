import React, { useCallback } from 'react';
import type { ChartMarker } from '../../types';
import { useTranslation } from 'react-i18next';
import { formatHistoricalDateWithUserTimezone } from '../../utils/timezone';
import { useTimezoneRefresh } from '../../hooks/useTimezoneRefresh';

type AutoScrollMode = 'edge' | 'discard_left' | 'center';

const START_MARKER_INDEX = 0;
const END_MARKER_INDEX = 1;
const ZOOM_MIN = 1;
const ZOOM_MAX = 100;
// MAGIC: keep custom scale limits to protect UX and performance
const CUSTOM_SCALE_MIN = 10;
const CUSTOM_SCALE_MAX = 3600;

interface ControlsBarProps {
  isChartPaused: boolean;
  historicalDate: string | null;
  autoScroll: boolean;
  autoScrollMode: AutoScrollMode;
  autoScrollCustomScale: number;
  zoomLevel: number;
  markers: ChartMarker[];
  hasUserAdjustedZoomRef: React.MutableRefObject<boolean>;
  // Handlers
  onPlayPause: () => void;
  onForceLive: () => void;
  onToggleAutoScroll: (enabled: boolean) => void;
  onChangeAutoScrollMode: (mode: AutoScrollMode) => void;
  onChangeAutoScrollCustomScale: (seconds: number) => void;
  onClearMarkers: () => void;
  onZoomToMarkers: () => void;
  onNavigateLeft: () => void;
  onZoomSlider: (value: number) => void;
  onNavigateRight: () => void;
  onFitAll: () => void;
  onClearChart: () => void;
  onRunTest: () => void;
  // Mini Data Logs (compact)
  miniLogsTimestamps: string[];
  miniSelectedTimestamp: string;
  onMiniSelectTimestamp: (ts: string) => void;
  onMiniLoadToChart: () => void;
  onMiniBackToLive: () => void;
  miniLoading?: boolean;
  // CSV
  showCSVOptions: boolean;
  setShowCSVOptions: (v: boolean) => void;
  onCopyCSVAll: () => void;
  onCopyCSVVisible: () => void;
  onExportCSVAll: () => void;
  onExportCSVVisible: () => void;
  // PDF
  showPDFOptions: boolean;
  setShowPDFOptions: (v: boolean) => void;
  onQuickPDF: () => void;
  onStatsPDF: () => void;
  onFullPDF: () => void;
  // Compact mode for modal windows
  compact?: boolean;
}

const ControlsBar: React.FC<ControlsBarProps> = ({
  isChartPaused,
  historicalDate,
  autoScroll,
  autoScrollMode,
  autoScrollCustomScale,
  zoomLevel,
  markers,
  hasUserAdjustedZoomRef,
  onPlayPause,
  onForceLive: _onForceLive,
  onToggleAutoScroll,
  onChangeAutoScrollMode,
  onChangeAutoScrollCustomScale,
  onClearMarkers,
  onZoomToMarkers,
  onNavigateLeft,
  onZoomSlider,
  onNavigateRight,
  onFitAll,
  onClearChart,
  onRunTest,
  miniLogsTimestamps,
  miniSelectedTimestamp,
  onMiniSelectTimestamp,
  onMiniLoadToChart,
  onMiniBackToLive,
  miniLoading = false,
  showCSVOptions,
  setShowCSVOptions,
  onCopyCSVAll,
  onCopyCSVVisible,
  onExportCSVAll,
  onExportCSVVisible,
  showPDFOptions,
  setShowPDFOptions,
  onQuickPDF,
  onStatsPDF,
  onFullPDF,
  compact = false,
}) => {
  const { t } = useTranslation();
  const timezoneRefreshKey = useTimezoneRefresh();
  // Unified check prevents accessing markers[i] when insufficient markers exist.
  const hasBothMarkers = markers.length >= 2
    && Boolean(markers[START_MARKER_INDEX]?.timestamp && markers[END_MARKER_INDEX]?.timestamp);

  // Format timestamp for historical logs
  const formatHistoricalTimestamp = useCallback((timestamp: string): string => {
    return formatHistoricalDateWithUserTimezone(parseInt(timestamp, 10) * 1000, 'de-DE', { 
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
  }, [timezoneRefreshKey]);

  const showCustomScaleInput = autoScrollMode === 'center' || autoScrollMode === 'discard_left';

  const handleZoomSliderChange = (value: string) => {
    const val = parseInt(value);
    hasUserAdjustedZoomRef.current = true;
    onZoomSlider(val);
  };

  const handleCustomScaleChange = (value: string) => {
    const parsedValue = parseInt(value, 10);
    if (!isNaN(parsedValue) && parsedValue > 0) {
      onChangeAutoScrollCustomScale(parsedValue);
    }
  };

  // Compact mode for modal windows - show only essential controls
  if (compact) {
    return (
      <div className="mb-1">
        <div className="flex items-center justify-between gap-1 p-1 bg-card border border-border rounded text-[10px] text-foreground">
          {/* Play/Pause */}
          <button
            onClick={onPlayPause}
            className={`px-1.5 py-0.5 rounded font-medium flex items-center transition-colors ${
              isChartPaused
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning'
            }`}
            title={isChartPaused ? 'Resume' : 'Pause'}
          >
            <svg className="w-2.5 h-2.5 mr-0.5" fill="currentColor" viewBox="0 0 24 24">
              {isChartPaused ? (
                <path d="M8 5v14l11-7z" />
              ) : (
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              )}
            </svg>
            {isChartPaused ? 'Play' : 'Pause'}
          </button>

          {/* Auto-scroll checkbox */}
          <label className="flex items-center cursor-pointer text-muted-foreground">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => onToggleAutoScroll(e.target.checked)}
              className="mr-0.5 h-2 w-2 rounded border border-border bg-card"
            />
            Auto
          </label>

          {/* Navigation and Zoom */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={onNavigateLeft}
              className="p-0.5 bg-muted hover:bg-muted/80 text-foreground rounded border border-border"
              title="Navigate Left"
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              value={zoomLevel}
              onChange={(e) => {
                handleZoomSliderChange(e.target.value);
              }}
              className="w-12 h-1 accent-primary"
              title={`Zoom: ${zoomLevel}%`}
            />
            <button
              onClick={onNavigateRight}
              className="p-0.5 bg-muted hover:bg-muted/80 text-foreground rounded border border-border"
              title="Navigate Right"
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Fit All */}
          <button
            onClick={onFitAll}
            className="px-1.5 py-0.5 bg-info/10 text-info rounded"
            title="Fit All"
          >
            Fit
          </button>

          {/* Clear Markers */}
          <button
            onClick={onClearMarkers}
            className="px-1.5 py-0.5 bg-info/10 text-info rounded"
            title="Clear Markers"
          >
            ⌧
          </button>

          {/* Clear Chart */}
          <button
            onClick={onClearChart}
            className="px-1.5 py-0.5 bg-destructive/10 text-destructive rounded"
            title="Clear Chart"
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2">
      {/* Desktop (lg+) */}
      <div className="hidden lg:flex items-center justify-between gap-2 p-1.5 bg-muted rounded-md border border-border transition-colors">
        <div className="flex items-center space-x-3">
          {/* Playback Controls Group */}
          <div className="flex items-center space-x-2 border-r border-border pr-3">
            <button
              onClick={onPlayPause}
              className={`px-2 py-1 rounded text-xs font-medium flex items-center transition-colors ${
                isChartPaused
                  ? 'bg-success/10 hover:bg-success/20 text-success'
                  : 'bg-warning/10 hover:bg-warning/20 text-warning'
              }`}
              title={isChartPaused ? (t('chart.controls.resumeChart') as string) : (t('chart.controls.pauseChart') as string)}
            >
              <svg className={`w-3 h-3 mr-1`} fill="currentColor" viewBox="0 0 24 24">
                {isChartPaused ? (
                  <path d="M8 5v14l11-7z" />
                ) : (
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                )}
              </svg>
              {isChartPaused ? t('chart.controls.resume') : t('chart.controls.pause')}
            </button>

            <label className="flex items-center text-xs cursor-pointer text-foreground">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => onToggleAutoScroll(e.target.checked)}
                data-role="auto-scroll"
                className="mr-1 h-2.5 w-2.5 text-info focus:ring-ring border-border rounded transition-colors bg-card"
              />
              {t('chart.controls.autoScroll')}
            </label>

            {/* Autoscroll mode selector */}
            <select
              value={autoScrollMode}
              onChange={(e) => onChangeAutoScrollMode(e.target.value as any)}
              className="ml-2 px-1 py-0.5 border border-border rounded text-xs bg-card text-foreground"
              title={t('chart.controls.autoScrollMode') as string}
            >
              <option value="edge">{t('chart.controls.edge')}</option>
              <option value="discard_left">{t('chart.controls.discardLeft')}</option>
              <option value="center">{t('chart.controls.center')}</option>
            </select>

            {/* Custom scale input for center and discard_left modes */}
            {(autoScrollMode === 'center' || autoScrollMode === 'discard_left') && (
              <div className="flex items-center ml-2">
                <input
                  type="number"
                  value={autoScrollCustomScale}
                  onChange={(e) => {
                    handleCustomScaleChange(e.target.value);
                  }}
                  min={CUSTOM_SCALE_MIN}
                  max={CUSTOM_SCALE_MAX}
                  className="w-16 px-1 py-0.5 border border-border rounded text-xs bg-card text-foreground"
                  title={t('chart.controls.windowSecondsTitle') as string}
                />
                <span className="ml-1 text-xs text-muted-foreground">{t('chart.controls.secondsShort')}</span>
              </div>
            )}
          </div>

          {/* Marker Controls */}
          <div className="flex items-center space-x-2 border-r border-border pr-3">
            <button
              onClick={onClearMarkers}
              className="px-2 py-1 bg-info/10 hover:bg-info/20 text-info rounded text-xs transition-colors"
              title={t('chart.controls.clearMarkersTitle') as string}
            >
              {t('chart.controls.clearMarkers')}
            </button>

            <button
              onClick={onZoomToMarkers}
              disabled={!hasBothMarkers}
              className="px-2 py-1 bg-info/10 hover:bg-info/20 text-info rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={t('chart.controls.zoomToMarkersTitle') as string}
            >
              {t('chart.controls.zoomToMarkers')}
            </button>
          </div>

          {/* View Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={onNavigateLeft}
              className="px-2 py-1 bg-card hover:bg-muted text-foreground rounded text-xs border border-border flex items-center transition-colors"
              title={t('chart.controls.navigateLeft') as string}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex items-center space-x-1 text-xs text-foreground">
              <span className="text-muted-foreground">{t('chart.controls.zoomLabel')}</span>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                value={zoomLevel}
                onChange={(e) => {
                  handleZoomSliderChange(e.target.value);
                }}
                className="w-16 h-1 accent-primary"
                title={t('chart.controls.zoomLevel') as string}
              />
              <span className="text-xs text-muted-foreground min-w-[30px]">{zoomLevel}%</span>
            </div>

            <button
              onClick={onNavigateRight}
              className="px-2 py-1 bg-card hover:bg-muted text-foreground rounded text-xs border border-border flex items-center transition-colors"
              title={t('chart.controls.navigateRight') as string}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <button
              onClick={onFitAll}
              className="px-2 py-1 bg-info/10 hover:bg-info/20 text-info rounded text-xs transition-colors"
              title={t('chart.controls.fitAllTitle') as string}
            >
              {t('chart.controls.fitAll')}
            </button>

            {/* Compact Data Logs (to the right of Fit All) */}
            <div className="flex items-center space-x-1 border-l border-border pl-2">
              <select
                value={miniSelectedTimestamp}
                onChange={(e) => onMiniSelectTimestamp(e.target.value)}
                className="px-1 py-0.5 border border-border rounded text-[10px] bg-card text-foreground"
                title={t('chart.controls.logsTitle') as string}
              >
                <option value="">{t('chart.controls.logsOption')}</option>
                {miniLogsTimestamps.map(ts => (
                  <option key={ts} value={ts}>
                    {formatHistoricalTimestamp(ts)}
                  </option>
                ))}
              </select>
              <button
                onClick={onMiniLoadToChart}
                disabled={!miniSelectedTimestamp || miniLoading}
                className="px-2 py-1 bg-info/10 hover:bg-info/20 text-info rounded text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('chart.controls.logsTitle') as string}
              >
                {t('chart.controls.load')}
              </button>
              <button
                onClick={onMiniBackToLive}
                className="px-2 py-1 bg-card hover:bg-muted text-foreground rounded text-xs border border-border transition-colors"
                title={t('chart.controls.live') as string}
              >
                {t('chart.controls.live')}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Chart Actions */}
          <div className="flex items-center space-x-1 border-r border-border pr-3">
            <button
              onClick={onClearChart}
              className="px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded text-xs flex items-center transition-colors"
              title={t('chart.controls.clearAllDataTitle') as string}
            >
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {t('chart.controls.clear')}
            </button>
            <button
              onClick={onRunTest}
              className="px-2 py-1 bg-success/10 hover:bg-success/20 text-success rounded text-xs flex items-center transition-colors"
              title={t('chart.controls.runTestTitle') as string}
            >
              {t('chart.controls.test')}
            </button>
          </div>

          {/* Export Controls Group */}
          <div className="flex items-center space-x-2 border-l border-border pl-3">
            {/* CSV Export Dropdown */}
            <div className="relative csv-export-dropdown">
              <button
                onClick={() => setShowCSVOptions(!showCSVOptions)}
                className="px-2 py-1 bg-success/10 hover:bg-success/20 text-success rounded text-xs flex items-center transition-colors"
                title={t('chart.controls.csvTitle') as string}
              >
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a4 4 0 01-4-4V5a2 2 0 012-2h6l4 4v5a4 4 0 004 4z" />
                </svg>
                {t('chart.controls.csvExport')}
                <svg className={`w-3 h-3 ml-1 transform transition-transform ${showCSVOptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showCSVOptions && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-card/85 backdrop-blur-md border border-border rounded-md shadow-theme-md z-50 transition-colors">
                  <div className="py-1">
                    <button onClick={onCopyCSVAll} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted flex items-center transition-colors">
                      <svg className="w-3 h-3 mr-2 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <div>
                        <div className="font-medium">{t('chart.controls.copyCsvAll')}</div>
                        <div className="text-muted-foreground">{t('chart.controls.copyCsvAllDesc')}</div>
                      </div>
                    </button>

                    <button onClick={onCopyCSVVisible} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted flex items-center transition-colors">
                      <svg className="w-3 h-3 mr-2 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <div>
                        <div className="font-medium">{t('chart.controls.copyCsvVisible')}</div>
                        <div className="text-muted-foreground">{t('chart.controls.copyCsvVisibleDesc')}</div>
                      </div>
                    </button>

                    <button onClick={onExportCSVAll} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted flex items-center transition-colors">
                      <svg className="w-3 h-3 mr-2 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div>
                        <div className="font-medium">{t('chart.controls.exportCsvAll')}</div>
                        <div className="text-muted-foreground">{t('chart.controls.exportCsvAllDesc')}</div>
                      </div>
                    </button>

                    <button onClick={onExportCSVVisible} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted flex items-center transition-colors">
                      <svg className="w-3 h-3 mr-2 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                      </svg>
                      <div>
                        <div className="font-medium">{t('chart.controls.exportCsvVisible')}</div>
                        <div className="text-muted-foreground">{t('chart.controls.exportCsvVisibleDesc')}</div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* PDF Export Dropdown */}
            <div className="relative pdf-export-dropdown">
              <button
                onClick={() => setShowPDFOptions(!showPDFOptions)}
                className="px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded text-xs flex items-center transition-colors"
                title={t('chart.controls.pdfTitle') as string}
              >
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                {t('chart.controls.pdfExport')}
                <svg className={`w-3 h-3 ml-1 transform transition-transform ${showPDFOptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showPDFOptions && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-card/85 backdrop-blur-md border border-border rounded-md shadow-theme-md z-50 transition-colors">
                  <div className="py-1">
                    <button onClick={onQuickPDF} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted flex items-center transition-colors">
                      <svg className="w-3 h-3 mr-2 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <div>
                        <div className="font-medium">{t('chart.controls.quickExport')}</div>
                        <div className="text-muted-foreground">{t('chart.controls.quickExportDesc')}</div>
                      </div>
                    </button>

                    <button onClick={onStatsPDF} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted flex items-center transition-colors">
                      <svg className="w-3 h-3 mr-2 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <div>
                        <div className="font-medium">{t('chart.controls.withStats')}</div>
                        <div className="text-muted-foreground">{t('chart.controls.withStatsDesc')}</div>
                      </div>
                    </button>

                    <button onClick={onFullPDF} className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted flex items-center transition-colors">
                      <svg className="w-3 h-3 mr-2 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div>
                        <div className="font-medium">{t('chart.controls.completeReport')}</div>
                        <div className="text-muted-foreground">{t('chart.controls.completeReportDesc')}</div>
                      </div>
                    </button>

                    {historicalDate && (
                      <>
                        <div className="border-t border-border my-1"></div>
                        <div className="px-3 py-1 text-xs text-muted-foreground bg-info/10">{t('chart.controls.historical', { date: historicalDate })}</div>
                      </>
                    )}

                    {markers.some(m => m.timestamp) && (
                      <>
                        <div className="border-t border-border my-1"></div>
                        <div className="px-3 py-1 text-xs text-muted-foreground bg-warning/10">{t('chart.controls.markersIncluded_other', { count: markers.filter(m => m.timestamp).length })}</div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile/Tablet (up to lg) - full controls in stacked layout */}
      <div className="lg:hidden space-y-2 p-2 bg-muted rounded-md border border-border">
        {/* Row 1: play/pause + autoscroll */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onPlayPause}
            className={`px-2 py-1 rounded text-xs font-medium flex items-center transition-colors ${
              isChartPaused
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning'
            }`}
            title={isChartPaused ? (t('chart.controls.resumeChart') as string) : (t('chart.controls.pauseChart') as string)}
          >
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
              {isChartPaused ? (
                <path d="M8 5v14l11-7z" />
              ) : (
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              )}
            </svg>
            {isChartPaused ? t('chart.controls.resume') : t('chart.controls.pause')}
          </button>

          <label className="flex items-center text-xs cursor-pointer text-foreground">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => onToggleAutoScroll(e.target.checked)}
              className="mr-1 h-3 w-3 text-info focus:ring-ring border-border rounded bg-card"
            />
            {t('chart.controls.autoScroll')}
          </label>

          <select
            value={autoScrollMode}
            onChange={(e) => onChangeAutoScrollMode(e.target.value as any)}
            className="ml-auto px-1.5 py-1 border border-border rounded text-xs bg-card text-foreground"
            title={t('chart.controls.autoScrollMode') as string}
          >
            <option value="edge">{t('chart.controls.edge')}</option>
            <option value="discard_left">{t('chart.controls.discardLeft')}</option>
            <option value="center">{t('chart.controls.center')}</option>
          </select>
        </div>

        {showCustomScaleInput && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground">{t('chart.controls.windowSecondsTitle')}</span>
            <input
              type="number"
              value={autoScrollCustomScale}
              onChange={(e) => {
                handleCustomScaleChange(e.target.value);
              }}
              min={CUSTOM_SCALE_MIN}
              max={CUSTOM_SCALE_MAX}
              className="w-20 px-2 py-1 text-xs border border-border rounded bg-card text-foreground"
            />
          </div>
        )}

        {/* Row 2: markers */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onClearMarkers}
            className="px-2 py-1 bg-info/10 text-info rounded text-xs"
          >
            {t('chart.controls.clearMarkers')}
          </button>
          <button
            onClick={onZoomToMarkers}
            disabled={!hasBothMarkers}
            className="px-2 py-1 bg-info/10 text-info rounded text-xs disabled:opacity-50"
          >
            {t('chart.controls.zoomToMarkers')}
          </button>
        </div>

        {/* Row 3: navigation + zoom */}
        <div className="flex items-center gap-2">
          <button
            onClick={onNavigateLeft}
            className="px-2 py-1 bg-card hover:bg-muted text-foreground rounded text-xs border border-border flex items-center transition-colors"
            title={t('chart.controls.navigateLeft') as string}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            value={zoomLevel}
            onChange={(e) => {
              handleZoomSliderChange(e.target.value);
            }}
            className="flex-1 h-1 accent-primary"
            title={t('chart.controls.zoomLevel') as string}
          />
          <span className="text-xs text-muted-foreground min-w-[34px] text-right">{zoomLevel}%</span>
          <button
            onClick={onNavigateRight}
            className="px-2 py-1 bg-card hover:bg-muted text-foreground rounded text-xs border border-border flex items-center transition-colors"
            title={t('chart.controls.navigateRight') as string}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={onFitAll}
            className="px-2 py-1 bg-info/10 hover:bg-info/20 text-info rounded text-xs transition-colors"
            title={t('chart.controls.fitAllTitle') as string}
          >
            {t('chart.controls.fitAll')}
          </button>
        </div>

        {/* Row 4: logs */}
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={miniSelectedTimestamp}
            onChange={(e) => onMiniSelectTimestamp(e.target.value)}
            className="flex-1 px-2 py-1 border border-border rounded text-xs bg-card text-foreground"
            title={t('chart.controls.logsTitle') as string}
          >
            <option value="">{t('chart.controls.logsOption')}</option>
            {miniLogsTimestamps.map(ts => (
              <option key={ts} value={ts}>
                {formatHistoricalTimestamp(ts)}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              onClick={onMiniLoadToChart}
              disabled={!miniSelectedTimestamp || miniLoading}
              className="px-2 py-1 bg-info/10 hover:bg-info/20 text-info rounded text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('chart.controls.load')}
            </button>
            <button
              onClick={onMiniBackToLive}
              className="px-2 py-1 bg-card hover:bg-muted text-foreground rounded text-xs border border-border transition-colors"
            >
              {t('chart.controls.live')}
            </button>
          </div>
        </div>

        {/* Row 5: export actions */}
        <div className="grid grid-cols-2 gap-2">
          <div className="relative csv-export-dropdown">
            <button
              onClick={() => setShowCSVOptions(!showCSVOptions)}
              className="w-full px-2 py-1 bg-success/10 hover:bg-success/20 text-success rounded text-xs flex items-center justify-center transition-colors"
              title={t('chart.controls.csvTitle') as string}
            >
              {t('chart.controls.csvExport')}
              <svg className={`w-3 h-3 ml-1 transform transition-transform ${showCSVOptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showCSVOptions && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-card/85 backdrop-blur-md border border-border rounded-md shadow-theme-md z-50 transition-colors">
                <div className="py-1">
                  <button onClick={onCopyCSVAll} className="w-full text-left px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors">{t('chart.controls.copyCsvAll')}</button>
                  <button onClick={onCopyCSVVisible} className="w-full text-left px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors">{t('chart.controls.copyCsvVisible')}</button>
                  <button onClick={onExportCSVAll} className="w-full text-left px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors">{t('chart.controls.exportCsvAll')}</button>
                  <button onClick={onExportCSVVisible} className="w-full text-left px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors">{t('chart.controls.exportCsvVisible')}</button>
                </div>
              </div>
            )}
          </div>

          <div className="relative pdf-export-dropdown">
            <button
              onClick={() => setShowPDFOptions(!showPDFOptions)}
              className="w-full px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded text-xs flex items-center justify-center transition-colors"
              title={t('chart.controls.pdfTitle') as string}
            >
              {t('chart.controls.pdfExport')}
              <svg className={`w-3 h-3 ml-1 transform transition-transform ${showPDFOptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showPDFOptions && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-card/85 backdrop-blur-md border border-border rounded-md shadow-theme-md z-50 transition-colors">
                <div className="py-1">
                  <button onClick={onQuickPDF} className="w-full text-left px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors">{t('chart.controls.quickExport')}</button>
                  <button onClick={onStatsPDF} className="w-full text-left px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors">{t('chart.controls.withStats')}</button>
                  <button onClick={onFullPDF} className="w-full text-left px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors">{t('chart.controls.completeReport')}</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 6: destructive/utility actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onClearChart}
            className="px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded text-xs flex items-center transition-colors"
            title={t('chart.controls.clearAllDataTitle') as string}
          >
            {t('chart.controls.clear')}
          </button>
          <button
            onClick={onRunTest}
            className="px-2 py-1 bg-success/10 hover:bg-success/20 text-success rounded text-xs flex items-center transition-colors"
            title={t('chart.controls.runTestTitle') as string}
          >
            {t('chart.controls.test')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ControlsBar; 
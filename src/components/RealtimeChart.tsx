import * as React from 'react';
import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState, useContext } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  LineController,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
  type ChartData,
  type ChartEvent,
  type ActiveElement,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';
import { formatDateWithUserTimezone } from '../utils/timezone';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';
import { exportChartToCSV, exportChartToPDFEnhanced, copyCSVToClipboard, exportCSVFile } from '../utils/chartExportUtils';
import type { ParameterInfo, RigData, ChartMarker } from '../types';
import { applyFixedRange, recordCurrentRange } from '../utils/chartViewUtils';
import { ChartRefContext } from '../context/ChartRefContext';
import type { ChartDivElement } from '../context/ChartRefContext';
import { getScaleRange, setScaleRangeBoth } from '../utils/realtime/scale';
import { buildColoredCursorInfo, buildColoredMarkerInfo } from '../utils/realtime/format';
import ChartHeader from './realtime/ChartHeader';
import ParameterLegend from './realtime/ParameterLegend';
import ColorPickerModal from './realtime/ColorPickerModal';
import InfoPanels from './realtime/InfoPanels';
import ControlsBar from './realtime/ControlsBar';
import { useMarkers } from '../hooks/realtime/useMarkers';
import { useAnalysis } from '../hooks/realtime/useAnalysis';
import { useHistoricalData } from '../hooks/useFirebase';
import { saveChartData, loadChartData, clearChartData as clearStoredChartData, clearOldChartData, addGapToChartData } from '../utils/chartStorage';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  LineController,
  Title,
  Tooltip,
  Legend,
  annotationPlugin,
  zoomPlugin
);

interface RealtimeChartProps {
  parameters: ParameterInfo[];
  currentData: RigData;
  isHistoricalMode?: boolean;
  deviceId?: string;
  rigModel?: string;
  rigModelInfo?: string;
  parameterSet?: string;
  onParameterColorChange?: (paramId: string, color: string) => Promise<void>;
  onParameterVisibilityChange?: (paramId: string, visible: boolean) => Promise<void>;
  onLoadHistoricalData?: (timestamp: string) => Promise<any>;
  /** Compact mode for modal windows - uses smaller UI elements */
  compact?: boolean;
  /** Unique chart instance ID for multi-chart support */
  chartInstanceId?: string;
  /** Whether this is the main (primary) chart that cannot be deleted */
  isMainChart?: boolean;
  /** Callback to clone this chart instance */
  onCloneChart?: (chartId: string) => void;
  /** Callback to delete this chart instance (only for non-main charts) */
  onDeleteChart?: (chartId: string) => void;
  /** Current chart index in the array (0-based) */
  chartIndex?: number;
  /** Total number of chart instances */
  totalCharts?: number;
  /** External historical data to load (for modal windows) */
  externalHistoricalData?: any;
  /** Base timestamp for external historical data */
  externalHistoricalTimestamp?: number;
}

interface ChartDataPoint {
  x: number;
  y: number | null;
  originalY: number | null;
  /** Rohwert vom Gerät / aus dem Log — ermöglicht sofortige Divisor-Neuberechnung für alle Punkte */
  rawDeviceValue?: number | null;
}

interface ChartContainerElement extends ChartDivElement {}

type AutoScrollMode = 'edge' | 'discard_left' | 'center';

// LEGACY: default UI strings preserved for chart info panels
const DEFAULT_CURSOR_INFO = 'Hover over chart for values';
const DEFAULT_ANALYSIS_TEXT = 'Results: Set two markers to analyze.';
const DEFAULT_MARKER_INFO = [
  'Left Marker: (click on chart to set)',
  'Right Marker: (click on chart to set)',
] as const;

const EMPTY_MARKER: ChartMarker = { timestamp: null, values: {}, normalizedValues: {} };
// MAGIC: UI expects exactly 3 marker slots (left, right, cursor)
const MARKER_SLOTS = 3;
const createEmptyMarkers = () =>
  Array.from({ length: MARKER_SLOTS }, () => ({ ...EMPTY_MARKER }));

const AUTO_SCROLL_SCALE_DEFAULT_SECONDS = 120;
// MAGIC: these limits cap the custom window for performance and UX consistency
const AUTO_SCROLL_SCALE_MIN_SECONDS = 10;
const AUTO_SCROLL_SCALE_MAX_SECONDS = 3600;

// MAGIC: guard against overly frequent points; used for monotonic timestamps
const MIN_CHART_INTERVAL_MS = 5000;
// Allow slight jitter so 5s updates don't get dropped and become 10s.
const CHART_INTERVAL_TOLERANCE_MS = 500;
// id_timestamp is integer seconds and can round to 4s deltas; allow slightly smaller interval.
const ID_TIMESTAMP_MIN_INTERVAL_MS = 3500;
const FALLBACK_HISTORICAL_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#17becf', '#bcbd22'];
const LOCAL_SETTINGS_STORAGE_KEY = 'rigwatch-local-settings';
const CHART_INSTANCE_SETTINGS_STORAGE_KEY = 'rigwatch-chart-instance-settings';
const PARAMETER_SETTINGS_CHANGED_EVENT = 'parameterSettingsChanged';

const RealtimeChart: React.FC<RealtimeChartProps> = ({
  parameters,
  currentData,
  isHistoricalMode = false,
  deviceId = 'N/A',
  rigModel = 'N/A',
  rigModelInfo = '',
  parameterSet = 'N/A',
  onParameterColorChange,
  onParameterVisibilityChange,
  onLoadHistoricalData,
  compact = false,
  chartInstanceId = 'main',
  isMainChart = true,
  onCloneChart,
  onDeleteChart,
  chartIndex = 0,
  totalCharts = 1,
  externalHistoricalData,
  externalHistoricalTimestamp,
}: RealtimeChartProps) => {
  const chartRef = useRef<any>(null);
  const contextRef = useContext(ChartRefContext);
  const localContainerRef = useRef<ChartContainerElement | null>(null);
  // Use context ref only for main chart to avoid conflicts with cloned charts
  const containerRef = isMainChart 
    ? (contextRef as React.MutableRefObject<ChartContainerElement | null>) || localContainerRef
    : localContainerRef;
  
  // Chart state
  const [datasets, setDatasets] = useState<any[]>([]);
  const [markers, setMarkers] = useState<ChartMarker[]>(createEmptyMarkers());
  const [cursorInfo, setCursorInfo] = useState<string>(DEFAULT_CURSOR_INFO);
  const [markerInfo, setMarkerInfo] = useState<string[]>([...DEFAULT_MARKER_INFO]);
  const [analysisResults, setAnalysisResults] = useState<string>(DEFAULT_ANALYSIS_TEXT);
  const [historicalDate, setHistoricalDate] = useState<string | null>(null);
  const [zoomToHistoricalPending, setZoomToHistoricalPending] = useState(false);
  const historicalParamConfigsRef = useRef<Record<string, ParameterInfo>>({});
  /** Sofort nach Save im Modal: Werte bis zum Firestore/React-Update mergen */
  const paramChartOverlayRef = useRef<Record<string, Partial<ParameterInfo>>>({});
  /** Settings only for this chart instance (clone-specific) */
  const chartScopedParamOverridesRef = useRef<Record<string, Partial<ParameterInfo>>>({});
  const [chartScopedSettingsVersion, setChartScopedSettingsVersion] = useState(0);
  
  // Chart controls state
  const [isChartPaused, setIsChartPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true); // Enabled by default
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(50);
  const hasUserAdjustedZoomRef = useRef<boolean>(false);
  // When true and autoScroll is enabled, keep current viewport instead of anchoring to the latest point
  const userLockedViewportWhileAutoScrollRef = useRef<boolean>(false);
  // Start timestamp of the current live session (first incoming point after clear/reconnect/mode-change)
  const sessionStartTsRef = useRef<number | null>(null);
  // Track previous device ID to clear stored cache on disconnect/switch
  const lastDeviceIdRef = useRef<string | null>(null);
  // Auto-scroll arming: when true and autoScroll is enabled, next data tick will re-apply autoscroll window
  const autoScrollArmedRef = useRef<boolean>(false);
  // Mirror of autoScroll state to read inside stable callbacks
  const autoScrollEnabledRef = useRef<boolean>(autoScroll);
  useEffect(() => { autoScrollEnabledRef.current = autoScroll; }, [autoScroll]);
  
  // Store fixed window when auto-scroll is disabled
  const fixedRangeRef = useRef<{ min: number | undefined; max: number | undefined }>({
    min: undefined,
    max: undefined,
  });
  
  // Lock initial scale range for 2 minutes after device connection (until user interacts)
  const initialRangeLockUntilRef = useRef<number | null>(null);
  // Start initial view only after first data arrives
  const firstDataSeenRef = useRef<boolean>(false);
  
  // Color picker state
  const [colorPickerParam, setColorPickerParam] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [seriesSettingsParamId, setSeriesSettingsParamId] = useState<string | null>(null);
  const [seriesSettingsForm, setSeriesSettingsForm] = useState({
    color: '',
    visible: true,
    form: '0',
    unit: '',
    minValue: '',
    maxValue: '',
  });
  
  // PDF export dropdown state
  const [showPDFOptions, setShowPDFOptions] = useState(false);
  
  // CSV export dropdown state
  const [showCSVOptions, setShowCSVOptions] = useState(false);

  // Chart size toggle state
  const [isStretched, setIsStretched] = useState(false);
  const headerRef = useRef<HTMLDivElement | null>(null);

  const chartSettingsStorageKey = useMemo(() => {
    if (!deviceId || deviceId === 'N/A') return '';
    return `${CHART_INSTANCE_SETTINGS_STORAGE_KEY}:${deviceId}:${chartInstanceId}`;
  }, [deviceId, chartInstanceId]);

  const saveChartScopedOverride = useCallback((paramId: string, updates: Partial<ParameterInfo>) => {
    const merged = {
      ...(chartScopedParamOverridesRef.current[paramId] || {}),
      ...updates,
    };
    chartScopedParamOverridesRef.current[paramId] = merged;
    setChartScopedSettingsVersion(v => v + 1);

    if (!chartSettingsStorageKey) return;
    try {
      const raw = window.localStorage.getItem(chartSettingsStorageKey);
      const parsed = raw ? (JSON.parse(raw) as Record<string, Partial<ParameterInfo>>) : {};
      parsed[paramId] = merged;
      window.localStorage.setItem(chartSettingsStorageKey, JSON.stringify(parsed));
    } catch (error) {
      console.warn('[RealtimeChart] Failed to persist chart-scoped setting:', error);
    }
  }, [chartSettingsStorageKey]);

  useEffect(() => {
    if (!chartSettingsStorageKey) {
      chartScopedParamOverridesRef.current = {};
      setChartScopedSettingsVersion(v => v + 1);
      return;
    }
    try {
      const raw = window.localStorage.getItem(chartSettingsStorageKey);
      chartScopedParamOverridesRef.current = raw
        ? (JSON.parse(raw) as Record<string, Partial<ParameterInfo>>)
        : {};
      setChartScopedSettingsVersion(v => v + 1);
    } catch (error) {
      chartScopedParamOverridesRef.current = {};
      console.warn('[RealtimeChart] Failed to load chart-scoped settings:', error);
    }
  }, [chartSettingsStorageKey]);

  // Autoscroll mode (persisted)
  const [autoScrollMode, setAutoScrollMode] = useState<AutoScrollMode>(() => {
    try {
      const v = window.localStorage.getItem('autoScrollMode');
      if (v === 'edge' || v === 'discard_left' || v === 'center') return v;
    } catch {}
    return 'edge';
  });
  const handleChangeAutoScrollMode = useCallback((mode: AutoScrollMode) => {
    setAutoScrollMode(mode);
    try { window.localStorage.setItem('autoScrollMode', mode); } catch {}
  }, []);

  // Autoscroll custom scale in seconds (persisted)
  const [autoScrollCustomScale, setAutoScrollCustomScale] = useState<number>(() => {
    try {
      const v = window.localStorage.getItem('autoScrollCustomScale');
      const parsed = parseInt(v || '', 10);
      return (parsed > 0 && parsed <= AUTO_SCROLL_SCALE_MAX_SECONDS)
        ? parsed
        : AUTO_SCROLL_SCALE_DEFAULT_SECONDS; // Default 2 minutes, max 1 hour
    } catch {}
    return AUTO_SCROLL_SCALE_DEFAULT_SECONDS;
  });
  const handleChangeAutoScrollCustomScale = useCallback((seconds: number) => {
    // MAGIC: clamp to prevent tiny or huge windows from breaking UX
    const validSeconds = Math.max(AUTO_SCROLL_SCALE_MIN_SECONDS, Math.min(AUTO_SCROLL_SCALE_MAX_SECONDS, seconds));
    setAutoScrollCustomScale(validSeconds);
    try { window.localStorage.setItem('autoScrollCustomScale', validSeconds.toString()); } catch {}
  }, []);

  // Mini Data Logs (compact) state
  // REMOVED: moved below addHistoricalDataToChart to avoid TDZ on addHistoricalDataToChart
  // const { loadHistoricalTimestamps, loadHistoricalData } = useHistoricalData();
  // const [miniLogs, setMiniLogs] = useState<string[]>([]);
  // const [miniSelectedTs, setMiniSelectedTs] = useState<string>('');
  // const [miniLoading, setMiniLoading] = useState<boolean>(false);
  // useEffect(() => {
  //   loadHistoricalTimestamps().then(setMiniLogs).catch(() => setMiniLogs([]));
  // }, [loadHistoricalTimestamps]);
  // const handleMiniSelectTs = useCallback((ts: string) => { setMiniSelectedTs(ts); }, []);
  // const handleMiniLoadToChart = useCallback(async () => {
  //   if (!miniSelectedTs) return;
  //   setMiniLoading(true);
  //   try {
  //     const data = await loadHistoricalData(miniSelectedTs);
  //     if (data) {
  //       const baseTs = parseInt(miniSelectedTs, 10);
  //       addHistoricalDataToChart(data as any, baseTs);
  //     }
  // } finally {
  //   setMiniLoading(false);
  // }
  // }, [miniSelectedTs, loadHistoricalData, addHistoricalDataToChart]);
  // const handleMiniBackToLive = useCallback(() => {
  //   clearChartData();
  //   clearMarkers();
  //   handleAutoScrollToggle(false);
  //   setInitialChartView();
  // }, [clearChartData, clearMarkers, handleAutoScrollToggle, setInitialChartView]);
  
  // Analysis state - whether to show integrals
  const [showIntegrals, setShowIntegrals] = useState(false);
  
  // Hover throttle refs
  const onHoverRafRef = useRef<number | null>(null);
  const onHoverLastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // ---- Binary search helpers over sorted data by x ----
  const findClosestIndex = useCallback((data: any[], x: number): number => {
    let lo = 0, hi = data.length - 1;
    if (hi < 0) return -1;
    if (x <= data[0].x) return 0;
    if (x >= data[hi].x) return hi;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = data[mid].x;
      if (v === x) return mid;
      if (v < x) lo = mid + 1; else hi = mid - 1;
    }
    if (lo >= data.length) return data.length - 1;
    if (hi < 0) return 0;
    return (x - data[hi].x) <= (data[lo].x - x) ? hi : lo;
  }, []);

  const lowerBound = useCallback((data: any[], x: number): number => {
    let lo = 0, hi = data.length; // [lo, hi)
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data[mid].x < x) lo = mid + 1; else hi = mid;
    }
    return lo; // first index with data[idx].x >= x
  }, []);

  const upperBound = useCallback((data: any[], x: number): number => {
    let lo = 0, hi = data.length; // [lo, hi)
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data[mid].x <= x) lo = mid + 1; else hi = mid;
    }
    return lo - 1; // last index with data[idx].x <= x
  }, []);

  const enforceValidRange = useCallback((scaleX: any) => {
    if (!scaleX) return;
    if (scaleX.min === undefined || scaleX.max === undefined) return;
    if (!isFinite(scaleX.min) || !isFinite(scaleX.max)) return;
    if (scaleX.max <= scaleX.min) {
      const center = (scaleX.min + scaleX.max) / 2;
      const fallback = 5_000;
      scaleX.min = center - fallback;
      scaleX.max = center + fallback;
    }
  }, []);

  // Function to calculate integral between markers (trapezoidal method)
  const calculateIntegral = useCallback((paramId: string): number => {
    if (!markers[0].timestamp || !markers[1].timestamp) return 0;
    
    const dataset = datasets.find((d: any) => d.paramId === paramId);
    if (!dataset || dataset.hidden || !dataset.data.length) return 0;
    
    console.log(`[RealtimeChart] calculateIntegral called for ${paramId}:`, {
      datasetFound: !!dataset,
      datasetHidden: dataset?.hidden,
      dataLength: dataset?.data?.length,
      markers: [markers[0].timestamp, markers[1].timestamp],
      isHistorical: historicalDate !== null
    });
    
    const startTime = markers[0].timestamp;
    const endTime = markers[1].timestamp;
    let integral = 0;
    
    const data = dataset.data as ChartDataPoint[];
    const i0 = Math.max(0, lowerBound(data, startTime));
    const i1 = Math.min(data.length - 1, upperBound(data, endTime));
    if (i1 - i0 < 1) return 0;
    
    // Filter out points with null originalY values for more accurate calculation
    const validData = data.slice(i0, i1 + 1).filter(p => p.originalY !== null);
    if (validData.length < 2) {
      console.warn(`[RealtimeChart] calculateIntegral: Not enough valid data points for ${paramId} between markers. Total: ${data.length}, Valid: ${validData.length}, Range: ${i0}-${i1}`);
      return 0;
    }
    
    for (let i = 0; i < validData.length - 1; i++) {
      const p1 = validData[i];
      const p2 = validData[i + 1];
      if (p1.originalY === null || p2.originalY === null) continue;
      const dt = (p2.x - p1.x) / 1000;
      integral += dt * ((p1.originalY || 0) + (p2.originalY || 0)) / 2;
    }
    
    console.log(`[RealtimeChart] calculateIntegral: ${paramId} = ${integral.toFixed(2)} (${validData.length} valid points)`);
    return integral;
  }, [datasets, lowerBound, upperBound, markers]);

  // Function to calculate average value between markers
  const calculateAverage = useCallback((paramId: string): number => {
    if (!markers[0].timestamp || !markers[1].timestamp) return 0;
    
    const dataset = datasets.find((d: any) => d.paramId === paramId);
    if (!dataset || dataset.hidden || !dataset.data.length) return 0;
    
    console.log(`[RealtimeChart] calculateAverage called for ${paramId}:`, {
      datasetFound: !!dataset,
      datasetHidden: dataset?.hidden,
      dataLength: dataset?.data?.length,
      markers: [markers[0].timestamp, markers[1].timestamp],
      isHistorical: historicalDate !== null
    });
    
    const startTime = markers[0].timestamp;
    const endTime = markers[1].timestamp;
    
    const data = dataset.data as ChartDataPoint[];
    const i0 = Math.max(0, lowerBound(data, startTime));
    const i1 = Math.min(data.length - 1, upperBound(data, endTime));
    if (i1 < i0) return 0;
    
    // Filter out points with null originalY values for more accurate calculation
    const validData = data.slice(i0, i1 + 1).filter(p => p.originalY !== null);
    if (validData.length === 0) {
      console.warn(`[RealtimeChart] calculateAverage: No valid data points for ${paramId} between markers. Total: ${data.length}, Range: ${i0}-${i1}`);
      return 0;
    }
    
    let sum = 0;
    let count = 0;
    for (let i = 0; i < validData.length; i++) {
      const p = validData[i];
      if (p.originalY !== null) {
        sum += (p.originalY || 0);
        count++;
      }
    }
    
    const average = count > 0 ? sum / count : 0;
    console.log(`[RealtimeChart] calculateAverage: ${paramId} = ${average.toFixed(2)} (${count} valid points)`);
    return average;
  }, [datasets, lowerBound, upperBound, markers]);
  
  // Performance optimization refs like legacy  
  const lastKnownValues = useRef<Record<string, number>>({});
  const lastParameterConfigRef = useRef<string>('');
  /** Für geloggte/historische Ansicht: Remap bei Min/Max/Divisor/Form erst auslösen, wenn sich die Signatur wirklich ändert */
  const lastHistoricalChartKeyRef = useRef<string>('');
  const datasetCacheRef = useRef<any[]>([]);
  const restoreRangeRef = useRef(false);
  const lastGeneratedTimestamp = useRef<number>(0);
  
  // Add flag to block live updates during historical data loading
  const isLoadingHistoricalRef = useRef<boolean>(false);
  
  // localStorage persistence refs
  const gapsRef = useRef<{ start: number; end: number }[]>([]);
  const lastSaveTimestampRef = useRef<number>(0);
  const sessionStartTimestampRef = useRef<number | null>(null);
  const dataLoadedFromStorageRef = useRef<boolean>(false);
  const storedDataRef = useRef<any>(null); // Stores loaded data until datasets are ready
  const SAVE_INTERVAL_MS = 5000; // Save every 5 seconds max
  // Track tab visibility to heal timebase after long background periods
  const lastHiddenAtRef = useRef<number | null>(null);
  // Keep gap annotation system in code, but disable it for now
  const enableGapAnnotations = false;
  
  // Backup of live data when switching to historical mode
  const liveDataBackupRef = useRef<{
    datasets: any[];
    lastKnownValues: Record<string, number>;
  } | null>(null);
  
  // (useMarkers initialization moved below to ensure dependencies are declared)
  
  // Constants
  const MAX_DATA_POINTS = 3600;
  const INITIAL_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
  // Allowed distance for selecting a point when hovering historical logs
  const CLOSE_VALUE_THRESHOLD_MS = 60 * 1000; // 60 seconds capture for cursor/markers
  const AUTOSCROLL_PADDING_RATIO = 0.0; // 0% right padding: newest values sit exactly at the right edge

  // rAF-batched chart updates to avoid jitter
  const scheduledUpdateRaf = useRef<number | null>(null);
  const scheduleChartUpdate = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (scheduledUpdateRaf.current !== null) return;
    scheduledUpdateRaf.current = requestAnimationFrame(() => {
      scheduledUpdateRaf.current = null;
      chart.update('none');
    });
  }, []);
 
  // Ensure the first visible points are centered in a 2-minute window based on their timestamp
  const initialWindowAppliedRef = useRef<boolean>(false);
 
  // Find the latest timestamp among currently visible datasets
  const getLatestVisibleTimestamp = useCallback((): number | null => {
    let latest: number | null = null;
    datasetCacheRef.current.forEach((ds: any) => {
      if (!ds.hidden && ds.data?.length) {
        const ts = ds.data[ds.data.length - 1]?.x;
        if (typeof ts === 'number' && isFinite(ts)) {
          latest = latest === null ? ts : Math.max(latest, ts);
        }
      }
    });
    return latest;
  }, []);

  // When returning from a long background period, re-align the x-axis to the newest data
  const reanchorTimebaseToLatest = useCallback((latestTs: number) => {
    if (!autoScroll) return; // respect manual scrolling state
    const chart = chartRef.current;
    if (!chart) return;

    // pick window size based on autoscroll mode, fall back to initial window
    const baseWindowMs = (autoScrollMode === 'center' || autoScrollMode === 'discard_left')
      ? Math.max(10_000, autoScrollCustomScale * 1000)
      : INITIAL_WINDOW_MS;

    const newMin = autoScrollMode === 'center'
      ? latestTs - baseWindowMs / 2
      : latestTs - baseWindowMs;
    const newMax = autoScrollMode === 'center'
      ? latestTs + baseWindowMs / 2
      : latestTs + 5_000; // small padding on the right for edge / discard_left

    sessionStartTsRef.current = newMin;
    fixedRangeRef.current = { min: undefined, max: undefined };
    userLockedViewportWhileAutoScrollRef.current = false;
    autoScrollArmedRef.current = true;
    setUserHasScrolled(false);

    setScaleRangeBoth(chart, newMin, newMax);
    scheduleChartUpdate();
  }, [autoScroll, autoScrollMode, autoScrollCustomScale, scheduleChartUpdate]);
  
  // Normalize value to 0-100 range for chart display
  const normalizeValue = useCallback((rawValue: number | null, paramConfig: ParameterInfo): number | null => {
    if (rawValue === null || rawValue === undefined || !paramConfig) return null;
    
    const minValue = paramConfig.minValue ?? 0;
    const maxValue = paramConfig.maxValue ?? 100;
    
    if (minValue === maxValue) return null;
    
    const value = parseFloat(rawValue.toString());
    if (isNaN(value)) return null;
    
    const normalized = ((value - minValue) / (maxValue - minValue)) * 100;
    return Math.max(0, Math.min(100, normalized));
  }, []);

  // Create format legend label like legacy
  const formatLegendLabel = useCallback((paramConfig: ParameterInfo): string => {
    const displayName = paramConfig.displayName || paramConfig.originalName;
    const originalName = paramConfig.originalName;
    const unit = paramConfig.unit || '';
    
    return `${displayName} (${originalName}) ${unit}`;
  }, []);

  const getHistoricalFallbackColor = useCallback((paramId: string): string => {
    let hash = 0;
    for (let i = 0; i < paramId.length; i += 1) {
      hash = ((hash << 5) - hash + paramId.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % FALLBACK_HISTORICAL_COLORS.length;
    return FALLBACK_HISTORICAL_COLORS[idx];
  }, []);

  const getLocalParamSettings = useCallback((paramId: string): { color?: string; show_in_legend?: boolean; visible_on_chart?: boolean } => {
    if (!deviceId || deviceId === 'N/A') return {};
    try {
      const raw = window.localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, { parameters?: Record<string, any> }>;
      return parsed?.[deviceId]?.parameters?.[paramId] || {};
    } catch {
      return {};
    }
  }, [deviceId]);

  const buildHistoricalParamConfig = useCallback((paramId: string): ParameterInfo => {
    const existing = historicalParamConfigsRef.current[paramId];
    if (existing) return existing;

    const local = getLocalParamSettings(paramId);
    const isStatusParam = paramId === 'N';
    const looksLikeTemperature = /(^|_)T($|_)/i.test(paramId);
    const looksLikePercent = /(^|_)(P|PL|SL|RL|PROZENT|PERCENT|L)($|_)/i.test(paramId);

    const config: ParameterInfo = {
      originalName: paramId,
      displayName: paramId,
      unit: looksLikeTemperature ? '°C' : (looksLikePercent ? '%' : ''),
      description: 'Historical parameter',
      icon: 'fa-chart-line',
      color: local.color || getHistoricalFallbackColor(paramId),
      divisor: 1,
      minValue: isStatusParam ? 0 : (looksLikePercent ? 0 : undefined),
      maxValue: isStatusParam ? 7 : (looksLikePercent ? 100 : (looksLikeTemperature ? 700 : undefined)),
      form: isStatusParam ? 1 : 0,
      yAxisID: 'yPercentage',
      initialSuggestedMax: undefined,
      favorite: 0,
      position: 9999,
      show_in_legend: local.show_in_legend ?? true,
      visible_on_chart: local.visible_on_chart ?? true,
      rangeString: '',
      defaultChart: false,
      isInitiallyVisibleOnChart: true,
    };

    historicalParamConfigsRef.current[paramId] = config;
    return config;
  }, [getHistoricalFallbackColor, getLocalParamSettings]);

  const getParameterConfig = useCallback((paramId: string): ParameterInfo => {
    const liveParam = parameters.find(p => p.originalName === paramId);
    const overlay = paramChartOverlayRef.current[paramId];
    const chartScoped = chartScopedParamOverridesRef.current[paramId];
    if (liveParam) {
      const merged = { ...liveParam, ...(overlay || {}), ...(chartScoped || {}) };
      return merged as ParameterInfo;
    }
    const historical = buildHistoricalParamConfig(paramId);
    return { ...historical, ...(overlay || {}), ...(chartScoped || {}) } as ParameterInfo;
  }, [parameters, buildHistoricalParamConfig, chartScopedSettingsVersion]);

  const createDatasetFromParamConfig = useCallback((paramConfig: ParameterInfo, forceVisible = false) => ({
    paramId: paramConfig.originalName,
    label: formatLegendLabel(paramConfig),
    data: [],
    borderColor: paramConfig.color,
    backgroundColor: paramConfig.color,
    pointBackgroundColor: paramConfig.color,
    pointBorderColor: paramConfig.color,
    borderWidth: 1.5,
    pointRadius: paramConfig.form === 1 ? 0 : 2,
    pointHoverRadius: 4,
    tension: paramConfig.form === 1 ? 0 : 0.2,
    stepped: paramConfig.form === 1 ? 'before' as const : false,
    spanGaps: true,
    fill: false,
    hidden: forceVisible ? false : !paramConfig.visible_on_chart,
    yAxisID: 'yPercentage',
  }), [formatLegendLabel]);

  /** Alle für Skalierung/Darstellung relevanten Felder — muss sich ändern, wenn Min/Max/Divisor/Form die Kurve beeinflussen */
  const legendParamChartKey = useMemo(
    () =>
      parameters
        .filter((p: any) => p.show_in_legend)
        .map(
          (p: any) => {
            const cfg = getParameterConfig(p.originalName);
            return `${p.originalName}:${cfg.color ?? ''}:${cfg.form ?? 0}:${cfg.visible_on_chart ?? true}:${cfg.divisor ?? ''}:${cfg.minValue ?? ''}:${cfg.maxValue ?? ''}:${cfg.unit ?? ''}`;
          }
        )
        .join('|'),
    [parameters, getParameterConfig]
  );

  // Process raw value with divisor
  const processRawValue = useCallback((paramId: string, rawY: number | string | undefined): number | null => {
    if (rawY === undefined || rawY === null) return null;
    
    const paramConfig = getParameterConfig(paramId);
    
    let yValue = parseFloat(rawY.toString());
    if (isNaN(yValue)) return null;
    
    if (paramConfig.divisor && paramConfig.divisor !== 0 && paramConfig.divisor !== 1) {
      yValue /= paramConfig.divisor;
    }
    
    return yValue;
  }, [getParameterConfig]);

  /** Y-Werte und Linienstil aus gespeicherten Rohwerten neu berechnen (z. B. nach Änderung von Min/Max/Divisor/Linientyp) */
  const remapAllChartDatasets = useCallback(
    (prevDatasets: any[]): any[] => {
      return prevDatasets.map((dataset: any) => {
        const paramId = dataset.paramId as string;
        const paramConfig = getParameterConfig(paramId);
        const remappedData = (dataset.data || []).map((pt: ChartDataPoint) => {
          let recomputedOriginal: number | null = null;
          if (pt.rawDeviceValue != null && Number.isFinite(pt.rawDeviceValue)) {
            recomputedOriginal = processRawValue(paramId, pt.rawDeviceValue);
          } else if (pt.originalY !== null && pt.originalY !== undefined) {
            recomputedOriginal = pt.originalY;
          }
          const newY = normalizeValue(recomputedOriginal, paramConfig);
          return { ...pt, y: newY, originalY: recomputedOriginal };
        });
        const shell = createDatasetFromParamConfig(paramConfig, true);
        return {
          ...dataset,
          label: shell.label,
          borderColor: shell.borderColor,
          backgroundColor: shell.backgroundColor,
          pointBackgroundColor: shell.pointBackgroundColor,
          pointBorderColor: shell.pointBorderColor,
          pointRadius: shell.pointRadius,
          tension: shell.tension,
          stepped: shell.stepped,
          spanGaps: shell.spanGaps,
          hidden: dataset.hidden,
          data: remappedData,
        };
      });
    },
    [getParameterConfig, normalizeValue, processRawValue, createDatasetFromParamConfig]
  );

  // Format value for display
  const formatDisplayValue = useCallback((paramId: string, value: number | null): string => {
    if (value === undefined || value === null || isNaN(value)) return '-';
    
    const paramConfig = getParameterConfig(paramId);
    
    let precision = 0;
    if (paramId === 'N') {
      precision = 0;
    } else if (paramConfig.unit === '%' || paramConfig.unit === '' || !paramConfig.unit) {
      precision = 0;
    } else {
      precision = 1;
    }
    
    const displayValue = value.toFixed(precision);
    const formatted = displayValue === '-0' || displayValue === '-0.0' ? 
                     Number(0).toFixed(precision) : displayValue;
    
    return formatted + (paramConfig.unit ? ` ${paramConfig.unit}` : '');
  }, [getParameterConfig]);

  // Initialize datasets based on visible parameters (only when parameters actually change)
  useEffect(() => {
    // While historical data is displayed, datasets are managed exclusively
    // by addHistoricalDataToChart() to avoid accidental resets.
    if (historicalDate !== null) {
      return;
    }

    const legendParams = parameters
      .map((p: any) => getParameterConfig(p.originalName))
      .filter((p: any) => p.show_in_legend);
    const legendParamsById = new Map(legendParams.map((p: any) => [p.originalName, p]));

    // Preserve current view range to avoid jumps when parameters change
    // ESPECIALLY important for historical mode
    const chart = chartRef.current;
    if (chart && chart.options?.scales?.x) {
      const currentRange = recordCurrentRange(chart);
      
      // Save range if we have a meaningful range OR we're in historical mode
      if ((currentRange.min !== undefined && currentRange.max !== undefined) || 
          isHistoricalMode || historicalDate !== null) {
        fixedRangeRef.current = currentRange;
        restoreRangeRef.current = true;
      }
    }
    
    // Nur neu bauen, wenn sich für die Legende relevante Parameter wirklich geändert haben
    if (legendParamChartKey === lastParameterConfigRef.current) {
      return;
    }

    lastParameterConfigRef.current = legendParamChartKey;

    const newDatasets = legendParams.map((param: any) => createDatasetFromParamConfig(param));

    // Preserve existing data when updating datasets (like legacy)
    setDatasets(prevDatasets => {
      const preservedDatasets = newDatasets.map((newDataset: any) => {
        const param = legendParamsById.get(newDataset.paramId);

        // First try to find in current datasets (most up-to-date)
        let existingDataset = prevDatasets.find((d: any) => d.paramId === newDataset.paramId);

        // Fallback to cache if not found in current datasets
        if (!existingDataset) {
          existingDataset = datasetCacheRef.current.find((d: any) => d.paramId === newDataset.paramId);
        }

        let nextData = existingDataset?.data?.length ? [...existingDataset.data] : [];

        if (nextData.length > 0 && param) {
          nextData = nextData.map((pt: ChartDataPoint) => {
            let recomputedOriginal: number | null = null;
            if (pt.rawDeviceValue != null && Number.isFinite(pt.rawDeviceValue)) {
              recomputedOriginal = processRawValue(param.originalName, pt.rawDeviceValue);
            } else if (pt.originalY !== null && pt.originalY !== undefined) {
              recomputedOriginal = pt.originalY;
            }
            const newY = normalizeValue(recomputedOriginal, param);
            return { ...pt, y: newY, originalY: recomputedOriginal };
          });
        }

        if (nextData.length > 0) {
          return { ...newDataset, data: nextData };
        }

        return newDataset;
      });

      // Update cache with preserved datasets
      datasetCacheRef.current = preservedDatasets;

      return preservedDatasets;
    });
  }, [parameters, getParameterConfig, createDatasetFromParamConfig, isHistoricalMode, historicalDate, legendParamChartKey, processRawValue, normalizeValue]);

  // Geloggte Daten: Min/Max/Divisor/Linientyp sofort auf alle bereits geladenen Punkte anwenden
  useEffect(() => {
    if (historicalDate === null) {
      lastHistoricalChartKeyRef.current = '';
      return;
    }
    if (legendParamChartKey === lastHistoricalChartKeyRef.current) {
      return;
    }
    lastHistoricalChartKeyRef.current = legendParamChartKey;

    setDatasets(prev => {
      if (prev.length === 0) return prev;
      const remapped = remapAllChartDatasets(prev);
      datasetCacheRef.current = remapped;
      return remapped;
    });
    scheduleChartUpdate();
  }, [historicalDate, legendParamChartKey, remapAllChartDatasets, scheduleChartUpdate]);

  // Overlay aus Modal entfernen, sobald parameters dieselben Werte haben
  useEffect(() => {
    const ids = Object.keys(paramChartOverlayRef.current);
    for (const id of ids) {
      const o = paramChartOverlayRef.current[id];
      const live = parameters.find(p => p.originalName === id);
      if (!live || !o) continue;
      let absorbed = true;
      for (const key of Object.keys(o)) {
        if ((live as any)[key] !== (o as any)[key]) {
          absorbed = false;
          break;
        }
      }
      if (absorbed) delete paramChartOverlayRef.current[id];
    }
  }, [parameters]);

  useEffect(() => {
    const onParamSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ parameterName?: string; updates?: Partial<ParameterInfo> }>).detail;
      if (!detail?.parameterName || !detail.updates || Object.keys(detail.updates).length === 0) return;
      const { parameterName, updates } = detail;
      paramChartOverlayRef.current[parameterName] = {
        ...paramChartOverlayRef.current[parameterName],
        ...updates,
      };
      setDatasets(prev => {
        if (!prev.some((ds: any) => ds.paramId === parameterName)) return prev;
        const out = remapAllChartDatasets(prev);
        datasetCacheRef.current = out;
        return out;
      });
      scheduleChartUpdate();
    };
    window.addEventListener(PARAMETER_SETTINGS_CHANGED_EVENT, onParamSettingsChanged as EventListener);
    return () => window.removeEventListener(PARAMETER_SETTINGS_CHANGED_EVENT, onParamSettingsChanged as EventListener);
  }, [remapAllChartDatasets, scheduleChartUpdate]);

  // Clean up old chart data on app start (runs once on mount, regardless of deviceId)
  useEffect(() => {
    if (!isMainChart) return;
    clearOldChartData();
    console.log('[RealtimeChart] Cleaned up old chart data on app start');
  }, [isMainChart]); // Only runs once when component mounts

  // Load chart data from localStorage on mount (only for main realtime chart)
  // Step 1: Load data into ref immediately on mount
  useEffect(() => {
    if (!isMainChart || isHistoricalMode || !deviceId || deviceId === 'N/A') return;
    if (storedDataRef.current !== null) return; // Already loaded
    
    const storedData = loadChartData(deviceId);
    if (!storedData || storedData.datasets.length === 0) {
      storedDataRef.current = false; // Mark as "no data"
      sessionStartTimestampRef.current = Date.now();
      console.log('[RealtimeChart] No stored chart data found for device:', deviceId);
      return;
    }
    
    console.log('[RealtimeChart] Loaded stored chart data:', {
      datasets: storedData.datasets.length,
      totalPoints: storedData.datasets.reduce((s, d) => s + (d.data?.length || 0), 0),
      lastTimestamp: new Date(storedData.lastTimestamp).toISOString(),
      gaps: storedData.gaps.length,
    });
    
    // Record session gap (time between last save and now)
    const now = Date.now();
    if (enableGapAnnotations && storedData.lastTimestamp > 0 && now - storedData.lastTimestamp > 30000) {
      // More than 30 seconds gap - record it
      const newGap = { start: storedData.lastTimestamp, end: now };
      gapsRef.current = [...storedData.gaps, newGap];
      addGapToChartData(deviceId, storedData.lastTimestamp, now);
      console.log('[RealtimeChart] Recorded session gap:', {
        start: new Date(storedData.lastTimestamp).toISOString(),
        end: new Date(now).toISOString(),
        durationMinutes: ((now - storedData.lastTimestamp) / 60000).toFixed(1),
      });
    } else {
      gapsRef.current = enableGapAnnotations ? storedData.gaps : [];
    }
    
    // Restore lastKnownValues from stored data
    storedData.datasets.forEach(sd => {
      if (sd.data.length > 0) {
        const lastPoint = sd.data[sd.data.length - 1];
        if (lastPoint.originalY !== null) {
          lastKnownValues.current[sd.paramId] = lastPoint.originalY;
        }
      }
    });
    
    storedDataRef.current = storedData;
    sessionStartTimestampRef.current = now;
  }, [deviceId, isMainChart, isHistoricalMode]);

  // Step 2: Apply stored data to datasets once they are initialized
  useEffect(() => {
    if (!isMainChart || isHistoricalMode) return;
    if (dataLoadedFromStorageRef.current) return; // Already applied
    if (storedDataRef.current === null) return; // Not loaded yet
    if (storedDataRef.current === false) {
      // No stored data, mark as done
      dataLoadedFromStorageRef.current = true;
      return;
    }
    if (datasets.length === 0) return; // Datasets not initialized yet
    
    const storedData = storedDataRef.current;
    
    console.log('[RealtimeChart] Applying stored data to datasets...');
    
    // Merge stored data with current datasets; Skalierung aus aktuellen Parametern anwenden
    setDatasets(prevDatasets => {
      const mergedDatasets = prevDatasets.map(dataset => {
        const storedDataset = storedData.datasets.find((sd: any) => sd.paramId === dataset.paramId);
        if (storedDataset && storedDataset.data.length > 0) {
          // Use stored data as the starting point
          return { ...dataset, data: [...storedDataset.data] };
        }
        return dataset;
      });

      const remapped = remapAllChartDatasets(mergedDatasets);
      datasetCacheRef.current = remapped;
      console.log('[RealtimeChart] Merged stored data with datasets:', {
        totalPoints: remapped.reduce((s, d) => s + (d.data?.length || 0), 0),
      });
      return remapped;
    });
    
    dataLoadedFromStorageRef.current = true;
    storedDataRef.current = null; // Clear to free memory
    
    // Adjust chart view to show loaded data
    setTimeout(() => {
      const chart = chartRef.current;
      if (chart) {
        // Find data range
        let minTs = Infinity;
        let maxTs = -Infinity;
        datasetCacheRef.current.forEach(ds => {
          if (ds.data && ds.data.length > 0) {
            minTs = Math.min(minTs, ds.data[0].x);
            maxTs = Math.max(maxTs, ds.data[ds.data.length - 1].x);
          }
        });
        
        if (minTs < Infinity && maxTs > -Infinity) {
          // Show last 10 minutes by default, or all data if less
          const windowMs = 10 * 60 * 1000;
          const rangeStart = Math.max(minTs, maxTs - windowMs);
          setScaleRangeBoth(chart, rangeStart, maxTs + 5000);
          chart.update('none');
          console.log('[RealtimeChart] Adjusted chart view to show loaded data');
        }
      }
    }, 150);
  }, [deviceId, isMainChart, isHistoricalMode, datasets.length, remapAllChartDatasets]);

  // Save chart data to localStorage periodically
  useEffect(() => {
    if (!isMainChart || isHistoricalMode || !deviceId || deviceId === 'N/A') return;
    // Don't save when viewing historical data (backup exists) or historical date is set
    if (historicalDate !== null || liveDataBackupRef.current !== null) return;
    if (datasets.length === 0 || !dataLoadedFromStorageRef.current) return;
    
    // Check if we have any actual data points
    const hasData = datasets.some(ds => ds.data && ds.data.length > 0);
    if (!hasData) return;
    
    // Throttle saves
    const now = Date.now();
    if (now - lastSaveTimestampRef.current < SAVE_INTERVAL_MS) return;
    
    lastSaveTimestampRef.current = now;
    saveChartData(deviceId, datasets, gapsRef.current);
  }, [datasets, deviceId, isMainChart, isHistoricalMode, historicalDate]);

  // Save on unmount
  useEffect(() => {
    return () => {
      // Only save if we're in live mode (no historical data viewing)
      const isViewingHistorical = historicalDate !== null || liveDataBackupRef.current !== null;
      if (isMainChart && deviceId && deviceId !== 'N/A' && !isHistoricalMode && !isViewingHistorical) {
        const currentDatasets = datasetCacheRef.current;
        if (currentDatasets.length > 0) {
          saveChartData(deviceId, currentDatasets, gapsRef.current);
          console.log('[RealtimeChart] Saved chart data on unmount');
        }
      }
    };
  }, [deviceId, isMainChart, isHistoricalMode, historicalDate]);

  // Apply stored range after datasets are rendered
  useLayoutEffect(() => {
    if (!restoreRangeRef.current) return;

    const chart = chartRef.current;
    if (chart && chart.options?.scales?.x) {
      // Enhanced restore logic: always apply if we have saved range and we're in historical mode
      const shouldApplyRange = (
        (fixedRangeRef.current.min !== undefined && fixedRangeRef.current.max !== undefined) ||
        isHistoricalMode ||
        historicalDate !== null
      );
      
      if (shouldApplyRange) {
        applyFixedRange(chart, fixedRangeRef.current);
        chart.update('none');
      }
    }

    restoreRangeRef.current = false;
  }, [datasets, isHistoricalMode, historicalDate]);

  // Update chart data with new values (optimized like legacy)
  useEffect(() => {
    if (!currentData || Object.keys(currentData).length === 0) {
      return;
    }
    
    if (isChartPaused) {
      return;
    }

    // FIXED: Only skip updates when EXPLICITLY in historical mode (historicalDate is set)
    // Don't block based on isHistoricalMode flag - it may not be cleared properly
    // Allow updates to flow through unless we're actively viewing historical data
    if (historicalDate !== null) {
      return;
    }
    
    const now = Date.now();

    // Generate timestamp: use id_timestamp if available, otherwise use client time
    let timestamp: number;
    let usingIdTimestamp = false;
    if (currentData.id_timestamp) {
      const parsedIdTimestamp = parseFloat(currentData.id_timestamp.toString());
      if (Number.isFinite(parsedIdTimestamp)) {
        timestamp = parsedIdTimestamp * 1000;
        usingIdTimestamp = true;
      } else {
        timestamp = now;
      }
    } else {
      timestamp = now;
    }

    if (lastGeneratedTimestamp.current !== 0) {
      const sinceLast = timestamp - lastGeneratedTimestamp.current;
      if (sinceLast <= 0) {
        return;
      }
      const effectiveMinInterval = Math.max(
        0,
        MIN_CHART_INTERVAL_MS - CHART_INTERVAL_TOLERANCE_MS,
      );
      const minInterval = usingIdTimestamp
        ? Math.min(effectiveMinInterval, ID_TIMESTAMP_MIN_INTERVAL_MS)
        : effectiveMinInterval;
      if (sinceLast < minInterval) {
        return;
      }
    }

    lastGeneratedTimestamp.current = timestamp;

    // Efficient update like legacy - only update datasets that have changed parameters
    setDatasets(prevDatasets => {
      if (prevDatasets.length === 0) return prevDatasets;
      
      let hasChanges = false;
      
      const updatedDatasets = prevDatasets.map((dataset: any) => {
        const paramId = dataset.paramId;
        const paramConfig = getParameterConfig(paramId);

        let originalY: number | null = null;
        let rawDeviceValue: number | null | undefined = undefined;
        let hasNewValue = false;
        
        // Get current value or use last known value (like legacy)
        if (currentData.hasOwnProperty(paramId)) {
          const rawValue = currentData[paramId];
          if (typeof rawValue === 'number' || typeof rawValue === 'string') {
            const parsedRaw = parseFloat(rawValue.toString());
            if (Number.isFinite(parsedRaw)) {
              rawDeviceValue = parsedRaw;
            }
            originalY = processRawValue(paramId, rawValue);
            if (originalY !== null) {
              lastKnownValues.current[paramId] = originalY;
              hasNewValue = true;
            }
          }
        } else if (lastKnownValues.current.hasOwnProperty(paramId)) {
          originalY = lastKnownValues.current[paramId];
        }

        // Always push a data point (using last known value when no new reading)
        // This matches the behaviour of the legacy implementation and prevents
        // the line from "freezing" whenever the device omits a parameter in a
        // particular payload.
        // NOTE: we still rely on lastKnownValues to carry the previous reading
        // forward, so the visual remains continuous even with sparse updates.
        const normalizedY = normalizeValue(originalY, paramConfig);



        // Add new data point
        const newData = [...dataset.data];
        newData.push({
          x: timestamp,
          y: normalizedY,
          originalY: originalY,
          ...(rawDeviceValue !== undefined ? { rawDeviceValue } : {}),
        });

        // Periodic pruning instead of per-point shift for performance
        if (newData.length > MAX_DATA_POINTS + 50) {
          const removeCount = newData.length - MAX_DATA_POINTS;
          newData.splice(0, removeCount);
        }

        hasChanges = true;
        return {
          ...dataset,
          data: newData,
        };
      });
      
      // Update cache and refresh chart only if we have changes
      if (hasChanges) {
        datasetCacheRef.current = updatedDatasets;
        // Force chart redraw to ensure the new points are visible
        scheduleChartUpdate();
      }
      
      // Return updated datasets only if there are changes (CRITICAL FIX!)
      return hasChanges ? updatedDatasets : prevDatasets;
    });
  }, [currentData, isChartPaused, historicalDate, processRawValue, normalizeValue, scheduleChartUpdate, getParameterConfig]); // FIXED: removed isHistoricalMode dependency

  // Sync historical date with isHistoricalMode prop (only clear when explicitly exiting historical mode)
  useEffect(() => {
    // Only clear historical date if isHistoricalMode was true and now becomes false
    if (!isHistoricalMode && historicalDate !== null) {
      // Additional check: only clear if we're not currently loading historical data
      if (!isLoadingHistoricalRef.current) {
        setHistoricalDate(null);
        isLoadingHistoricalRef.current = false;
      }
    }
  }, [isHistoricalMode]); // Remove historicalDate from dependencies to avoid clearing during load

  // getValuesAtTimestamp from hook

  // Update cursor info with colored display
  const updateCursorInfo = useCallback((markerData: ChartMarker | null) => {
    if (!markerData || markerData.timestamp === null) {
      setCursorInfo(DEFAULT_CURSOR_INFO);
      return;
    }
    
    const time = formatDateWithUserTimezone(markerData.timestamp, 'de-DE', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });
    
    let info = `Time: ${time}`;
    let count = 0;
    
    for (const paramId in markerData.values) {
      const dataset = datasets.find((d: any) => d.paramId === paramId);
      if (dataset && !dataset.hidden) {
        const paramConfig = getParameterConfig(paramId);
        if (paramConfig) {
          const formattedVal = formatDisplayValue(paramId, markerData.values[paramId]);
          info += ` | ${paramConfig.displayName}: ${formattedVal}`;
          count++;
        }
      }
    }
    
    if (count === 0 && markerData.timestamp) {
      info += ' | No data at this point for visible series.';
    }
    
    setCursorInfo(info);
  }, [datasets, formatDisplayValue, getParameterConfig]);

  // Update marker info display with colored parameters
  const updateMarkerInfo = useCallback((markerIndex: number) => {
    const markerData = markers[markerIndex];
    const markerLabel = markerIndex === 0 ? 'Left' : 'Right';
    
    if (!markerData || markerData.timestamp === null) {
      setMarkerInfo(prev => {
        const newInfo = [...prev];
        newInfo[markerIndex] = `${markerLabel} Marker: (click on chart to set)`;
        return newInfo;
      });
      return;
    }
    
    const time = formatDateWithUserTimezone(markerData.timestamp, 'de-DE', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });
    
    let info = `${markerLabel} Marker: ${time}`;
    let count = 0;
    
    for (const paramId in markerData.values) {
      const dataset = datasets.find((d: any) => d.paramId === paramId);
      if (dataset && !dataset.hidden) {
        const paramConfig = getParameterConfig(paramId);
        if (paramConfig) {
          const formattedVal = formatDisplayValue(paramId, markerData.values[paramId]);
          info += ` | ${paramConfig.displayName}: ${formattedVal}`;
          count++;
        }
      }
    }
    
    if (count === 0 && markerData.timestamp) {
      info += ' | No data at marker point for visible series.';
    }
    
    setMarkerInfo(prev => {
      const newInfo = [...prev];
      newInfo[markerIndex] = info;
      return newInfo;
    });
  }, [datasets, formatDisplayValue, markers, getParameterConfig]);

  // Update analysis results based on markers
  const updateAnalysisResults = useCallback(() => {
    if (!markers[0].timestamp || !markers[1].timestamp) {
      setAnalysisResults(DEFAULT_ANALYSIS_TEXT);
      return;
    }
    
    const timeDiff = Math.abs(markers[1].timestamp - markers[0].timestamp);
    const timeDiffSec = Math.round(timeDiff / 1000);
    const timeDiffMin = Math.round(timeDiffSec / 60 * 10) / 10;
    
    let analysisText = `Time difference: ${timeDiffSec}s (${timeDiffMin}min)`;
    
    // Calculate value differences for visible parameters
    const valueDiffs: string[] = [];
    const allParamIds = new Set([
      ...Object.keys(markers[0].values),
      ...Object.keys(markers[1].values)
    ]);
    
    allParamIds.forEach(paramId => {
      const dataset = datasets.find((d: any) => d.paramId === paramId);
      if (!dataset || dataset.hidden) return;
      
      const paramConfig = getParameterConfig(paramId);
      if (!paramConfig) return;
      
      const val0 = markers[0].values[paramId];
      const val1 = markers[1].values[paramId];
      
      if (val0 !== undefined && val1 !== undefined) {
        const diff = val1 - val0;
        const formattedDiff = formatDisplayValue(paramId, Math.abs(diff));
        const sign = diff >= 0 ? '+' : '-';
        valueDiffs.push(`${paramConfig.displayName}: ${sign}${formattedDiff}`);
      }
    });
    
    if (valueDiffs.length > 0) {
      analysisText += ` | Δ: ${valueDiffs.slice(0, 3).join(', ')}`;
      if (valueDiffs.length > 3) {
        analysisText += ` (${valueDiffs.length - 3} more...)`;
      }
    }
    
    setAnalysisResults(analysisText);
  }, [markers, datasets, formatDisplayValue, getParameterConfig]);

  // clearMarkers from hook
 
  // Helper to persist the current axis range when auto-scroll is disabled
  const saveFixedRange = useCallback(() => {
    const chart = chartRef.current;
    if (chart && chart.options?.scales?.x) {
      fixedRangeRef.current = recordCurrentRange(chart);
    }
  }, []);
 
  // Markers and cursor via hook (initialized here after dependencies)
  const {
    markers: markersState,
    setMarkers: setMarkersState,
    cursorMarkerRef,
    getValuesAtTimestamp,
    clearMarkers,
    zoomToMarkers,
    handleChartClick,
  } = useMarkers({
    datasets,
    parameters,
    findClosestIndex,
    closeValueThresholdMs: CLOSE_VALUE_THRESHOLD_MS,
    scheduleChartUpdate,
    saveFixedRange,
    chartRef,
    isHistoricalMode,
    autoScroll,
    setUserHasScrolled,
    setAutoScroll,
  });
  // keep local state vars in sync with hook (retain existing variable names)
  const markersHookValue = markersState;
  if (markers !== markersHookValue) {
    // reflect hook state outward for existing uses
    // minimal sync to preserve references used below
    // eslint-disable-next-line react-hooks/rules-of-hooks
    setMarkers(markersHookValue);
  }
  const setMarkersProxy = setMarkersState;

  // zoomToMarkers from hook

  // Update marker info displays when markers change
  useEffect(() => {
    updateMarkerInfo(0);
    updateMarkerInfo(1);
    updateAnalysisResults();
    const chart = chartRef.current;
    if (chart) {
      scheduleChartUpdate();
    }
  }, [markers, updateMarkerInfo, updateAnalysisResults, scheduleChartUpdate]);

  // Auto-scroll logic according to colleague's requirements
  const updateChartView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || !chart.options.scales.x) {
      return;
    }

    const currentRange = getScaleRange(chart);
    let lastTimestamp = 0;
    let hasVisibleData = false;

    // Use cached datasets instead of state to prevent dependency issues
    const currentDatasets = datasetCacheRef.current;
    
    // Find latest timestamp from visible datasets
    currentDatasets.forEach((ds: any) => {
      if (!ds.hidden && ds.data.length > 0) {
        const lastPoint = ds.data[ds.data.length - 1];
        if (lastPoint && lastPoint.x !== undefined) {
          hasVisibleData = true;
          lastTimestamp = Math.max(lastTimestamp, lastPoint.x);
        }
      }
    });

    // Set initial view only after the first data arrives
    if (currentRange.min === undefined || currentRange.max === undefined) {
      if (!firstDataSeenRef.current) {
        scheduleChartUpdate();
        return;
      }
      if (
        fixedRangeRef.current.min !== undefined ||
        fixedRangeRef.current.max !== undefined
      ) {
        if (
          fixedRangeRef.current.min !== undefined &&
          fixedRangeRef.current.max !== undefined
        ) {
          setScaleRangeBoth(chart, fixedRangeRef.current.min, fixedRangeRef.current.max);
        } else {
          setInitialChartView();
        }
      } else {
        setInitialChartView();
      }
      scheduleChartUpdate();
      return;
    }

    const lockActive =
      !autoScroll &&
      initialRangeLockUntilRef.current !== null &&
      Date.now() < (initialRangeLockUntilRef.current as number) &&
      !userHasScrolled;
    if (lockActive) {
      if (
        fixedRangeRef.current.min !== undefined &&
        fixedRangeRef.current.max !== undefined
      ) {
        setScaleRangeBoth(chart, fixedRangeRef.current.min, fixedRangeRef.current.max);
      }
      scheduleChartUpdate();
      return;
    }

    // No data available - don't update view
    if (!hasVisibleData) {
      scheduleChartUpdate();
      return;
    }

    // AUTO-SCROLL LOGIC (three modes)
    if (autoScroll && !isHistoricalMode && !isChartPaused) {
      const mode = autoScrollMode;
      
      // If auto-scroll is armed (e.g., after clear), force-apply range once and disarm
      if (autoScrollArmedRef.current) {
        if (!hasVisibleData) {
          scheduleChartUpdate();
          return;
        }
        if (mode === 'edge') {
          let startTs = sessionStartTsRef.current;
          if (startTs === null) {
            datasetCacheRef.current.forEach((ds: any) => {
              if (!ds.hidden && ds.data && ds.data.length > 0) {
                const ts = ds.data[0]?.x;
                if (ts !== undefined && ts !== null) {
                  startTs = (startTs === null) ? ts : Math.min(startTs as number, ts);
                }
              }
            });
          }
          if (startTs !== null) {
            let newMax = lastTimestamp;
            if (!isFinite(newMax) || newMax <= (startTs as number)) newMax = (startTs as number) + 1000;
            userLockedViewportWhileAutoScrollRef.current = false;
            setScaleRangeBoth(chart, startTs as number, newMax);
          }
        } else if (mode === 'discard_left') {
          const windowSizeMs = autoScrollCustomScale * 1000;
          const newMax = lastTimestamp;
          const newMin = newMax - windowSizeMs;
          userLockedViewportWhileAutoScrollRef.current = false;
          setScaleRangeBoth(chart, newMin, newMax);
        } else if (mode === 'center') {
          const windowSizeMs = autoScrollCustomScale * 1000;
          const newMin = lastTimestamp - windowSizeMs / 2;
          const newMax = lastTimestamp + windowSizeMs / 2;
          userLockedViewportWhileAutoScrollRef.current = false;
          setScaleRangeBoth(chart, newMin, newMax);
        }
        autoScrollArmedRef.current = false;
        scheduleChartUpdate();
        return;
      }
      
      if (mode === 'edge') {
        // Edge mode: left bound sticks to the first point of the current live session
        let startTs = sessionStartTsRef.current;
        if (startTs === null) {
          // Fallback: compute earliest visible point
          datasetCacheRef.current.forEach((ds: any) => {
            if (!ds.hidden && ds.data && ds.data.length > 0) {
              const ts = ds.data[0]?.x;
              if (ts !== undefined && ts !== null) {
                startTs = (startTs === null) ? ts : Math.min(startTs as number, ts);
              }
            }
          });
        }
        // If still unknown, do nothing
        if (startTs === null) {
          scheduleChartUpdate();
          return;
        }
        // Avoid zero-width window
        let newMax = lastTimestamp;
        if (!isFinite(newMax) || newMax <= (startTs as number)) newMax = (startTs as number) + 1000;
 
        if (userLockedViewportWhileAutoScrollRef.current) {
          const unlockPadding = 0;
          if (hasVisibleData && lastTimestamp >= (currentRange.max as number) - unlockPadding) {
            userLockedViewportWhileAutoScrollRef.current = false;
            setScaleRangeBoth(chart, startTs as number, newMax);
          }
          scheduleChartUpdate();
        } else {
          setScaleRangeBoth(chart, startTs as number, newMax);
          scheduleChartUpdate();
        }
      } else if (mode === 'discard_left') {
        const windowSizeMs = autoScrollCustomScale * 1000;
        const newMax = lastTimestamp;
        const newMin = newMax - windowSizeMs;
        setScaleRangeBoth(chart, newMin, newMax);
        scheduleChartUpdate();
      } else if (mode === 'center') {
        const windowSizeMs = autoScrollCustomScale * 1000;
        const newMin = lastTimestamp - windowSizeMs / 2;
        const newMax = lastTimestamp + windowSizeMs / 2;
        setScaleRangeBoth(chart, newMin, newMax);
        scheduleChartUpdate();
      }
    } else {
      // Auto-scroll disabled or not appropriate - keep current range fixed
      if (
        fixedRangeRef.current.min !== undefined &&
        fixedRangeRef.current.max !== undefined
      ) {
        setScaleRangeBoth(chart, fixedRangeRef.current.min, fixedRangeRef.current.max);
      }
      scheduleChartUpdate();
    }
  }, [autoScroll, isHistoricalMode, isChartPaused, userHasScrolled, scheduleChartUpdate, autoScrollMode, autoScrollCustomScale]);

  // Auto-scroll toggle handler (colleague's requirements)
  const handleAutoScrollToggle = useCallback((enabled: boolean) => {
    setAutoScroll(enabled);
    
    if (enabled) {
      setUserHasScrolled(false);
      initialRangeLockUntilRef.current = null;
      fixedRangeRef.current = { min: undefined, max: undefined };
      // Arm auto-scroll so next data tick applies the correct window
      autoScrollArmedRef.current = true;
      
      const chart = chartRef.current;
      if (!chart || !chart.options.scales.x) return;
      
      const currentRange = getScaleRange(chart);
      let lastTimestamp = 0;
      
      const currentDatasets = datasetCacheRef.current;
      currentDatasets.forEach((ds: any) => {
        if (!ds.hidden && ds.data.length > 0) {
          const lastPoint = ds.data[ds.data.length - 1];
          if (lastPoint && lastPoint.x) {
            lastTimestamp = Math.max(lastTimestamp, lastPoint.x);
          }
        }
      });
 
      if (lastTimestamp > 0 && currentRange.min !== undefined && currentRange.max !== undefined) {
        if (autoScrollMode === 'edge') {
          // Edge mode: anchor to session start → last point
          let startTs = sessionStartTsRef.current;
          if (startTs === null) {
            // Fallback to earliest visible point
            currentDatasets.forEach((ds: any) => {
              if (!ds.hidden && ds.data && ds.data.length > 0) {
                const ts = ds.data[0]?.x;
                if (ts !== undefined && ts !== null) {
                  startTs = (startTs === null) ? ts : Math.min(startTs as number, ts);
                }
              }
            });
          }
          if (startTs !== null) {
            userLockedViewportWhileAutoScrollRef.current = false;
            let newMax = lastTimestamp;
            if (!isFinite(newMax) || newMax <= (startTs as number)) newMax = (startTs as number) + 1000;
            setScaleRangeBoth(chart, startTs as number, newMax);
          }
        } else if (autoScrollMode === 'discard_left') {
          const windowSizeMs = autoScrollCustomScale * 1000;
          const newMax = lastTimestamp;
          const newMin = newMax - windowSizeMs;
          setScaleRangeBoth(chart, newMin, newMax);
        } else if (autoScrollMode === 'center') {
          const windowSizeMs = autoScrollCustomScale * 1000;
          const newMin = lastTimestamp - windowSizeMs / 2;
          const newMax = lastTimestamp + windowSizeMs / 2;
          setScaleRangeBoth(chart, newMin, newMax);
        }
        scheduleChartUpdate();
      }
    } else {
      // Auto-scroll turned OFF - mark as user-scrolled to prevent auto-updates
      setUserHasScrolled(true);
      const chart = chartRef.current;
 
      if (chart && chart.options.scales?.x) {
        let range = recordCurrentRange(chart);
        if (range.min === undefined || range.max === undefined) {
          const now = Date.now();
          range = {
            min: now - (INITIAL_WINDOW_MS / 2),
            max: now + (INITIAL_WINDOW_MS / 2),
          };
        }
        fixedRangeRef.current = range;
      } else {
        const now = Date.now();
        fixedRangeRef.current = {
          min: now - (INITIAL_WINDOW_MS / 2),
          max: now + (INITIAL_WINDOW_MS / 2),
        };
      }
      autoScrollArmedRef.current = false;
 
    }
  }, [scheduleChartUpdate, autoScrollMode, autoScrollCustomScale]);

  // Set initial chart view (colleague's requirements: always center with 2min window)
  const setInitialChartView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || !chart.options.scales.x) return;

    // Always center on current time with 2-minute window
    const now = Date.now();
    const initialMin = now - (INITIAL_WINDOW_MS / 2);
    const initialMax = now + (INITIAL_WINDOW_MS / 2);
    setScaleRangeBoth(chart, initialMin, initialMax);

    // Do NOT force-enable autoscroll here. Respect current setting.
    setUserHasScrolled(false);

    // If autoscroll is disabled at start, persist this initial range so the view remains fixed
    if (!autoScroll) {
      fixedRangeRef.current = { min: initialMin, max: initialMax };
    } else {
      // When autoscroll is enabled, we keep range unfixed and lock viewport until right edge is reached
      fixedRangeRef.current = { min: undefined, max: undefined };
      userLockedViewportWhileAutoScrollRef.current = true;
    }

    scheduleChartUpdate();
  }, [autoScroll, scheduleChartUpdate]);

  // Update chart view when data changes (like legacy) - with stable dependencies and throttling
  const updateChartViewRef = useRef(updateChartView);
  updateChartViewRef.current = updateChartView;
  
  // Initialize chart view when device connects
  useLayoutEffect(() => {
    if (!deviceId) return;

    console.log(`[Chart]  Device changed to ${deviceId}, clearing ALL state for fresh start`);

    // LEGACY: clear persisted cache on connect/disconnect to avoid stale points
    const previousDeviceId = lastDeviceIdRef.current;
    if (previousDeviceId && previousDeviceId !== deviceId && previousDeviceId !== 'N/A') {
      clearStoredChartData(previousDeviceId);
      gapsRef.current = [];
    }
    if (deviceId && deviceId !== 'N/A') {
      clearStoredChartData(deviceId);
      storedDataRef.current = false;
      dataLoadedFromStorageRef.current = false;
      sessionStartTimestampRef.current = Date.now();
    }
    lastDeviceIdRef.current = deviceId ?? null;

    // CRITICAL FIX: Clear ALL chart data and state when device changes
    // This prevents showing data from previous device
    setDatasets(prev => prev.map(dataset => ({ ...dataset, data: [] })));
    datasetCacheRef.current = [];
    lastKnownValues.current = {};
    lastGeneratedTimestamp.current = 0;
    
    // Clear markers
    setMarkers(createEmptyMarkers());
    
    // Clear historical mode
    setHistoricalDate(null);
    isLoadingHistoricalRef.current = false;

    // Reset flags; wait for first data to set initial view and lock
    firstDataSeenRef.current = false;
    initialRangeLockUntilRef.current = null;
    setUserHasScrolled(false);
    fixedRangeRef.current = { min: undefined, max: undefined };
    sessionStartTsRef.current = null;
    // If auto-scroll is enabled, arm it for the next incoming data
    autoScrollArmedRef.current = autoScrollEnabledRef.current;
    
    console.log(`[Chart] ✅ State cleared, ready for new device data`);
  }, [deviceId]);

  // Start initial 2-minute lock only after first points appear
  useEffect(() => {
    if (firstDataSeenRef.current) return;
    // Only apply this for live mode
    if (isHistoricalMode || historicalDate !== null) return;
    const hasData = datasetCacheRef.current.some((ds: any) => !ds.hidden && ds.data.length > 0);
    if (!hasData) return;

    // Determine the earliest visible data timestamp
    let firstTimestamp: number | undefined = undefined;
    datasetCacheRef.current.forEach((ds: any) => {
      if (!ds.hidden && ds.data && ds.data.length > 0) {
        const ts = ds.data[0]?.x;
        if (ts !== undefined && ts !== null) {
          firstTimestamp = firstTimestamp === undefined ? ts : Math.min(firstTimestamp as number, ts);
        }
      }
    });

    const chart = chartRef.current;
    if (!chart || !chart.options?.scales?.x) return;

    // If we have a first timestamp, start the window exactly at it; otherwise fallback to current time
    const startTs = (firstTimestamp !== undefined ? firstTimestamp : Date.now());
    // Also capture as session start for edge mode logic
    sessionStartTsRef.current = startTs;
    const initialMin = startTs;
    const initialMax = startTs + INITIAL_WINDOW_MS;
    setScaleRangeBoth(chart, initialMin, initialMax);

    // Respect current autoscroll setting
    setUserHasScrolled(false);
    if (!autoScroll) {
      fixedRangeRef.current = { min: initialMin, max: initialMax };
    } else {
      fixedRangeRef.current = { min: undefined, max: undefined };
      // Keep viewport locked until right edge is reached
      userLockedViewportWhileAutoScrollRef.current = true;
    }

    firstDataSeenRef.current = true;
    initialRangeLockUntilRef.current = Date.now() + 2 * 60 * 1000;
    scheduleChartUpdate();

    // If auto-scroll is enabled and armed, immediately apply the autoscroll range via view update
    if (autoScrollEnabledRef.current && autoScrollArmedRef.current) {
      try { updateChartViewRef.current(); } catch {}
    }
  }, [datasets, autoScroll, isHistoricalMode, historicalDate, setInitialChartView, scheduleChartUpdate]);

  // Update chart view only when datasets actually change
  useLayoutEffect(() => {
    if (!isChartPaused && datasetCacheRef.current.length > 0) {
      // Delay to ensure chart instance has applied new datasets before updating view
      const id = setTimeout(() => {
        updateChartViewRef.current();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [isChartPaused, datasets, autoScroll, userHasScrolled]);

  // Handle zoom level changes (like legacy)
  const handleZoomChange = useCallback((zoomValue: number) => {
    const chart = chartRef.current;
    if (!chart?.options?.scales?.x) return;

    let { min, max } = getScaleRange(chart);
    if (min === undefined || max === undefined) {
      const now = Date.now();
      max = now;
      min = now - INITIAL_WINDOW_MS;
    }

    const center = ((min as number) + (max as number)) / 2;
    const minWindowMs = 30 * 1000; // 30 seconds
    const maxWindowMs = 3 * 60 * 60 * 1000; // 3 hours

    // Logarithmic scale for better control (like legacy)
    const logMin = Math.log(minWindowMs);
    const logMax = Math.log(maxWindowMs);
    const normalizedSlider = (100 - zoomValue) / 99; // 100 = max zoom in (min window)
    const newWindowSize = Math.exp(logMin + normalizedSlider * (logMax - logMin));

    const newMin = center - newWindowSize / 2;
    const newMax = center + newWindowSize / 2;
    setScaleRangeBoth(chart, newMin, newMax);

    setUserHasScrolled(true);
    // If autoScroll is active, keep it but lock the viewport until latest reaches the right edge
    if (autoScroll) {
      userLockedViewportWhileAutoScrollRef.current = true;
      scheduleChartUpdate();
    } else {
      // Auto-scroll is off: keep fixed range in sync
      scheduleChartUpdate();
      saveFixedRange();
    }
  }, [autoScroll, saveFixedRange, scheduleChartUpdate]);

  // Navigate left/right in chart
  const handleNavigateLeft = useCallback(() => {
    const chart = chartRef.current;
    if (!chart?.options?.scales?.x) return;

    const { min, max } = getScaleRange(chart);
    if (min === undefined || max === undefined) return;

    const windowSize = (max as number) - (min as number);
    const step = windowSize * 0.25; // Move 25% of current window

    setScaleRangeBoth(chart, (min as number) - step, (max as number) - step);

    setUserHasScrolled(true);
    // If auto-scroll is active, lock viewport until latest reaches right edge
    if (autoScroll) {
      userLockedViewportWhileAutoScrollRef.current = true;
    } else {
      saveFixedRange();
    }
    scheduleChartUpdate();
  }, [autoScroll, saveFixedRange, scheduleChartUpdate]);

  const handleNavigateRight = useCallback(() => {
    const chart = chartRef.current;
    if (!chart?.options?.scales?.x) return;

    const { min, max } = getScaleRange(chart);
    if (min === undefined || max === undefined) return;

    const windowSize = (max as number) - (min as number);
    const step = windowSize * 0.25; // Move 25% of current window

    setScaleRangeBoth(chart, (min as number) + step, (max as number) + step);

    setUserHasScrolled(true);
    if (autoScroll) {
      userLockedViewportWhileAutoScrollRef.current = true;
    } else {
      saveFixedRange();
    }
    scheduleChartUpdate();
  }, [autoScroll, saveFixedRange, scheduleChartUpdate]);

  // Update zoom level when slider changes (only after user adjusted)
  useEffect(() => {
    if (!hasUserAdjustedZoomRef.current) return;
    handleZoomChange(zoomLevel);
  }, [zoomLevel, handleZoomChange]);

  // Zoom to show all data (like legacy)
  const zoomToShowAllData = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || !chart.data.datasets.length) {
      console.warn('[RealtimeChart] No data to zoom to');
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let dataFound = false;

    chart.data.datasets.forEach((dataset: any) => {
      if (!dataset.hidden && dataset.data.length > 0) {
        dataset.data.forEach((point: any) => {
          if (point.x !== null && point.x !== undefined) {
            dataFound = true;
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
          }
        });
      }
    });

    if (dataFound && minX !== Infinity && maxX !== -Infinity) {
      const range = maxX - minX;
      const padding = range > 0 ? range * 0.05 : 10000; // 5% padding or 10s
      setScaleRangeBoth(chart, minX - padding, maxX + padding);
      setUserHasScrolled(true);
      setAutoScroll(false);
      scheduleChartUpdate();
      saveFixedRange();
    } else {
      console.warn('[RealtimeChart] No plottable data found');
    }
  }, [scheduleChartUpdate, saveFixedRange]);

  // Zoom once after historical data loads
  useEffect(() => {
    if (!zoomToHistoricalPending || !historicalDate) return;

    const chart = chartRef.current;
    if (!chart) return;

    // Wait until chart instance has actually received plottable points.
    const hasPlottableData = chart.data.datasets.some((dataset: any) =>
      !dataset.hidden &&
      Array.isArray(dataset.data) &&
      dataset.data.some((point: any) => point?.x !== null && point?.x !== undefined)
    );

    if (!hasPlottableData) {
      return;
    }

    zoomToShowAllData();
    setZoomToHistoricalPending(false);
  }, [datasets, historicalDate, zoomToHistoricalPending, zoomToShowAllData]);

  // Generate gap annotations for offline periods
  const gapAnnotations = useMemo(() => {
    const annotations: Record<string, any> = {};
    
    if (!enableGapAnnotations) {
      return annotations;
    }
    gapsRef.current.forEach((gap, index) => {
      annotations[`gap_${index}`] = {
        type: 'box',
        xMin: gap.start,
        xMax: gap.end,
        yMin: 0,
        yMax: 100,
        backgroundColor: 'rgba(100, 100, 100, 0.12)',
        borderColor: 'rgba(100, 100, 100, 0.25)',
        borderWidth: 1,
        borderDash: [4, 4],
        label: {
          display: true,
          content: 'Sitzungspause', // Browser/tab was inactive
          position: 'center',
          color: 'rgba(130, 130, 130, 0.5)',
          font: { size: 8, style: 'italic' },
        },
      };
    });
    
    return annotations;
  }, [datasets, enableGapAnnotations]); // Recalculate when datasets change

  // Chart options with simplified typing for compatibility
  const decimationSamples = useMemo(() => {
    // Dynamic decimation target based on total points
    const points = datasets.reduce((s: number, d: any) => s + (d.data?.length || 0), 0);
    if (points < 1500) return Math.max(200, Math.floor(points * 0.8));
    if (points < 5000) return 600;
    return 800;
  }, [datasets]);

  const chartOptions: any = useMemo(() => {
    let preservedMin: number | undefined = undefined;
    let preservedMax: number | undefined = undefined;
    try {
      const chart = chartRef.current;
      if (chart?.options?.scales?.x) {
        const { min, max } = getScaleRange(chart);
        if (min !== undefined && max !== undefined && isFinite(min as number) && isFinite(max as number)) {
          preservedMin = min as number;
          preservedMax = max as number;
        }
      }
      if ((preservedMin === undefined || preservedMax === undefined) &&
          fixedRangeRef.current.min !== undefined && fixedRangeRef.current.max !== undefined) {
        preservedMin = fixedRangeRef.current.min as number;
        preservedMax = fixedRangeRef.current.max as number;
      }
    } catch {}
    return ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
      elements: {
        line: { spanGaps: true },
        point: { hitRadius: 10, radius: 0 },
      },
      plugins: {
        tooltip: { enabled: false },
        legend: { display: false },
        decimation: { enabled: true, algorithm: 'lttb', samples: decimationSamples },
        annotation: {
          clip: false,
          annotations: {
            // Gap annotations (offline periods)
            ...gapAnnotations,
            // Marker lines
            lineMarkerLeft: {
              type: 'line',
              scaleID: 'x',
              get value() { return markers[0].timestamp || 0; },
              borderColor: 'purple',
              borderWidth: 2,
              get display() { return !!markers[0].timestamp; },
            },
            lineMarkerRight: {
              type: 'line',
              scaleID: 'x',
              get value() { return markers[1].timestamp || 0; },
              borderColor: 'burlywood',
              borderWidth: 2,
              get display() { return !!markers[1].timestamp; },
            },
            cursorLine: {
              type: 'line',
              scaleID: 'x',
              display: false,
              borderColor: 'rgba(100, 100, 100, 0.7)',
              borderWidth: 1,
              borderDash: [6, 6],
            },
          },
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
            threshold: 5,
            onPanStart: () => {
              setUserHasScrolled(true);
              // Keep auto-scroll active but lock viewport
              userLockedViewportWhileAutoScrollRef.current = true;
              initialRangeLockUntilRef.current = null;
              // Disarm auto-scroll on manual interaction
              autoScrollArmedRef.current = false;
              return true;
            },
            onPanComplete: () => {
              if (!autoScroll) {
                saveFixedRange();
              }
            },
          },
          zoom: {
            wheel: { enabled: true, speed: 0.1 },
            pinch: { enabled: true },
            drag: { enabled: false },
            mode: 'x',
            onZoomStart: () => {
              setUserHasScrolled(true);
              // Keep auto-scroll active but lock viewport
              userLockedViewportWhileAutoScrollRef.current = true;
              initialRangeLockUntilRef.current = null;
              // Disarm auto-scroll on manual interaction
              autoScrollArmedRef.current = false;
              return true;
            },
            onZoomComplete: () => {
              if (!autoScroll) {
                saveFixedRange();
              }
            },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: {
            tooltipFormat: 'HH:mm:ss.SSS',
            displayFormats: {
              millisecond: 'HH:mm:ss.SSS',
              second: 'HH:mm:ss',
              minute: 'HH:mm',
              hour: 'HH:00',
              day: 'MMM d',
              week: 'll',
              month: 'MMM yy',
              quarter: '[Q]Q - yy',
              year: 'yyyy',
            },
          },
          grid: { drawBorder: true },
          ticks: { autoSkip: true, maxTicksLimit: 20, source: 'auto' },
          min: preservedMin,
          max: preservedMax,
        },
        yPercentage: {
          type: 'linear',
          position: 'left',
          min: 0,
          max: 100,
          title: { display: false },
          ticks: { display: false },
          grid: { drawBorder: true },
        },
      },
      onHover: (event: any, activeElements: any[]) => {
        const chart = chartRef.current;
        if (!chart || !event.native) {
          updateCursorInfo(null);
          return;
        }
        
        // Throttle heavy hover work to rAF
        if (!onHoverLastPointerRef.current) onHoverLastPointerRef.current = { x: 0, y: 0 };
        onHoverLastPointerRef.current.x = event.native.clientX;
        onHoverLastPointerRef.current.y = event.native.clientY;
        if (onHoverRafRef.current) cancelAnimationFrame(onHoverRafRef.current);
        onHoverRafRef.current = requestAnimationFrame(() => {
          const rect = chart.canvas.getBoundingClientRect();
          const px = onHoverLastPointerRef.current!.x - rect.left;
          const py = onHoverLastPointerRef.current!.y - rect.top;
          const dataX = chart.scales.x.getValueForPixel(px);
          
          if (dataX === undefined || dataX === null) {
            updateCursorInfo(null);
            // Hide cursor line
            if (chart.options.plugins.annotation.annotations.cursorLine) {
              chart.options.plugins.annotation.annotations.cursorLine.display = false;
              scheduleChartUpdate();
            }
            return;
          }

          // Check if cursor is within chart area
          const chartArea = chart.chartArea;
          if (px < chartArea.left || px > chartArea.right ||
              py < chartArea.top || py > chartArea.bottom) {
            updateCursorInfo(null);
            if (chart.options.plugins.annotation.annotations.cursorLine) {
              chart.options.plugins.annotation.annotations.cursorLine.display = false;
              scheduleChartUpdate();
            }
            return;
          }

          const currentNormalizedValues = getValuesAtTimestamp(dataX, true);
          const currentOriginalValues = getValuesAtTimestamp(dataX, false);

          // Use ref instead of setState to prevent re-renders
          cursorMarkerRef.current = {
            timestamp: dataX,
            values: currentOriginalValues,
            normalizedValues: currentNormalizedValues,
          };

          updateCursorInfo(cursorMarkerRef.current);

          // Show cursor line
          if (chart.options.plugins.annotation.annotations.cursorLine) {
            chart.options.plugins.annotation.annotations.cursorLine.value = dataX;
            chart.options.plugins.annotation.annotations.cursorLine.display = true;
            scheduleChartUpdate();
          }
        });
      },
      onClick: (event: any) => {
        const chart = chartRef.current;
        if (!chart || !event.native) return;

        // Robust pointer coordinates via DOM rect instead of Chart helpers
        const rect = chart.canvas.getBoundingClientRect();
        const x = event.native.clientX - rect.left;
        const y = event.native.clientY - rect.top;
        const dataX = chart.scales.x.getValueForPixel(x);

        if (dataX === undefined || dataX === null) {
          console.warn('[RealtimeChart] Invalid timestamp from click');
          return;
        }

        // Check if click is within chart area
        const chartArea = chart.chartArea;
        if (x < chartArea.left || x > chartArea.right ||
            y < chartArea.top || y > chartArea.bottom) {
          return;
        }

        // Delegate to hook to handle marker placement/removal and autoscroll logic
        handleChartClick(dataX);
      },
    });
  }, [getValuesAtTimestamp, updateCursorInfo, isHistoricalMode, autoScroll, markers, handleChartClick, gapAnnotations]);

  // Chart data for Chart.js with compatible typing
  const chartData: any = useMemo(() => ({
    datasets: datasets,
  }), [datasets]);

  const legendParameters = useMemo(() => {
    if (historicalDate === null) {
      return parameters.map((p) => getParameterConfig(p.originalName));
    }

    const liveById = new Map(parameters.map((p) => [p.originalName, p]));
    const seen = new Set<string>();
    const merged: ParameterInfo[] = [];

    datasets.forEach((ds: any) => {
      const paramId = ds.paramId as string;
      if (!paramId || seen.has(paramId)) return;
      seen.add(paramId);

      const base = liveById.get(paramId) || getParameterConfig(paramId);
      merged.push({
        ...base,
        show_in_legend: true,
        visible_on_chart: !ds.hidden,
        color: (ds.borderColor as string) || base.color,
      });
    });

    return merged;
  }, [historicalDate, parameters, datasets, getParameterConfig]);

  const totalPoints = useMemo(() => {
    return datasets.reduce((sum: number, d: any) => sum + (d.data?.length || 0), 0);
  }, [datasets]);

  // CSV Export functions with dropdown options
  const handleCopyCSVAll = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      console.warn('[RealtimeChart] Chart not ready for CSV copy');
      return;
    }
    copyCSVToClipboard(chart, parameters, false); // All data
    setShowCSVOptions(false); // Close dropdown after copy
  }, [parameters]);

  const handleCopyCSVVisible = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      console.warn('[RealtimeChart] Chart not ready for CSV copy');
      return;
    }
    copyCSVToClipboard(chart, parameters, true); // Visible range only
    setShowCSVOptions(false); // Close dropdown after copy
  }, [parameters]);

  const handleExportCSVAll = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      console.warn('[RealtimeChart] Chart not ready for CSV export');
      return;
    }
    exportCSVFile(chart, parameters, false); // All data
    setShowCSVOptions(false); // Close dropdown after export
  }, [parameters]);

  const handleExportCSVVisible = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      console.warn('[RealtimeChart] Chart not ready for CSV export');
      return;
    }
    exportCSVFile(chart, parameters, true); // Visible range only
    setShowCSVOptions(false); // Close dropdown after export
  }, [parameters]);

  // Legacy handlers for backward compatibility
  const handleExportCSV = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      console.warn('[RealtimeChart] Chart not ready for CSV export');
      return;
    }
    exportChartToCSV(chart, parameters, true);
  }, [parameters]);

  const handleCopyCSV = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      console.warn('[RealtimeChart] Chart not ready for CSV copy');
      return;
    }
    exportChartToCSV(chart, parameters, false);
  }, [parameters]);

  const handleExportPDF = useCallback((options?: { includeStatistics?: boolean; includeDataTable?: boolean }) => {
    const chart = chartRef.current;
    if (!chart) {
      console.warn('[RealtimeChart] Chart not ready for PDF export');
      return;
    }
    
    // Use enhanced PDF export with all available information
    exportChartToPDFEnhanced(
      chart,
      parameters,
      {
        deviceId,
        rigModel,
        rigModelInfo,
        parameterSet,
        historicalDate,
        chartMarkers: markers,
        includeDataTable: options?.includeDataTable ?? true,
        includeStatistics: options?.includeStatistics ?? true
      }
    );
    setShowPDFOptions(false); // Close dropdown after export
  }, [parameters, deviceId, rigModel, rigModelInfo, parameterSet, historicalDate, markers]);

  const handleQuickPDFExport = useCallback(() => {
    handleExportPDF({ includeStatistics: false, includeDataTable: false });
  }, [handleExportPDF]);

  const handleFullPDFExport = useCallback(() => {
    handleExportPDF({ includeStatistics: true, includeDataTable: true });
  }, [handleExportPDF]);

  const handleStatsPDFExport = useCallback(() => {
    handleExportPDF({ includeStatistics: true, includeDataTable: false });
  }, [handleExportPDF]);
  
  const handleDefaultPDFExport = useCallback(() => {
    handleExportPDF();
  }, [handleExportPDF]);

  // Close PDF options dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPDFOptions) {
        const target = event.target as Element;
        if (!target.closest('.pdf-export-dropdown')) {
          setShowPDFOptions(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPDFOptions]);

  // Close CSV options dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showCSVOptions) {
        const target = event.target as Element;
        if (!target.closest('.csv-export-dropdown')) {
          setShowCSVOptions(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCSVOptions]);

  // Add historical data to chart (legacy behavior)
  const addHistoricalDataToChart = useCallback((historicalLog: any, baseTimestamp: number) => {
    if (!historicalLog) return;
    
    // CRITICAL: Block live updates immediately (synchronously)
    isLoadingHistoricalRef.current = true;
    // Clear markers when switching to historical data
    try { clearMarkers(); } catch {}
    
    // BACKUP live data before switching to historical (only if we have live data and no backup yet)
    if (!liveDataBackupRef.current && datasetCacheRef.current.length > 0) {
      const hasLiveData = datasetCacheRef.current.some(ds => ds.data && ds.data.length > 0);
      if (hasLiveData) {
        liveDataBackupRef.current = {
          datasets: datasetCacheRef.current.map(ds => ({
            ...ds,
            data: [...(ds.data || [])],
          })),
          lastKnownValues: { ...lastKnownValues.current },
        };
        console.log('[RealtimeChart] Backed up live data before loading historical:', {
          datasets: liveDataBackupRef.current.datasets.length,
          totalPoints: liveDataBackupRef.current.datasets.reduce((s, d) => s + (d.data?.length || 0), 0),
        });
      }
    }
    
    // Set historical date for header display
    const historicalDateStr = formatDateWithUserTimezone(baseTimestamp * 1000, 'de-DE', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric'
    }).split(' ')[0];
    setHistoricalDate(historicalDateStr);
    
    // Disable auto-scroll when loading historical data
    setAutoScroll(false);
    setUserHasScrolled(true);
    
    // ENHANCED: Clear ALL current data completely (including cache and known values)
    lastKnownValues.current = {};
    datasetCacheRef.current = [];
    
    // Clear current chart data like legacy
    setDatasets(prevDatasets => prevDatasets.map(dataset => ({ ...dataset, data: [] })));
    
    // Process historical data EXACTLY like legacy
    const baseTimestampMs = baseTimestamp * 1000;
    const allPointsByDataset: Record<string, any[]> = {};
    
    // Get relative time keys and sort them
    const relTimeKeys = Object.keys(historicalLog).sort((a, b) => parseFloat(a) - parseFloat(b));
    
    // Build points by dataset (like legacy sourcePoints)
    for (const relTime of relTimeKeys) {
      const eventData = historicalLog[relTime];
      const absoluteTimestampMs = baseTimestampMs + parseFloat(relTime) * 1000;
      
      for (const paramKey in eventData) {
        if (eventData.hasOwnProperty(paramKey)) {
          const rawValue = eventData[paramKey];
          if (!allPointsByDataset[paramKey]) allPointsByDataset[paramKey] = [];
          allPointsByDataset[paramKey].push({
            x: absoluteTimestampMs,
            y: rawValue,
          });
        }
      }
    }

    // FIXED: Create global timestamps set like legacy (key difference!)
    const allTimestamps = new Set<number>();
    for (const paramId in allPointsByDataset) {
      const pointsArray = allPointsByDataset[paramId];
      if (pointsArray?.length) {
        pointsArray.forEach(p => {
          if (p && p.x !== undefined) {
            allTimestamps.add(p.x);
          }
        });
      }
    }
    
    const sortedGlobalTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    console.log(`[RealtimeChart] Processing ${sortedGlobalTimestamps.length} global timestamps for historical data`);

    // Add historical points to existing datasets using global timestamps (like legacy)
    // IMPORTANT: start with an empty map so live-only parameters are excluded from historical view
    setDatasets(() => {
      const datasetByParamId = new Map<string, any>();

      Object.keys(allPointsByDataset).forEach((paramId) => {
        const paramConfig = getParameterConfig(paramId);
        datasetByParamId.set(paramId, createDatasetFromParamConfig(paramConfig, true));
      });

      const baseDatasets = Array.from(datasetByParamId.values());

      const updatedDatasets = baseDatasets.map((dataset: any) => {
        const paramId = dataset.paramId;
        const paramConfig = getParameterConfig(paramId);
        
        const sourcePoints = allPointsByDataset[paramId] || [];
        const sourcePointsMap = new Map<number, any>();
        sourcePoints.forEach(p => {
          if (p && p.x !== undefined) {
            sourcePointsMap.set(p.x, p.y);
          }
        });
        
        const newData: ChartDataPoint[] = [];
        let localLastKnownRawY: number | null = null;
        let localLastRawDevice: number | null = null;
        
        // FIXED: Process each GLOBAL timestamp like legacy
        sortedGlobalTimestamps.forEach(ts => {
          let originalY: number | null = null;
          
          if (sourcePointsMap.has(ts)) {
            // This parameter has data at this timestamp
            const rawY = sourcePointsMap.get(ts);
            const n = typeof rawY === 'number' ? rawY : parseFloat(String(rawY));
            if (Number.isFinite(n)) {
              localLastRawDevice = n;
            }
            originalY = processRawValue(paramId, rawY);
            if (originalY !== null) {
              localLastKnownRawY = originalY;
            }
          } else {
            // This parameter doesn't have data at this timestamp, use last known value
            originalY = localLastKnownRawY;
          }
          
          // CRITICAL FIX: Only add points with valid originalY values for analysis
          // Skip points where we don't have actual data and no previous value to carry forward
          if (originalY !== null) {
            const normalizedY = normalizeValue(originalY, paramConfig);
            newData.push({
              x: ts,
              y: normalizedY,
              originalY: originalY,
              ...(localLastRawDevice != null && Number.isFinite(localLastRawDevice)
                ? { rawDeviceValue: localLastRawDevice }
                : {}),
            });
          }
        });
        
        return {
          ...dataset,
          data: newData,
          // If we have historical points, force dataset visible to avoid blank chart.
          hidden: newData.length > 0 ? false : dataset.hidden,
        };
      });

      datasetCacheRef.current = updatedDatasets;
      scheduleChartUpdate();
      return updatedDatasets;
    });
    
    console.log(`[RealtimeChart] Historical data added for ${Object.keys(allPointsByDataset).length} parameters`);
    
    // Debug: Log dataset information after update
    setTimeout(() => {
      const currentDatasets = datasetCacheRef.current;
      console.log(`[RealtimeChart] Dataset debug info after update:`, {
        totalDatasets: currentDatasets.length,
        datasetsWithData: currentDatasets.map((ds: any) => ({
          paramId: ds.paramId,
          hidden: !!ds.hidden,
          dataLength: ds.data?.length || 0,
          validDataPoints: ds.data?.filter((p: any) => p.originalY !== null).length || 0,
          firstPoint: ds.data?.[0],
          lastPoint: ds.data?.[ds.data.length - 1]
        }))
      });
    }, 100);
    saveFixedRange();
    // Trigger zoom after datasets have been populated
    setZoomToHistoricalPending(true);
    
    // Release live updates block after historical data is loaded
    isLoadingHistoricalRef.current = false;
    console.log(`[RealtimeChart] === FINISHED Historical Data Load === Released loading flag`);
  }, [processRawValue, normalizeValue, scheduleChartUpdate, getParameterConfig, createDatasetFromParamConfig]);

  // Mini Data Logs (compact) state (moved here to avoid TDZ on addHistoricalDataToChart)
  const { loadHistoricalTimestamps, loadHistoricalData } = useHistoricalData();
  const [miniLogs, setMiniLogs] = useState<string[]>([]);
  const [miniSelectedTs, setMiniSelectedTs] = useState<string>('');
  const [miniLoading, setMiniLoading] = useState<boolean>(false);
  const miniLogsLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    // load timestamps once per device for compact selector
    if (miniLogsLoadedRef.current === deviceId) return;
    miniLogsLoadedRef.current = (deviceId as any) ?? '__none__';
    loadHistoricalTimestamps().then(setMiniLogs).catch(() => setMiniLogs([]));
  }, [deviceId, loadHistoricalTimestamps]);

  const handleMiniSelectTs = useCallback((ts: string) => {
    setMiniSelectedTs(ts);
  }, []);

  const handleMiniLoadToChart = useCallback(async () => {
    if (!miniSelectedTs) return;
    setMiniLoading(true);
    try {
      const data = await loadHistoricalData(miniSelectedTs);
      if (data) {
        const baseTs = parseInt(miniSelectedTs, 10);
        addHistoricalDataToChart(data as any, baseTs);
      }
    } finally {
      setMiniLoading(false);
    }
  }, [miniSelectedTs, loadHistoricalData, addHistoricalDataToChart]);

  // If the tab was hidden for a while, re-sync the timebase to the latest data point
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenAtRef.current = Date.now();
        return;
      }

      if (document.visibilityState !== 'visible') return;
      const hiddenAt = lastHiddenAtRef.current;
      lastHiddenAtRef.current = null;
      if (!hiddenAt) return;

      const hiddenDurationMs = Date.now() - hiddenAt;
      const LONG_BACKGROUND_MS = 60 * 1000; // 1 minute threshold
      if (hiddenDurationMs < LONG_BACKGROUND_MS) return;
      if (isHistoricalMode || historicalDate !== null) return;
      if (!enableGapAnnotations) return;

      const latestTs = getLatestVisibleTimestamp();
      if (!latestTs) return;

      // Remember the gap for annotation consistency
      gapsRef.current = [...gapsRef.current, { start: hiddenAt, end: Date.now() }];
      reanchorTimebaseToLatest(latestTs);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [getLatestVisibleTimestamp, isHistoricalMode, historicalDate, reanchorTimebaseToLatest, enableGapAnnotations]);

  // Clear chart data (moved above handleMiniBackToLive to avoid TDZ)
  const clearChartData = useCallback(() => {
    setDatasets(prev => prev.map(dataset => ({ ...dataset, data: [] })));
    lastKnownValues.current = {};
    datasetCacheRef.current = [];
    // Reset historical mode when clearing chart
    setHistoricalDate(null);
    // Reset loading flag
    isLoadingHistoricalRef.current = false;
    // Reset init/viewport flags so next data start aligns to first point
    firstDataSeenRef.current = false;
    initialRangeLockUntilRef.current = null;
    fixedRangeRef.current = { min: undefined, max: undefined };
    userLockedViewportWhileAutoScrollRef.current = !autoScrollEnabledRef.current;
    setUserHasScrolled(false);
    sessionStartTsRef.current = null;
    // (Re)arm autoscroll if enabled
    autoScrollArmedRef.current = autoScrollEnabledRef.current;
    saveFixedRange();
  }, []);

  // Reset dataset visuals after Test (restore points/tension/spanGaps)
  const resetDatasetVisuals = useCallback(() => {
    setDatasets(prev => {
      const updated = prev.map(ds => {
        const paramConfig = getParameterConfig((ds as any).paramId);
        const isStepped = paramConfig?.form === 1;
        return {
          ...ds,
          spanGaps: true,
          tension: isStepped ? 0 : 0.2,
          stepped: (isStepped ? 'before' : false) as any,
          pointRadius: isStepped ? 0 : 2,
          decimation: undefined as any,
        };
      });
      datasetCacheRef.current = updated;
      return updated;
    });
  }, [getParameterConfig]);

  const handleMiniBackToLive = useCallback(() => {
    // Clear markers when returning to live
    clearMarkers();
    
    // Reset historical mode flag
    setHistoricalDate(null);
    isLoadingHistoricalRef.current = false;
    setIsChartPaused(false);
    
    // Restore live data from backup if available
    if (liveDataBackupRef.current) {
      const backup = liveDataBackupRef.current;
      console.log('[RealtimeChart] Restoring live data from backup:', {
        datasets: backup.datasets.length,
        totalPoints: backup.datasets.reduce((s, d) => s + (d.data?.length || 0), 0),
      });
      
      // Restore lastKnownValues
      lastKnownValues.current = { ...backup.lastKnownValues };
      
      // Clear backup BEFORE setDatasets to prevent race conditions
      liveDataBackupRef.current = null;
      
      // Restore datasets with live data — use backup directly so live-only
      // parameters (not present in historical datasets) are also restored
      setDatasets(() => {
        const restored = backup.datasets.map((backupDs: any) => {
          const paramConfig = getParameterConfig(backupDs.paramId);
          const isStepped = paramConfig?.form === 1;
          return {
            ...backupDs,
            data: backupDs.data && backupDs.data.length > 0 ? [...backupDs.data] : [],
            spanGaps: true,
            tension: isStepped ? 0 : 0.2,
            stepped: (isStepped ? 'before' : false) as any,
            pointRadius: isStepped ? 0 : 2,
            decimation: undefined as any,
          };
        });
        datasetCacheRef.current = restored;
        return restored;
      });
      
      // Calculate data range from backup (before it's cleared)
      let minTs = Infinity;
      let maxTs = -Infinity;
      backup.datasets.forEach(ds => {
        if (ds.data && ds.data.length > 0) {
          minTs = Math.min(minTs, ds.data[0].x);
          maxTs = Math.max(maxTs, ds.data[ds.data.length - 1].x);
        }
      });
      
      // Adjust view to show restored data (after a small delay for state to update)
      setTimeout(() => {
        const chart = chartRef.current;
        if (chart && minTs < Infinity && maxTs > -Infinity) {
          // Show last 5 minutes or all data if less
          const windowMs = 5 * 60 * 1000;
          const rangeStart = Math.max(minTs, maxTs - windowMs);
          setScaleRangeBoth(chart, rangeStart, maxTs + 5000);
          chart.update('none');
          console.log('[RealtimeChart] Restored view to live data range');
        }
      }, 100);
      
      // Enable auto-scroll when returning to live mode
      handleAutoScrollToggle(true);
    } else {
      // No backup - just clear everything and reset view
      clearChartData();
      handleAutoScrollToggle(true);
      setInitialChartView();
      resetDatasetVisuals();
    }
  }, [clearChartData, clearMarkers, handleAutoScrollToggle, setInitialChartView, resetDatasetVisuals, getParameterConfig]);

  // Force reset to live mode
  const forceResetToLiveMode = useCallback(() => {
    setHistoricalDate(null);
    isLoadingHistoricalRef.current = false;
    console.log(' Force reset to live mode executed');
  }, []);

  // Expose methods on the container element
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addHistoricalDataToChart = addHistoricalDataToChart;
      el.clearChartData = clearChartData;
      el.clearMarkers = clearMarkers;
      el.setAutoScroll = handleAutoScrollToggle;
      (el as any).setInitialChartView = setInitialChartView;
      (el as any).backToLive = handleMiniBackToLive;
    }

    return () => {
      if (el) {
        delete el.addHistoricalDataToChart;
        delete el.clearChartData;
        delete el.clearMarkers;
        delete el.setAutoScroll;
        delete (el as any).setInitialChartView;
        delete (el as any).backToLive;
      }
    };
  }, [addHistoricalDataToChart, clearChartData, clearMarkers, handleAutoScrollToggle, setInitialChartView, handleMiniBackToLive]);

  // Load external historical data when provided (for modal windows)
  const externalDataLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!externalHistoricalData || !externalHistoricalTimestamp) return;
    
    // Create a unique key for this data load
    const dataKey = `${externalHistoricalTimestamp}-${Object.keys(externalHistoricalData).length}`;
    
    // Prevent loading the same data multiple times
    if (externalDataLoadedRef.current === dataKey) return;
    
    console.log('[RealtimeChart] Loading external historical data:', {
      timestamp: externalHistoricalTimestamp,
      points: Object.keys(externalHistoricalData).length
    });
    
    externalDataLoadedRef.current = dataKey;
    
    // Small delay to ensure chart is ready
    const timer = setTimeout(() => {
      addHistoricalDataToChart(externalHistoricalData, externalHistoricalTimestamp);
    }, 100);
    
    return () => clearTimeout(timer);
  }, [externalHistoricalData, externalHistoricalTimestamp, addHistoricalDataToChart]);

  // Chart control functions
  const handlePlayPause = useCallback(() => {
    setIsChartPaused(prev => !prev);
  }, []);

  const handleClearChart = useCallback(() => {
    setDatasets(prev => prev.map(dataset => ({ ...dataset, data: [] })));
    setMarkers(createEmptyMarkers());
    lastKnownValues.current = {};
    datasetCacheRef.current = [];
    // Reset historical date when clearing chart
    setHistoricalDate(null);
    // Reset loading flag
    isLoadingHistoricalRef.current = false;
    // Reset init/viewport flags so next data start aligns to first point
    firstDataSeenRef.current = false;
    initialRangeLockUntilRef.current = null;
    fixedRangeRef.current = { min: undefined, max: undefined };
    userLockedViewportWhileAutoScrollRef.current = !autoScrollEnabledRef.current;
    setUserHasScrolled(false);
    sessionStartTsRef.current = null;
    autoScrollArmedRef.current = autoScrollEnabledRef.current;
    
    // Clear localStorage data for this device
    if (deviceId && deviceId !== 'N/A') {
      clearStoredChartData(deviceId);
      gapsRef.current = [];
      storedDataRef.current = false; // Mark as "no data"
      sessionStartTimestampRef.current = Date.now();
      console.log('[RealtimeChart] Cleared localStorage chart data for device:', deviceId);
    }
  }, [deviceId]);

  // Create colored cursor info display  
  // moved to utils/realtime/format (buildColoredCursorInfo)

  // Create colored marker info display
  // moved to utils/realtime/format (buildColoredMarkerInfo)

  const handleColorChange = useCallback((paramId: string, currentColor: string) => {
    setColorPickerParam(paramId);
    setShowColorPicker(true);
  }, []);
  
  const handleColorSelect = useCallback(async (newColor: string) => {
    if (colorPickerParam) {
      try {
        saveChartScopedOverride(colorPickerParam, { color: newColor });
        setDatasets((prev) => {
          const updated = prev.map((ds: any) => {
            if (ds.paramId !== colorPickerParam) return ds;
            return {
              ...ds,
              borderColor: newColor,
              backgroundColor: newColor,
              pointBackgroundColor: newColor,
              pointBorderColor: newColor,
            };
          });
          datasetCacheRef.current = updated;
          return updated;
        });
        scheduleChartUpdate();
      } catch (error) {
        console.error(`[RealtimeChart] Failed to change color for ${colorPickerParam}:`, error);
      }
    }
    setShowColorPicker(false);
    setColorPickerParam(null);
  }, [colorPickerParam, saveChartScopedOverride, scheduleChartUpdate]);

  const openSeriesSettings = useCallback((paramId: string) => {
    const cfg = getParameterConfig(paramId);
    const ds = datasetCacheRef.current.find((d: any) => d.paramId === paramId);
    setSeriesSettingsForm({
      color: cfg.color || '#1f77b4',
      visible: ds ? !ds.hidden : Boolean(cfg.visible_on_chart),
      form: String(cfg.form ?? 0),
      unit: cfg.unit || '',
      minValue: cfg.minValue !== undefined && cfg.minValue !== null ? String(cfg.minValue) : '',
      maxValue: cfg.maxValue !== undefined && cfg.maxValue !== null ? String(cfg.maxValue) : '',
    });
    setSeriesSettingsParamId(paramId);
  }, [getParameterConfig]);

  const applySeriesSettings = useCallback(async () => {
    if (!seriesSettingsParamId) return;

    const paramId = seriesSettingsParamId;
    const baseCfg = getParameterConfig(paramId);
    const nextForm = seriesSettingsForm.form === '1' ? 1 : 0;
    const parsedMin = seriesSettingsForm.minValue.trim() === '' ? undefined : Number(seriesSettingsForm.minValue);
    const parsedMax = seriesSettingsForm.maxValue.trim() === '' ? undefined : Number(seriesSettingsForm.maxValue);

    const nextCfg: ParameterInfo = {
      ...baseCfg,
      color: seriesSettingsForm.color.trim() || baseCfg.color,
      visible_on_chart: seriesSettingsForm.visible,
      show_in_legend: true,
      form: nextForm,
      unit: seriesSettingsForm.unit,
      minValue: Number.isFinite(parsedMin as number) ? parsedMin : undefined,
      maxValue: Number.isFinite(parsedMax as number) ? parsedMax : undefined,
    };
    saveChartScopedOverride(paramId, {
      color: nextCfg.color,
      visible_on_chart: nextCfg.visible_on_chart,
      form: nextCfg.form,
      unit: nextCfg.unit,
      minValue: nextCfg.minValue,
      maxValue: nextCfg.maxValue,
    });

    setDatasets((prev) => {
      const remapped = remapAllChartDatasets(prev).map((ds: any) =>
        ds.paramId === paramId ? { ...ds, hidden: !seriesSettingsForm.visible } : ds
      );
      datasetCacheRef.current = remapped;
      return remapped;
    });
    scheduleChartUpdate();

    setSeriesSettingsParamId(null);
  }, [seriesSettingsParamId, seriesSettingsForm, getParameterConfig, saveChartScopedOverride, remapAllChartDatasets, scheduleChartUpdate]);

  const handleToggleVisible = useCallback(async (paramId: string, visible: boolean) => {
    saveChartScopedOverride(paramId, { visible_on_chart: visible, show_in_legend: true });
    setDatasets((prev) => {
      const updated = prev.map((ds: any) =>
        ds.paramId === paramId ? { ...ds, hidden: !visible } : ds
      );
      datasetCacheRef.current = updated;
      return updated;
    });
    scheduleChartUpdate();
  }, [saveChartScopedOverride, scheduleChartUpdate]);

  // Test: draw "HASE" with thousands of points over 1 hour
  const runRigopsTest = useCallback(() => {
    setIsChartPaused(true);
    setMarkers(createEmptyMarkers());

    const chart = chartRef.current;
    if (!chart?.options?.scales?.x) return;

    // Keep current x-range
    const { min, max } = getScaleRange(chart);
    const start = (min ?? Date.now() - 60 * 60 * 1000) as number;
    const end = (max ?? (start + 60 * 60 * 1000)) as number;
    const durationMs = end - start;

    // Find visible datasets; if none, abort
    const visibleIdxs: number[] = datasets.map((d, i) => (!d.hidden ? i : -1)).filter(i => i >= 0);
    if (visibleIdxs.length === 0) return;

    // Prepare per-dataset newData containers
    const newSeries: any[][] = datasets.map(() => []);

    // Helpers to push points
    const pushGap = (dsI: number, x: number) => newSeries[dsI].push({ x, y: null, originalY: null });
    const pushPoint = (dsI: number, x: number, y: number) => newSeries[dsI].push({ x, y, originalY: null });

    // Coordinate helpers (normalized 0..1 → chart 0..100 for y)
    const Y = (ny: number) => 100 * (1 - ny); // invert so 0=bottom, 1=top
    const X = (nx: number) => start + nx * durationMs; // nx in [0,1] across hour window

    // Letter layout bands
    const gap = 0.005;
    const bandW = (1 - 3 * gap) / 4; // 4 letters, 3 gaps
    const bands = [0, 1, 2, 3].map(k => k * (bandW + gap));

    // Stroke dispatcher across datasets to avoid connections within one series
    let dsCursor = 0;
    const nextDs = () => {
      const idx = visibleIdxs[dsCursor % visibleIdxs.length];
      dsCursor++;
      return idx;
    };

    // Helper functions for drawing clean geometric shapes
    const addVertical = (dsI: number, x: number, y0: number, y1: number, steps = 100) => {
      const xVal = X(x);
      pushGap(dsI, xVal);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const yy = Y(y0 + (y1 - y0) * t);
        pushPoint(dsI, xVal, yy);
      }
    };
    
    const addHorizontal = (dsI: number, x0: number, x1: number, y: number, steps = 100) => {
      const yy = Y(y);
      pushGap(dsI, X(x0));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const xx = X(x0 + (x1 - x0) * t);
        pushPoint(dsI, xx, yy);
      }
    };

    const addDiagonal = (dsI: number, x0: number, y0: number, x1: number, y1: number, steps = 100) => {
      pushGap(dsI, X(x0));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const xx = X(x0 + (x1 - x0) * t);
        const yy = Y(y0 + (y1 - y0) * t);
        pushPoint(dsI, xx, yy);
      }
    };

    // Letter dimensions and positions
    const letterWidth = bandW * 0.15;
    const letterHeight = 0.7;
    const baseY = 0.15;
    const topY = baseY + letterHeight;
    const midY = baseY + letterHeight / 2;

    // H - clean H shape
    {
      const b = bands[0];
      const leftX = b + 0.05 * bandW;
      const rightX = leftX + letterWidth;
      
      addVertical(nextDs(), leftX, baseY, topY);
      addVertical(nextDs(), rightX, baseY, topY);
      addHorizontal(nextDs(), leftX, rightX, midY);
    }

    // A - triangular A with crossbar (flipped 180 degrees)
    {
      const b = bands[1];
      const leftX = b + 0.05 * bandW;
      const rightX = leftX + letterWidth;
      const centerX = leftX + letterWidth / 2;
      const crossY = baseY + letterHeight * 0.35; // crossbar in lower portion
      
      // Left diagonal (from top-left to bottom-center)
      addDiagonal(nextDs(), leftX, topY, centerX, baseY);
      // Right diagonal (from top-right to bottom-center)
      addDiagonal(nextDs(), rightX, topY, centerX, baseY);
      // Crossbar
      addHorizontal(nextDs(), leftX + letterWidth * 0.25, rightX - letterWidth * 0.25, crossY * 1.2);
    }

    // S - proper S curve using segments (flipped 180 degrees)
    {
      const b = bands[2];
      const leftX = b + 0.05 * bandW;
      const rightX = leftX + letterWidth;
      
      // Top horizontal (left to right)
      addHorizontal(nextDs(), leftX, rightX, topY);
      // Upper vertical (down on right)
      addVertical(nextDs(), rightX, topY, midY);
      // Middle horizontal (right to left)
      addHorizontal(nextDs(), rightX, leftX, midY);
      // Lower vertical (down on left)
      addVertical(nextDs(), leftX, midY, baseY);
      // Bottom horizontal (left to right)
      addHorizontal(nextDs(), leftX, rightX, baseY);
    }

    // E - clean E with three horizontals
    {
      const b = bands[3];
      const leftX = b + 0.05 * bandW;
      const rightX = leftX + letterWidth;
      
      // Vertical spine
      addVertical(nextDs(), leftX, baseY, topY);
      // Top horizontal
      addHorizontal(nextDs(), leftX, rightX, topY);
      // Middle horizontal (slightly shorter)
      addHorizontal(nextDs(), leftX, rightX - letterWidth * 0.2, midY);
      // Bottom horizontal
      addHorizontal(nextDs(), leftX, rightX, baseY);
    }

    // Apply series updates (preserve style)
    setDatasets(prev => prev.map((ds, i) => {
      if (newSeries[i].length === 0) return ds;
      return {
        ...ds,
        data: newSeries[i],
        spanGaps: false,
        tension: 0,
        // stepped: 'before' as any,
        // pointRadius: 0,
        decimation: { enabled: false } as any,
      };
    }));
    scheduleChartUpdate();
  }, [datasets, chartRef, scheduleChartUpdate]);

  // moved to utils/realtime/scale

  // Any user interaction clears the initial lock
  useEffect(() => {
    if (userHasScrolled) {
      initialRangeLockUntilRef.current = null;
    }
  }, [userHasScrolled]);

  // When switching auto-scroll mode to edge, reset session start to capture the next first point
  useEffect(() => {
    if (autoScrollMode === 'edge') {
      sessionStartTsRef.current = null;
    }
    // Re-arm for next incoming data if auto-scroll is enabled
    autoScrollArmedRef.current = autoScrollEnabledRef.current;
  }, [autoScrollMode]);

  return (
    <div
      ref={containerRef}
      className={`rounded-xl overflow-hidden realtime-chart-component shadow-sm bg-card border border-border`}
      style={{ color: 'var(--card-foreground)' }}
    >
      <ChartHeader 
        ref={headerRef} 
        isChartPaused={isChartPaused} 
        historicalDate={historicalDate} 
        totalPoints={totalPoints} 
        isStretched={isStretched} 
        compact={compact}
        chartInstanceId={chartInstanceId}
        isMainChart={isMainChart}
        onCloneChart={onCloneChart}
        onDeleteChart={onDeleteChart}
        chartIndex={chartIndex}
        totalCharts={totalCharts}
        onToggleStretch={() => {
          setIsStretched(prev => !prev);
          // Immediately scroll to header without animation
          setTimeout(() => {
            try {
              headerRef.current?.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
            } catch {}
          }, 0);
        }} 
      />

      <div className={compact ? 'p-1' : 'p-1.5 sm:p-2'}>
        {/* Hybrid controls: Desktop horizontal, Mobile vertical */}
        <ControlsBar
          isChartPaused={isChartPaused}
          historicalDate={historicalDate}
          autoScroll={autoScroll}
          autoScrollMode={autoScrollMode}
          autoScrollCustomScale={autoScrollCustomScale}
          zoomLevel={zoomLevel}
          markers={markers}
          hasUserAdjustedZoomRef={hasUserAdjustedZoomRef}
          onPlayPause={handlePlayPause}
          onForceLive={handleMiniBackToLive}
          onToggleAutoScroll={handleAutoScrollToggle}
          onChangeAutoScrollMode={handleChangeAutoScrollMode}
          onChangeAutoScrollCustomScale={handleChangeAutoScrollCustomScale}
          onClearMarkers={clearMarkers}
          onZoomToMarkers={zoomToMarkers}
          onNavigateLeft={handleNavigateLeft}
          onZoomSlider={(val) => { setZoomLevel(val); handleZoomChange(val); }}
          onNavigateRight={handleNavigateRight}
          onFitAll={zoomToShowAllData}
          onClearChart={handleClearChart}
          onRunTest={runRigopsTest}
          miniLogsTimestamps={miniLogs}
          miniSelectedTimestamp={miniSelectedTs}
          onMiniSelectTimestamp={handleMiniSelectTs}
          onMiniLoadToChart={handleMiniLoadToChart}
          onMiniBackToLive={handleMiniBackToLive}
          miniLoading={miniLoading}
          showCSVOptions={showCSVOptions}
          setShowCSVOptions={setShowCSVOptions}
          onCopyCSVAll={handleCopyCSVAll}
          onCopyCSVVisible={handleCopyCSVVisible}
          onExportCSVAll={handleExportCSVAll}
          onExportCSVVisible={handleExportCSVVisible}
          showPDFOptions={showPDFOptions}
          setShowPDFOptions={setShowPDFOptions}
          onQuickPDF={handleQuickPDFExport}
          onStatsPDF={handleStatsPDFExport}
          onFullPDF={handleFullPDFExport}
          compact={compact}
        />

        <ParameterLegend
          parameters={legendParameters}
          formatLegendLabel={formatLegendLabel}
          onColorClick={handleColorChange}
          onToggleVisible={handleToggleVisible}
          onOpenSettings={historicalDate !== null ? openSeriesSettings : undefined}
          compact={compact}
        />

        {/* Chart Container */}
        <div 
          className={`relative rounded ${compact ? 'bg-card p-0.5 mb-1' : 'bg-card p-1 mb-2'}`}
          style={{ height: compact ? '100%' : (isStretched ? '560px' : 'clamp(260px, 48vh, 340px)'), minHeight: compact ? '200px' : undefined, flex: compact ? 1 : undefined, color: 'var(--card-foreground)' }}
        >
          <Chart
            ref={chartRef}
            type="line"
            data={chartData}
            options={chartOptions}
          />
        </div>

        <InfoPanels
          cursorInfo={buildColoredCursorInfo(cursorMarkerRef.current, datasets, legendParameters, formatDisplayValue)}
          leftMarkerInfo={buildColoredMarkerInfo(markers[0], datasets, legendParameters, formatDisplayValue)}
          rightMarkerInfo={buildColoredMarkerInfo(markers[1], datasets, legendParameters, formatDisplayValue)}
          markers={markers}
          datasets={datasets}
          parameters={legendParameters}
          showIntegrals={showIntegrals}
          setShowIntegrals={setShowIntegrals}
          calculateIntegral={calculateIntegral}
          calculateAverage={calculateAverage}
          compact={compact}
        />
      </div>
      
      <ColorPickerModal visible={showColorPicker} onSelect={handleColorSelect} onClose={() => setShowColorPicker(false)} />

      {seriesSettingsParamId && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-theme-lg">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Historische Serie</h3>
                <p className="text-xs text-muted-foreground font-mono">{seriesSettingsParamId}</p>
              </div>
              <button
                type="button"
                onClick={() => setSeriesSettingsParamId(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="flex items-center justify-between text-sm text-foreground">
                <span>Sichtbar</span>
                <input
                  type="checkbox"
                  checked={seriesSettingsForm.visible}
                  onChange={(e) => setSeriesSettingsForm((p) => ({ ...p, visible: e.target.checked }))}
                  className="h-4 w-4 border border-border rounded"
                />
              </label>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Farbe</label>
                <input
                  type="text"
                  value={seriesSettingsForm.color}
                  onChange={(e) => setSeriesSettingsForm((p) => ({ ...p, color: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded bg-card text-foreground text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Linientyp</label>
                <select
                  value={seriesSettingsForm.form}
                  onChange={(e) => setSeriesSettingsForm((p) => ({ ...p, form: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded bg-card text-foreground text-sm"
                >
                  <option value="0">Glatt</option>
                  <option value="1">Stufen</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Einheit</label>
                  <input
                    type="text"
                    value={seriesSettingsForm.unit}
                    onChange={(e) => setSeriesSettingsForm((p) => ({ ...p, unit: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-border rounded bg-card text-foreground text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Min</label>
                  <input
                    type="number"
                    value={seriesSettingsForm.minValue}
                    onChange={(e) => setSeriesSettingsForm((p) => ({ ...p, minValue: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-border rounded bg-card text-foreground text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Max</label>
                  <input
                    type="number"
                    value={seriesSettingsForm.maxValue}
                    onChange={(e) => setSeriesSettingsForm((p) => ({ ...p, maxValue: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-border rounded bg-card text-foreground text-sm"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-border space-y-2">
                <p className="text-xs text-muted-foreground">Im Historik-Modus gesperrt: Kategorie, Zugriff, Alarm.</p>
                <input disabled value="Kategorie (gesperrt)" className="w-full px-2 py-1.5 border border-border rounded bg-muted text-muted-foreground text-xs" />
                <input disabled value="Zugriff (gesperrt)" className="w-full px-2 py-1.5 border border-border rounded bg-muted text-muted-foreground text-xs" />
                <input disabled value="Alarm (gesperrt)" className="w-full px-2 py-1.5 border border-border rounded bg-muted text-muted-foreground text-xs" />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSeriesSettingsParamId(null)}
                className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void applySeriesSettings(); }}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RealtimeChart;

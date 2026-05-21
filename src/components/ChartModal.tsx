import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useStoveStore } from '../store/useStoveStore';
import { useTiling } from '../context/TilingContext';
import RealtimeChart from './RealtimeChart';
import { useHistoricalData } from '../hooks/useFirebase';
import { formatHistoricalDateWithUserTimezone } from '../utils/timezone';

interface ChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivate?: () => void;
  /** Unique ID for this chart instance */
  chartId?: string;
  /** Index number for display (1-based) */
  chartIndex?: number;
  /** Historical timestamp to load (if provided, loads historical data) */
  historicalTimestamp?: string;
  /** Whether the modal is minimized */
  isMinimized?: boolean;
  /** Callback to toggle minimized state */
  onToggleMinimize?: () => void;
  /** Whether to highlight the border (e.g., when about to close) */
  isHighlighted?: boolean;
}

// MAGIC: sizing constraints tuned for usability in floating mode
const DEFAULT_CHART_ID = 'chart-1';
const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 600;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;
const HEADER_HEIGHT = 32;
const MAX_WIDTH = 1100;
const MAX_HEIGHT = 700;
const VIEWPORT_PADDING = 64;
const HEIGHT_RATIO = 0.85;
const CASCADE_OFFSET_STEP = 30;

const getBorderColor = (isHighlighted: boolean) =>
  isHighlighted ? 'border-destructive border-2' : 'border-border';

/**
 * Modal window for viewing realtime chart in a floating draggable/resizable window.
 * Supports both realtime and historical data modes.
 * Uses existing store data - no additional Firebase requests for realtime mode.
 */
const ChartModal: React.FC<ChartModalProps> = ({ 
  isOpen, 
  onClose,
  onActivate,
  chartId = DEFAULT_CHART_ID,
  chartIndex = 1,
  historicalTimestamp,
  isMinimized = false,
  onToggleMinimize,
  isHighlighted = false,
}) => {
  // Get data from store (no additional Firebase requests)
  const deviceId = useStoveStore(state => state.deviceId);
  const currentData = useStoveStore(state => state.currentData);
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);
  const connectionStatus = useStoveStore(state => state.connectionStatus);
  const deviceMetadata = useStoveStore(state => state.deviceMetadata);
  const deviceConfig = useStoveStore(state => state.deviceConfig);

  // Historical data loading
  const { loadHistoricalData } = useHistoricalData();
  const [historicalData, setHistoricalData] = useState<any>(null);
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(false);
  const [historicalDateDisplay, setHistoricalDateDisplay] = useState<string | null>(null);
  const historicalDataLoadedRef = useRef<string | null>(null);
  
  // Tiling system
  const tiling = useTiling();
  
  // Modal position and size state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number }>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [isDragging, setIsDragging] = useState(false);
  
  // Store size before minimize to restore later
  const sizeBeforeMinimizeRef = useRef<{ width: number; height: number }>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  
  // Refs for drag/resize handling
  const modalRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const resizeStateRef = useRef<{
    resizing: boolean;
    edge: { n: boolean; s: boolean; e: boolean; w: boolean };
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  }>({
    resizing: false,
    edge: { n: false, s: false, e: false, w: false },
    startMouseX: 0,
    startMouseY: 0,
    startX: 0,
    startY: 0,
    startWidth: DEFAULT_WIDTH,
    startHeight: DEFAULT_HEIGHT,
  });

  // Load historical data when timestamp is provided - only once per timestamp
  useEffect(() => {
    if (!historicalTimestamp || !isOpen) return;
    
    // Prevent loading the same timestamp multiple times
    if (historicalDataLoadedRef.current === historicalTimestamp) return;
    
    const loadData = async () => {
      setIsLoadingHistorical(true);
      historicalDataLoadedRef.current = historicalTimestamp;
      
      try {
        const data = await loadHistoricalData(historicalTimestamp);
        if (data) {
          setHistoricalData(data);
          // Format date for display
          const ts = parseInt(historicalTimestamp, 10);
          const dateStr = formatHistoricalDateWithUserTimezone(new Date(ts * 1000), 'de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          setHistoricalDateDisplay(dateStr);
        }
      } catch (error) {
        console.error('[ChartModal] Failed to load historical data:', error);
        historicalDataLoadedRef.current = null; // Allow retry on error
      } finally {
        setIsLoadingHistorical(false);
      }
    };
    
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historicalTimestamp, isOpen]);

  // Parse base timestamp for historical data
  const historicalBaseTimestamp = historicalTimestamp ? parseInt(historicalTimestamp, 10) : undefined;

  // Register with tiling system
  useEffect(() => {
    tiling.registerWindow(chartId);
    return () => tiling.unregisterWindow(chartId);
  }, [tiling.registerWindow, tiling.unregisterWindow, chartId]);

  // Notify tiling system when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      tiling.openWindow(chartId);
    } else {
      tiling.closeWindow(chartId);
    }
  }, [isOpen, tiling.openWindow, tiling.closeWindow, chartId]);

  // Initialize position and size when modal opens
  useEffect(() => {
    if (!isOpen) return;
    
    // Use tiling position if enabled
    if (tiling.tilingEnabled) {
      const tile = tiling.getTilePosition(chartId);
      setPosition({ x: tile.x, y: tile.y });
      setSize({ width: tile.width, height: tile.height });
      return;
    }
    
    // Otherwise use default centered position with offset based on index
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const initialWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, viewportWidth - VIEWPORT_PADDING));
    const initialHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.floor(viewportHeight * HEIGHT_RATIO)));
    setSize({ width: initialWidth, height: initialHeight });
    sizeBeforeMinimizeRef.current = { width: initialWidth, height: initialHeight };
    
    // Offset position based on chart index to cascade windows
    const offset = (chartIndex - 1) * CASCADE_OFFSET_STEP;
    const initialX = Math.max(8, Math.round((viewportWidth - initialWidth) / 2) + offset);
    const initialY = Math.max(16, Math.round((viewportHeight - initialHeight) / 2) + offset);
    setPosition({ x: initialX, y: initialY });
  }, [isOpen, tiling.tilingEnabled, tiling.getTilePosition, tiling.openWindows, chartId, chartIndex]);

  // Handle minimize state changes
  useEffect(() => {
    if (isMinimized) {
      sizeBeforeMinimizeRef.current = { ...size };
      setSize({ width: size.width, height: HEADER_HEIGHT });
    } else if (sizeBeforeMinimizeRef.current.height > HEADER_HEIGHT) {
      setSize(sizeBeforeMinimizeRef.current);
    }
  }, [isMinimized]);

  // Drag handlers
  const onHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!modalRef.current) return;
    // Don't start drag if clicking on buttons
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const rect = modalRef.current.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDragging(true);
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!modalRef.current) return;
      const rect = modalRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;

      const maxX = Math.max(0, viewportWidth - rect.width);
      const maxY = Math.max(0, viewportHeight - rect.height);

      setPosition({
        x: Math.min(Math.max(0, newX), maxX),
        y: Math.min(Math.max(0, newY), maxY)
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Resize handlers
  const beginResize = useCallback((edge: { n: boolean; s: boolean; e: boolean; w: boolean }) => 
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isMinimized) return; // Don't allow resize when minimized
      e.preventDefault();
      resizeStateRef.current = {
        resizing: true,
        edge,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startX: position.x,
        startY: position.y,
        startWidth: size.width,
        startHeight: size.height,
      };
      document.body.style.userSelect = 'none';
    }, [position.x, position.y, size.width, size.height, isMinimized]);

  useEffect(() => {
    if (!isOpen) return;

    const onMove = (e: MouseEvent) => {
      const st = resizeStateRef.current;
      if (!st.resizing) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newWidth = st.startWidth;
      let newHeight = st.startHeight;
      let newX = st.startX;
      let newY = st.startY;

      const dx = e.clientX - st.startMouseX;
      const dy = e.clientY - st.startMouseY;

      if (st.edge.e) {
        newWidth = Math.max(MIN_WIDTH, Math.min(viewportWidth - newX - 8, st.startWidth + dx));
      }
      if (st.edge.s) {
        newHeight = Math.max(MIN_HEIGHT, Math.min(viewportHeight - newY - 8, st.startHeight + dy));
      }
      if (st.edge.w) {
        const maxLeft = st.startX + st.startWidth - MIN_WIDTH;
        newX = Math.max(0, Math.min(maxLeft, st.startX + dx));
        newWidth = Math.max(MIN_WIDTH, st.startWidth - (newX - st.startX));
      }
      if (st.edge.n) {
        const maxTop = st.startY + st.startHeight - MIN_HEIGHT;
        newY = Math.max(0, Math.min(maxTop, st.startY + dy));
        newHeight = Math.max(MIN_HEIGHT, st.startHeight - (newY - st.startY));
      }

      setPosition({ x: Math.round(newX), y: Math.round(newY) });
      setSize({ width: Math.round(newWidth), height: Math.round(newHeight) });
      sizeBeforeMinimizeRef.current = { width: Math.round(newWidth), height: Math.round(newHeight) };
    };

    const onUp = () => {
      if (resizeStateRef.current.resizing) {
        resizeStateRef.current.resizing = false;
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Determine border color - red only when highlighted (close command pending)
  const borderColor = getBorderColor(isHighlighted);

  // Mode label
  const modeLabel = historicalTimestamp ? 'historical' : 'realtime';

  // Not connected state - floating window without backdrop
  if (!deviceId || connectionStatus !== 'online') {
    return (
      <div
        className="fixed z-[60] bg-card rounded-lg p-6 text-center max-w-md shadow-theme-lg border border-border pointer-events-auto"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        onMouseDown={() => onActivate?.()}
      >
        <div className="text-destructive text-lg mb-2">Not Connected</div>
        <p className="text-muted-foreground text-sm mb-4">
          Connect to a device first to view the chart.
        </p>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:brightness-95 transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  // Floating window without blocking backdrop - allows interaction with Terminal
  return (
    <div
      ref={modalRef}
      data-window-id={chartId}
      onMouseDown={() => onActivate?.()}
      className={`fixed bg-card rounded-lg flex flex-col border shadow-theme-lg ${borderColor} z-[60] pointer-events-auto transition-[border-color] duration-300`}
      style={{ 
        left: position.x, 
        top: position.y, 
        width: size.width, 
        height: isMinimized ? HEADER_HEIGHT : size.height,
        opacity: tiling.windowOpacity,
        backdropFilter: tiling.windowOpacity < 1 ? 'blur(4px)' : undefined,
      }}
    >
      {/* Header - Linux style */}
      <div
        className={`flex items-center justify-between px-2 py-1 border-b border-border bg-section-header text-section-header-foreground ${isMinimized ? 'rounded-lg' : 'rounded-t-lg'} cursor-move select-none relative z-10`}
        onMouseDown={onHeaderMouseDown}
      >
        <div className="flex items-center gap-1 font-mono text-[11px]">
          <span className="text-success">┌─</span>
          <span className={historicalTimestamp ? 'text-warning' : 'text-info'}>
            chart{chartIndex > 1 ? ` #${chartIndex}` : ''}
          </span>
          <span className="text-muted-foreground">:</span>
          <span className="text-warning">{deviceId}</span>
          {historicalDateDisplay && (
            <>
              <span className="text-muted-foreground mx-1">@</span>
              <span className="text-warning">{historicalDateDisplay}</span>
            </>
          )}
          {isLoadingHistorical && (
            <span className="text-muted-foreground ml-1">(loading...)</span>
          )}
          <span className="text-muted-foreground text-[10px] ml-1">
            ({discoveredParameters.filter(p => p.visible_on_chart).length})
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Minimize/Maximize button */}
          {onToggleMinimize && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}
              className="text-muted-foreground hover:text-warning text-xs px-1.5 py-0.5 rounded hover:bg-muted transition-colors font-mono relative z-20"
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? '[▲]' : '[─]'}
            </button>
          )}
          {/* Close button */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-muted-foreground hover:text-destructive text-xs px-1.5 py-0.5 rounded hover:bg-muted transition-colors font-mono relative z-20"
            title="Close (ESC)"
          >
            [×]
          </button>
        </div>
      </div>

      {/* Chart Content - only show when not minimized */}
      {!isMinimized && (
        <>
          <div className="flex-1 overflow-hidden bg-card p-1 flex flex-col">
            <div className="flex-1 flex flex-col min-h-0">
              <RealtimeChart
                parameters={discoveredParameters}
                currentData={historicalTimestamp ? {} : currentData}
                isHistoricalMode={!!historicalTimestamp}
                deviceId={deviceId || ''}
                stoveModel={deviceMetadata.ofenname || 'N/A'}
                stoveModelInfo={deviceMetadata.ofen ? `Model #${deviceMetadata.ofen}` : ''}
                parameterSet={deviceConfig.verz === '~' || !deviceConfig.verz ? 'Default' : deviceConfig.verz}
                compact={true}
                chartInstanceId={chartId}
                isMainChart={false}
                externalHistoricalData={historicalData}
                externalHistoricalTimestamp={historicalBaseTimestamp}
              />
            </div>
          </div>

          {/* Footer - compact */}
          <div className="px-3 py-1 border-t border-border bg-muted rounded-b-lg">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span className={`opacity-70 ${historicalTimestamp ? 'text-warning' : ''}`}>
                {modeLabel}
              </span>
              <span className="font-mono">
                {historicalTimestamp 
                  ? (historicalData ? `${Object.keys(historicalData).length} events` : 'loading...')
                  : `${Object.keys(currentData).length} values`
                }
              </span>
            </div>
          </div>

          {/* Resize handles - z-0 to stay below header */}
          <div
            className="absolute top-8 bottom-0 left-0 w-1 cursor-w-resize z-0"
            onMouseDown={beginResize({ n: false, s: false, e: false, w: true })}
          />
          <div
            className="absolute top-8 bottom-0 right-0 w-1 cursor-e-resize z-0"
            onMouseDown={beginResize({ n: false, s: false, e: true, w: false })}
          />
          <div
            className="absolute inset-x-0 bottom-0 h-1 cursor-s-resize z-0"
            onMouseDown={beginResize({ n: false, s: true, e: false, w: false })}
          />
          {/* Corner handles - only bottom */}
          <div
            className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-0"
            onMouseDown={beginResize({ n: false, s: true, e: false, w: true })}
          />
          <div
            className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-0"
            onMouseDown={beginResize({ n: false, s: true, e: true, w: false })}
          />
        </>
      )}
    </div>
  );
};

export default ChartModal;

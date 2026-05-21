import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRigStore } from '../store/useRigStore';
import { useTiling } from '../context/TilingContext';
import { getPLValues, getSLValues, getRLValues } from '../utils/parameterTypes';
import { useTranslation } from 'react-i18next';

interface AirFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivate?: () => void;
}

const MIN_WIDTH = 350;
const MIN_HEIGHT = 280;
const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 320;

/**
 * Modal window displaying the AirFlow diagram.
 * Draggable and resizable, integrates with TilingContext.
 * Shows real-time air flow visualization without dev mode.
 */
const AirFlowModal: React.FC<AirFlowModalProps> = ({ isOpen, onClose, onActivate }) => {
  const { t } = useTranslation();
  const currentTheme = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  const isNeo = currentTheme === 'neo-brutalism';
  const modalRef = useRef<HTMLDivElement>(null);
  const tiling = useTiling();

  // Get data from store (no additional Firebase requests)
  const deviceId = useRigStore(state => state.deviceId);
  const currentData = useRigStore(state => state.currentData);
  const connectionStatus = useRigStore(state => state.connectionStatus);
  const discoveredParameters = useRigStore(state => state.discoveredParameters);

  // Position and size state
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });

  // Register with tiling context
  useEffect(() => {
    if (isOpen) {
      tiling.registerWindow('airflow');
      tiling.openWindow('airflow');
    }
    return () => {
      if (isOpen) {
        tiling.closeWindow('airflow');
      }
    };
  }, [isOpen]);

  // Apply tiling position when layout changes
  useEffect(() => {
    const tilePos = tiling.getTilePosition('airflow');
    if (tilePos && (tiling.layoutMode as any) !== 'free') {
      setPosition({ x: tilePos.x, y: tilePos.y });
      setSize({ width: tilePos.width, height: tilePos.height });
    }
  }, [tiling.layoutMode, tiling.openWindows]);

  // Header drag handlers
  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  }, [position]);

  // Resize handlers
  const onResizeMouseDown = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y,
    });
  }, [size, position]);

  // Global mouse move/up for drag and resize
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragOffset.x));
        const newY = Math.max(0, Math.min(window.innerHeight - size.height, e.clientY - dragOffset.y));
        setPosition({ x: newX, y: newY });
      }

      if (isResizing && resizeDirection) {
        const dx = e.clientX - resizeStart.x;
        const dy = e.clientY - resizeStart.y;
        let newWidth = resizeStart.width;
        let newHeight = resizeStart.height;
        let newX = resizeStart.posX;
        let newY = resizeStart.posY;

        if (resizeDirection.includes('e')) newWidth = Math.max(MIN_WIDTH, resizeStart.width + dx);
        if (resizeDirection.includes('w')) {
          newWidth = Math.max(MIN_WIDTH, resizeStart.width - dx);
          newX = resizeStart.posX + resizeStart.width - newWidth;
        }
        if (resizeDirection.includes('s')) newHeight = Math.max(MIN_HEIGHT, resizeStart.height + dy);
        if (resizeDirection.includes('n')) {
          newHeight = Math.max(MIN_HEIGHT, resizeStart.height - dy);
          newY = resizeStart.posY + resizeStart.height - newHeight;
        }

        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, resizeDirection, resizeStart, size.width, size.height]);

  // Get parameter color
  const getParameterColor = useCallback((paramId: string): string => {
    const param = discoveredParameters.find((p) => p.originalName === paramId);
    return param?.color ?? '#3b82f6';
  }, [discoveredParameters]);

  // Real-time air flow data
  const screenAirData = useMemo(() => {
    const pl = getPLValues(currentData);
    return {
      angle: pl.winkel,
      motorAngle: pl.motorWinkel,
      percent: pl.prozent.toFixed(0),
      color: getParameterColor('PL'),
    };
  }, [currentData, getParameterColor]);

  const rearAirData = useMemo(() => {
    const sl = getSLValues(currentData);
    return {
      angle: sl.winkel,
      motorAngle: sl.motorWinkel,
      percent: sl.prozent.toFixed(0),
      color: getParameterColor('SL'),
    };
  }, [currentData, getParameterColor]);

  const grateAirData = useMemo(() => {
    const rl = getRLValues(currentData);
    const angle = rl.winkel || rl.prozent;
    return { angle };
  }, [currentData]);

  // SVG Diagram renderer
  const renderDiagram = () => (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 450 200"
      preserveAspectRatio="xMidYMid meet"
      className="max-w-full"
    >
      <title>{t('airflow.diagramTitle', { suffix: '' })}</title>

      {/* PL flap (left) */}
      <g transform={`rotate(${-screenAirData.angle} 100 190)`}>
        <polygon
          points="200,190 200,40 150,80 100,190"
          style={{
            stroke: '#374151',
            strokeWidth: 1,
            fill: screenAirData.color,
          }}
        />
        <text
          fontFamily="monospace"
          fontSize="14"
          fontWeight="bold"
          fill="white"
          x="150"
          y="185"
          textAnchor="middle"
        >
          {screenAirData.percent}%
        </text>
      </g>

      {/* SL flap (right) */}
      <g transform={`rotate(${rearAirData.angle} 310 190)`}>
        <polygon
          points="210,190 210,40 260,80 310,190"
          style={{
            stroke: '#374151',
            strokeWidth: 1,
            fill: rearAirData.color,
          }}
        />
        <text
          fontFamily="monospace"
          fontSize="14"
          fontWeight="bold"
          fill="white"
          x="260"
          y="185"
          textAnchor="middle"
        >
          {rearAirData.percent}%
        </text>
      </g>

      {/* RL grate (bottom-right) */}
      <g transform={`rotate(${grateAirData.angle} 420 100)`}>
        <polyline
          points="350,100 420,100 420,120"
          style={{ stroke: '#6b7280', strokeWidth: 5, fill: 'none' }}
        />
      </g>

      {/* Motor indicators (pink) */}
      <polyline
        points="70,190 130,190"
        style={{ fill: 'none', stroke: '#f472b6', strokeWidth: 8 }}
        transform={`rotate(${-screenAirData.motorAngle} 100 190)`}
      />
      <polyline
        points="280,190 340,190"
        style={{ fill: 'none', stroke: '#f472b6', strokeWidth: 8 }}
        transform={`rotate(${rearAirData.motorAngle} 310 190)`}
      />

      {/* Labels */}
      <text x="100" y="20" fontFamily="monospace" fontSize="11" fill="#9ca3af" textAnchor="middle">PL</text>
      <text x="310" y="20" fontFamily="monospace" fontSize="11" fill="#9ca3af" textAnchor="middle">SL</text>
      <text x="385" y="85" fontFamily="monospace" fontSize="11" fill="#9ca3af" textAnchor="middle">RL</text>
    </svg>
  );

  if (!isOpen) return null;

  // Not connected state
  if (!deviceId || connectionStatus !== 'online') {
    return (
      <div 
        className="fixed z-[60] bg-card text-foreground rounded-xl p-6 text-center max-w-md shadow-xl border border-border pointer-events-auto"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        onMouseDown={() => onActivate?.()}
      >
        <div className="text-destructive text-lg mb-2">Not Connected</div>
        <p className="text-muted-foreground text-sm mb-4">
          Connect to a device first to view the air flow diagram.
        </p>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div
      ref={modalRef}
      data-window-id="airflow"
      onMouseDown={() => onActivate?.()}
      className="fixed bg-card text-foreground rounded-xl flex flex-col border border-border shadow-xl z-[60] pointer-events-auto"
      style={{ 
        left: position.x, 
        top: position.y, 
        width: size.width, 
        height: size.height,
        opacity: tiling.windowOpacity,
        backdropFilter: tiling.windowOpacity < 1 ? 'blur(4px)' : undefined,
      }}
    >
      {/* Header - Linux style */}
      <div
        className="flex items-center justify-between px-2 py-1 border-b border-border bg-muted/70 dark:bg-muted/50 text-foreground rounded-t-xl cursor-move select-none relative z-10"
        onMouseDown={onHeaderMouseDown}
      >
        <div className="flex items-center gap-1 font-mono text-[11px]">
          <span className="text-primary">┌─</span>
          <span className="text-foreground">airflow</span>
          <span className="text-muted-foreground">:</span>
          <span className="text-warning">{deviceId}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-muted-foreground hover:text-destructive text-xs px-1.5 py-0.5 rounded hover:bg-muted transition-colors font-mono relative z-20 border border-border"
          title="Close (ESC)"
        >
          [×]
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-2 flex items-center justify-center bg-muted/30">
        {renderDiagram()}
      </div>

      {/* Info bar */}
      <div className={isNeo ? 'px-2 py-1 border-t border-border bg-card font-mono text-[10px] text-muted-foreground flex justify-between' : 'px-2 py-1 border-t border-gray-700/50 bg-gray-800/80 font-mono text-[10px] text-gray-500 flex justify-between'}>
        <span>PL: {screenAirData.percent}% | SL: {rearAirData.percent}% | RL: {grateAirData.angle?.toFixed(0) ?? '—'}°</span>
        <span className={isNeo ? 'text-success' : 'text-green-500/70'}>● live</span>
      </div>

      {/* Resize handles */}
      <div className="absolute right-0 top-8 bottom-4 w-1 cursor-e-resize hover:bg-blue-500/30 z-0" onMouseDown={(e) => onResizeMouseDown(e, 'e')} />
      <div className="absolute left-0 top-8 bottom-4 w-1 cursor-w-resize hover:bg-blue-500/30 z-0" onMouseDown={(e) => onResizeMouseDown(e, 'w')} />
      <div className="absolute bottom-0 left-4 right-4 h-1 cursor-s-resize hover:bg-blue-500/30 z-0" onMouseDown={(e) => onResizeMouseDown(e, 's')} />
      <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize hover:bg-blue-500/30 z-0" onMouseDown={(e) => onResizeMouseDown(e, 'se')} />
      <div className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize hover:bg-blue-500/30 z-0" onMouseDown={(e) => onResizeMouseDown(e, 'sw')} />
    </div>
  );
};

export default AirFlowModal;


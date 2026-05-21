import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useStoveStore } from '../store/useStoveStore';
import { useParameterFormatting } from '../hooks/useParameterDiscovery';
import { useTiling } from '../context/TilingContext';
import type { ParameterInfo } from '../types';
import type { ThemeName } from '../hooks/useTheme';

interface ParameterCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivate?: () => void;
}

/**
 * Groups parameters by their category for display.
 */
interface CategoryGroup {
  name: string;
  parameters: ParameterInfo[];
}

/**
 * Modal window for viewing all parameters in a compact table format.
 * Features draggable/resizable window, grouped by categories, real-time updates.
 * Uses existing store data - no additional Firebase requests.
 */
const ParameterCardsModal: React.FC<ParameterCardsModalProps> = ({ isOpen, onClose, onActivate }) => {
  // Get data from store (no additional Firebase requests)
  const deviceId = useStoveStore(state => state.deviceId);
  const currentData = useStoveStore(state => state.currentData);
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);
  const connectionStatus = useStoveStore(state => state.connectionStatus);
  
  const { formatParameterValue } = useParameterFormatting();
  const [themeName, setThemeName] = useState<ThemeName>('default');
  const isNeo = themeName === 'neo-brutalism';
  
  // Tiling system
  const tiling = useTiling();
  
  // Modal position and size state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 700, height: 500 });
  const [isDragging, setIsDragging] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
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
    startWidth: 700,
    startHeight: 500,
  });

  const MIN_WIDTH = 400;
  const MIN_HEIGHT = 300;

  // Register with tiling system
  useEffect(() => {
    tiling.registerWindow('params');
    return () => tiling.unregisterWindow('params');
  }, [tiling.registerWindow, tiling.unregisterWindow]);

  // Notify tiling system when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      tiling.openWindow('params');
    } else {
      tiling.closeWindow('params');
    }
  }, [isOpen, tiling.openWindow, tiling.closeWindow]);

  // Initialize position and size when modal opens
  useEffect(() => {
    if (!isOpen) return;
    
    // Use tiling position if enabled
    if (tiling.tilingEnabled) {
      const tile = tiling.getTilePosition('params');
      setPosition({ x: tile.x, y: tile.y });
      setSize({ width: tile.width, height: tile.height });
      return;
    }
    
    // Otherwise use default centered position
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const initialWidth = Math.min(800, Math.max(MIN_WIDTH, viewportWidth - 64));
    const initialHeight = Math.min(600, Math.max(MIN_HEIGHT, Math.floor(viewportHeight * 0.75)));
    setSize({ width: initialWidth, height: initialHeight });
    
    const initialX = Math.max(8, Math.round((viewportWidth - initialWidth) / 2));
    const initialY = Math.max(16, Math.round((viewportHeight - initialHeight) / 2));
    setPosition({ x: initialX, y: initialY });
  }, [isOpen, tiling.tilingEnabled, tiling.getTilePosition, tiling.openWindows]);

  // Drag handlers
  const onHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!modalRef.current) return;
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
    }, [position.x, position.y, size.width, size.height]);

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

  // Group parameters by category
  const categoryGroups = useMemo((): CategoryGroup[] => {
    const groups: Record<string, ParameterInfo[]> = {};
    
    discoveredParameters.forEach(param => {
      const category = (param as any).kategorie || 'Hauptkategorie';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(param);
    });

    // Convert to array and sort
    return Object.entries(groups)
      .map(([name, parameters]) => ({
        name,
        parameters: parameters.sort((a, b) => {
          const aName = a.displayName || a.originalName;
          const bName = b.displayName || b.originalName;
          return aName.localeCompare(bName);
        })
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [discoveredParameters]);

  // Filter parameters by search term
  const filteredGroups = useMemo((): CategoryGroup[] => {
    if (!searchTerm.trim()) return categoryGroups;
    
    const term = searchTerm.toLowerCase();
    return categoryGroups
      .map(group => ({
        ...group,
        parameters: group.parameters.filter(p => 
          p.originalName.toLowerCase().includes(term) ||
          (p.displayName?.toLowerCase().includes(term)) ||
          (p.description?.toLowerCase().includes(term))
        )
      }))
      .filter(group => group.parameters.length > 0);
  }, [categoryGroups, searchTerm]);

  // Total parameter count
  const totalParams = useMemo(() => 
    filteredGroups.reduce((sum, g) => sum + g.parameters.length, 0), 
    [filteredGroups]
  );

  // Toggle category collapse
  const toggleCategory = useCallback((categoryName: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  }, []);

  // Format value for display
  const getFormattedValue = useCallback((param: ParameterInfo): string => {
    const rawValue = currentData[param.originalName];
    if (rawValue === undefined || rawValue === null) return '—';
    // Convert boolean to number for formatting function
    const value = typeof rawValue === 'boolean' ? (rawValue ? 1 : 0) : rawValue;
    return formatParameterValue(value, param);
  }, [currentData, formatParameterValue]);

  if (!isOpen) return null;

  // Not connected state - floating window without backdrop
  if (!deviceId || connectionStatus !== 'online') {
    return (
      <div 
        className={isNeo ? 'fixed z-[60] bg-card rounded-lg p-6 text-center max-w-md shadow-theme-lg border border-border pointer-events-auto' : 'fixed z-[60] bg-gray-900 rounded-lg p-6 text-center max-w-md shadow-2xl border border-gray-700 pointer-events-auto'}
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        onMouseDown={() => onActivate?.()}
      >
        <div className={isNeo ? 'text-destructive text-lg mb-2' : 'text-red-400 text-lg mb-2'}>Not Connected</div>
        <p className={isNeo ? 'text-muted-foreground text-sm mb-4' : 'text-gray-400 text-sm mb-4'}>
          Connect to a device first to view parameters.
        </p>
        <button
          onClick={onClose}
          className={isNeo ? 'px-4 py-2 bg-primary text-primary-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95' : 'px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors'}
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
        data-window-id="params"
        onMouseDown={() => onActivate?.()}
        className={isNeo ? 'fixed bg-card rounded-lg flex flex-col border border-border shadow-theme-lg z-[60] pointer-events-auto' : 'fixed bg-gray-900 rounded-lg flex flex-col border border-gray-700 shadow-2xl z-[60] pointer-events-auto'}
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
          className={isNeo ? 'flex items-center justify-between px-2 py-1 border-b border-border bg-section-header text-section-header-foreground rounded-t-lg cursor-move select-none relative z-10' : 'flex items-center justify-between px-2 py-1 border-b border-gray-700/50 bg-gray-800 rounded-t-lg cursor-move select-none relative z-10'}
          onMouseDown={onHeaderMouseDown}
        >
          <div className="flex items-center gap-1 font-mono text-[11px]">
            <span className="text-green-500">┌─</span>
            <span className={isNeo ? 'text-info' : 'text-cyan-400'}>params</span>
            <span className={isNeo ? 'text-muted-foreground' : 'text-gray-600'}>:</span>
            <span className={isNeo ? 'text-warning' : 'text-yellow-500/80'}>{deviceId}</span>
            <span className={isNeo ? 'text-muted-foreground text-[10px] ml-1' : 'text-gray-500 text-[10px] ml-1'}>({totalParams})</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className={isNeo ? 'text-muted-foreground hover:text-destructive text-xs px-1.5 py-0.5 rounded hover:bg-muted transition-colors font-mono relative z-20' : 'text-gray-500 hover:text-red-400 text-xs px-1.5 py-0.5 rounded hover:bg-gray-700/50 transition-colors font-mono relative z-20'}
            title="Close (ESC)"
          >
            [×]
          </button>
        </div>

        {/* Search bar - compact */}
        <div className={isNeo ? 'px-3 py-1.5 border-b border-border bg-muted' : 'px-3 py-1.5 border-b border-gray-700/50 bg-gray-850/50'}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
            className={isNeo ? 'w-full px-2 py-1 bg-card border border-border rounded text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:bg-card' : 'w-full px-2 py-1 bg-gray-800/50 border border-gray-700/50 rounded text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 focus:bg-gray-800'}
          />
        </div>

        {/* Content - Parameter table */}
        <div className={isNeo ? 'flex-1 overflow-y-auto p-2 bg-card' : 'flex-1 overflow-y-auto p-2 bg-gray-900/95'}>
          {filteredGroups.length === 0 ? (
            <div className={isNeo ? 'text-center text-muted-foreground py-6 text-xs' : 'text-center text-gray-600 py-6 text-xs'}>
              {searchTerm ? `No match for "${searchTerm}"` : 'No parameters'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredGroups.map(group => {
                const isCollapsed = collapsedCategories.has(group.name);
                
                return (
                  <div key={group.name} className={isNeo ? 'border border-border rounded overflow-hidden bg-card' : 'border border-gray-700/50 rounded overflow-hidden'}>
                    {/* Category header */}
                    <button
                      onClick={() => toggleCategory(group.name)}
                      className={isNeo ? 'w-full flex items-center justify-between px-2 py-1 bg-muted hover:bg-muted/80 transition-colors text-left border-b border-border' : 'w-full flex items-center justify-between px-2 py-1 bg-gray-800/50 hover:bg-gray-800 transition-colors text-left'}
                    >
                      <span className={isNeo ? 'text-xs font-medium text-info' : 'text-xs font-medium text-blue-400/90'}>
                        {group.name}
                        <span className={isNeo ? 'text-muted-foreground font-normal ml-1.5 text-[10px]' : 'text-gray-600 font-normal ml-1.5 text-[10px]'}>
                          {group.parameters.length}
                        </span>
                      </span>
                      <span className={isNeo ? 'text-muted-foreground text-[10px]' : 'text-gray-600 text-[10px]'}>
                        {isCollapsed ? '▸' : '▾'}
                      </span>
                    </button>
                    
                    {/* Parameter rows */}
                    {!isCollapsed && (
                      <table className="w-full">
                        <thead>
                          <tr className={isNeo ? 'text-[10px] text-muted-foreground border-b border-border' : 'text-[10px] text-gray-600 border-b border-gray-700/30'}>
                            <th className="text-left px-2 py-1 font-medium">Name</th>
                            <th className="text-right px-2 py-1 font-medium w-28">Value</th>
                            <th className="text-left px-2 py-1 font-medium w-16">Unit</th>
                            <th className="text-center px-2 py-1 font-medium w-12">Acc</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-xs">
                          {group.parameters.map((param, idx) => {
                            const value = getFormattedValue(param);
                            const unit = param.unit && param.unit !== '1' ? param.unit : '';
                            const access = (param as any).zugriff || '';
                            
                            return (
                              <tr 
                                key={param.originalName}
                                className={`${idx % 2 === 0 ? (isNeo ? 'bg-card' : 'bg-gray-900/50') : (isNeo ? 'bg-muted/40' : 'bg-gray-800/30')} ${isNeo ? 'hover:bg-muted' : 'hover:bg-gray-700/50'} transition-colors`}
                              >
                                <td className={isNeo ? 'px-2 py-0.5 text-muted-foreground truncate max-w-[200px]' : 'px-2 py-0.5 text-gray-400 truncate max-w-[200px]'} 
                                    title={param.description || param.originalName}>
                                  {param.displayName || param.originalName}
                                </td>
                                <td className={isNeo ? 'px-2 py-0.5 text-right text-success font-semibold' : 'px-2 py-0.5 text-right text-green-400 font-semibold'}>
                                  {value}
                                </td>
                                <td className={isNeo ? 'px-2 py-0.5 text-muted-foreground text-[10px]' : 'px-2 py-0.5 text-gray-600 text-[10px]'}>
                                  {unit}
                                </td>
                                <td className="px-2 py-0.5 text-center">
                                  <span className={`text-[10px] px-1 py-0.5 rounded ${
                                    access.includes('w') 
                                      ? (isNeo ? 'bg-info/10 text-info' : 'bg-blue-900/30 text-blue-400/80') 
                                      : (isNeo ? 'text-muted-foreground' : 'text-gray-600')
                                  }`}>
                                    {access || '·'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer - compact */}
        <div className={isNeo ? 'px-3 py-1 border-t border-border bg-muted rounded-b-lg' : 'px-3 py-1 border-t border-gray-700/50 bg-gray-800/80 rounded-b-lg'}>
          <div className={isNeo ? 'flex items-center justify-between text-[10px] text-muted-foreground' : 'flex items-center justify-between text-[10px] text-gray-600'}>
            <span className="opacity-70">live</span>
            <span className="font-mono">{Object.keys(currentData).length} values</span>
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
      </div>
  );
};

export default ParameterCardsModal;


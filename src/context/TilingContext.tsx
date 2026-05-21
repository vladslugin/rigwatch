import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

/**
 * Tiling window manager for terminal and modal windows.
 * Automatically arranges windows without overlap.
 */

export interface WindowState {
  id: string;
  isOpen: boolean;
  // User can still manually resize/move, these are just defaults
  manualPosition?: { x: number; y: number };
  manualSize?: { width: number; height: number };
}

export interface TilePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

type LayoutMode = 'horizontal' | 'vertical' | 'grid';

interface TilingContextType {
  // Window management
  registerWindow: (id: string) => void;
  unregisterWindow: (id: string) => void;
  openWindow: (id: string) => void;
  closeWindow: (id: string) => void;
  isWindowOpen: (id: string) => boolean;
  
  // Get calculated tile position for a window
  getTilePosition: (id: string) => TilePosition;
  
  // Layout settings
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  
  // Tiling toggle
  tilingEnabled: boolean;
  setTilingEnabled: (enabled: boolean) => void;
  
  // Window opacity (0-1)
  windowOpacity: number;
  setWindowOpacity: (opacity: number) => void;
  
  // Padding/gaps
  gap: number;
  padding: number;
  
  // List of open windows
  openWindows: string[];
}

const TilingContext = createContext<TilingContextType | null>(null);

// Window order priority (for consistent layout)
const WINDOW_ORDER: Record<string, number> = {
  'terminal': 1,
  'params': 2,
  'chart': 3,
  'airflow': 4,
};

const getWindowPriority = (id: string): number => {
  if (id.startsWith('chart')) return WINDOW_ORDER.chart;
  return WINDOW_ORDER[id] ?? 99;
};

interface TilingProviderProps {
  children: React.ReactNode;
}

export const TilingProvider: React.FC<TilingProviderProps> = ({ children }) => {
  const [windows, setWindows] = useState<Map<string, WindowState>>(new Map());
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('horizontal');
  const [tilingEnabled, setTilingEnabled] = useState(true);
  const [windowOpacity, setWindowOpacity] = useState(1);
  
  const gap = 8; // Gap between windows
  const padding = 16; // Padding from screen edges
  
  // Get list of open windows sorted by priority
  const openWindows = useMemo(() => {
    return Array.from(windows.entries())
      .filter(([_, state]) => state.isOpen)
      .sort((a, b) => getWindowPriority(a[0]) - getWindowPriority(b[0]))
      .map(([id]) => id);
  }, [windows]);
  
  const registerWindow = useCallback((id: string) => {
    setWindows(prev => {
      if (prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, { id, isOpen: false });
      return next;
    });
  }, []);
  
  const unregisterWindow = useCallback((id: string) => {
    setWindows(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);
  
  const openWindow = useCallback((id: string) => {
    setWindows(prev => {
      const state = prev.get(id);
      if (!state || state.isOpen) return prev;
      const next = new Map(prev);
      next.set(id, { ...state, isOpen: true });
      return next;
    });
  }, []);
  
  const closeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const state = prev.get(id);
      if (!state || !state.isOpen) return prev;
      const next = new Map(prev);
      next.set(id, { ...state, isOpen: false });
      return next;
    });
  }, []);
  
  const isWindowOpen = useCallback((id: string) => {
    return windows.get(id)?.isOpen ?? false;
  }, [windows]);
  
  // Calculate tile position for a window based on current layout
  const getTilePosition = useCallback((id: string): TilePosition => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
    
    const availableWidth = viewportWidth - (padding * 2);
    const availableHeight = viewportHeight - (padding * 2);
    
    const windowIndex = openWindows.indexOf(id);
    const totalWindows = openWindows.length;
    
    // If window not found or no windows, return centered default
    if (windowIndex === -1 || totalWindows === 0) {
      return {
        x: padding + availableWidth * 0.1,
        y: padding + availableHeight * 0.1,
        width: availableWidth * 0.8,
        height: availableHeight * 0.8,
      };
    }
    
    // Single window - take most of the screen
    if (totalWindows === 1) {
      return {
        x: padding,
        y: padding,
        width: availableWidth,
        height: availableHeight,
      };
    }
    
    // Multiple windows - calculate based on layout mode
    switch (layoutMode) {
      case 'horizontal': {
        // Split horizontally (side by side)
        const windowWidth = (availableWidth - gap * (totalWindows - 1)) / totalWindows;
        return {
          x: padding + windowIndex * (windowWidth + gap),
          y: padding,
          width: windowWidth,
          height: availableHeight,
        };
      }
      
      case 'vertical': {
        // Split vertically (stacked)
        const windowHeight = (availableHeight - gap * (totalWindows - 1)) / totalWindows;
        return {
          x: padding,
          y: padding + windowIndex * (windowHeight + gap),
          width: availableWidth,
          height: windowHeight,
        };
      }
      
      case 'grid': {
        // Grid layout
        const cols = Math.ceil(Math.sqrt(totalWindows));
        const rows = Math.ceil(totalWindows / cols);
        
        const col = windowIndex % cols;
        const row = Math.floor(windowIndex / cols);
        
        const windowWidth = (availableWidth - gap * (cols - 1)) / cols;
        const windowHeight = (availableHeight - gap * (rows - 1)) / rows;
        
        return {
          x: padding + col * (windowWidth + gap),
          y: padding + row * (windowHeight + gap),
          width: windowWidth,
          height: windowHeight,
        };
      }
      
      default:
        return {
          x: padding,
          y: padding,
          width: availableWidth,
          height: availableHeight,
        };
    }
  }, [openWindows, layoutMode, padding, gap]);
  
  const value = useMemo(() => ({
    registerWindow,
    unregisterWindow,
    openWindow,
    closeWindow,
    isWindowOpen,
    getTilePosition,
    layoutMode,
    setLayoutMode,
    tilingEnabled,
    setTilingEnabled,
    windowOpacity,
    setWindowOpacity,
    gap,
    padding,
    openWindows,
  }), [
    registerWindow,
    unregisterWindow,
    openWindow,
    closeWindow,
    isWindowOpen,
    getTilePosition,
    layoutMode,
    tilingEnabled,
    windowOpacity,
    openWindows,
  ]);
  
  return (
    <TilingContext.Provider value={value}>
      {children}
    </TilingContext.Provider>
  );
};

/**
 * Hook to use the tiling context
 */
export const useTiling = () => {
  const context = useContext(TilingContext);
  if (!context) {
    throw new Error('useTiling must be used within a TilingProvider');
  }
  return context;
};

/**
 * Hook for individual tiled windows
 */
export const useTiledWindow = (windowId: string) => {
  const tiling = useTiling();
  
  // Register on mount, unregister on unmount
  useEffect(() => {
    tiling.registerWindow(windowId);
    return () => tiling.unregisterWindow(windowId);
  }, [windowId, tiling.registerWindow, tiling.unregisterWindow]);
  
  const tilePosition = useMemo(() => {
    if (!tiling.tilingEnabled) return null;
    return tiling.getTilePosition(windowId);
  }, [tiling.tilingEnabled, tiling.getTilePosition, windowId, tiling.openWindows]);
  
  return {
    tilePosition,
    isOpen: tiling.isWindowOpen(windowId),
    open: () => tiling.openWindow(windowId),
    close: () => tiling.closeWindow(windowId),
    tilingEnabled: tiling.tilingEnabled,
  };
};

export default TilingContext;


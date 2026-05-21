/**
 * Utility for saving/loading chart data to/from localStorage
 * Allows chart data to persist across page reloads
 */

interface StoredDataPoint {
  x: number;      // timestamp
  y: number | null;
  originalY: number | null;
  /** Rohwert für Divisor-Neuberechnung nach Reload */
  rawDeviceValue?: number | null;
}

interface StoredDataset {
  paramId: string;
  data: StoredDataPoint[];
}

interface ChartStorageData {
  datasets: StoredDataset[];
  lastTimestamp: number;
  gaps: { start: number; end: number }[];
  savedAt: number;
}

const STORAGE_KEY_PREFIX = 'rigwatch-chart-';
const MAX_POINTS_TO_STORE = 3000; // Limit stored points to prevent localStorage overflow

/**
 * Check if a timestamp is from a previous day (not today)
 */
const isFromPreviousDay = (timestamp: number): boolean => {
  const savedDate = new Date(timestamp);
  const today = new Date();
  
  // Compare only year, month, and day (ignore time)
  return (
    savedDate.getFullYear() !== today.getFullYear() ||
    savedDate.getMonth() !== today.getMonth() ||
    savedDate.getDate() !== today.getDate()
  );
};

/**
 * Get storage key for a device
 */
const getStorageKey = (deviceId: string): string => {
  return `${STORAGE_KEY_PREFIX}${deviceId}`;
};

/**
 * Save chart data to localStorage
 */
export const saveChartData = (
  deviceId: string,
  datasets: any[],
  currentGaps: { start: number; end: number }[] = []
): void => {
  if (!deviceId || deviceId === 'N/A') return;
  
  try {
    // Find the latest timestamp across all datasets
    let lastTimestamp = 0;
    
    // Convert datasets to storable format (only essential data)
    const storedDatasets: StoredDataset[] = datasets.map(dataset => {
      const points = (dataset.data || []).slice(-MAX_POINTS_TO_STORE);
      
      // Track latest timestamp
      if (points.length > 0) {
        const lastPoint = points[points.length - 1];
        if (lastPoint.x > lastTimestamp) {
          lastTimestamp = lastPoint.x;
        }
      }
      
      return {
        paramId: dataset.paramId,
        data: points.map((p: any) => ({
          x: p.x,
          y: p.y,
          originalY: p.originalY,
          ...(p.rawDeviceValue != null && Number.isFinite(p.rawDeviceValue)
            ? { rawDeviceValue: p.rawDeviceValue }
            : {}),
        })),
      };
    });
    
    const storageData: ChartStorageData = {
      datasets: storedDatasets,
      lastTimestamp,
      gaps: currentGaps,
      savedAt: Date.now(),
    };
    
    localStorage.setItem(getStorageKey(deviceId), JSON.stringify(storageData));
  } catch (error) {
    console.warn('[ChartStorage] Failed to save chart data:', error);
    // If storage is full, try to clear old entries
    try {
      clearOldChartData();
      localStorage.setItem(getStorageKey(deviceId), JSON.stringify({
        datasets: [],
        lastTimestamp: 0,
        gaps: [],
        savedAt: Date.now(),
      }));
    } catch {
      // Storage completely full, ignore
    }
  }
};

/**
 * Load chart data from localStorage
 */
export const loadChartData = (deviceId: string): ChartStorageData | null => {
  if (!deviceId || deviceId === 'N/A') return null;
  
  try {
    const stored = localStorage.getItem(getStorageKey(deviceId));
    if (!stored) return null;
    
    const data: ChartStorageData = JSON.parse(stored);
    
    // Check if data is from a previous day (not today)
    if (isFromPreviousDay(data.savedAt)) {
      console.log('[ChartStorage] Stored data is from a previous day, clearing');
      clearChartData(deviceId);
      return null;
    }
    
    return data;
  } catch (error) {
    console.warn('[ChartStorage] Failed to load chart data:', error);
    return null;
  }
};

/**
 * Clear chart data for a specific device
 */
export const clearChartData = (deviceId: string): void => {
  if (!deviceId || deviceId === 'N/A') return;
  
  try {
    localStorage.removeItem(getStorageKey(deviceId));
    console.log('[ChartStorage] Cleared chart data for device:', deviceId);
  } catch (error) {
    console.warn('[ChartStorage] Failed to clear chart data:', error);
  }
};

/**
 * Clear all old chart data entries
 */
export const clearOldChartData = (): void => {
  try {
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        try {
          const stored = localStorage.getItem(key);
          if (stored) {
            const data: ChartStorageData = JSON.parse(stored);
            // Remove data from previous days (not today)
            if (isFromPreviousDay(data.savedAt)) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // Invalid data, remove it
          keysToRemove.push(key);
        }
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    if (keysToRemove.length > 0) {
      console.log('[ChartStorage] Cleared', keysToRemove.length, 'old chart data entries (from previous days)');
    }
  } catch (error) {
    console.warn('[ChartStorage] Failed to clear old data:', error);
  }
};

/**
 * Add a gap (offline period) to the stored data
 */
export const addGapToChartData = (
  deviceId: string,
  gapStart: number,
  gapEnd: number
): void => {
  const data = loadChartData(deviceId);
  if (!data) return;
  
  // Merge overlapping gaps
  const newGap = { start: gapStart, end: gapEnd };
  const mergedGaps = [...data.gaps, newGap].sort((a, b) => a.start - b.start);
  
  const optimizedGaps: { start: number; end: number }[] = [];
  for (const gap of mergedGaps) {
    if (optimizedGaps.length === 0) {
      optimizedGaps.push(gap);
    } else {
      const last = optimizedGaps[optimizedGaps.length - 1];
      if (gap.start <= last.end + 60000) { // Merge if within 1 minute
        last.end = Math.max(last.end, gap.end);
      } else {
        optimizedGaps.push(gap);
      }
    }
  }
  
  data.gaps = optimizedGaps;
  
  try {
    localStorage.setItem(getStorageKey(deviceId), JSON.stringify(data));
  } catch {
    // Ignore storage errors for gaps
  }
};

/**
 * Get all stored device IDs
 */
export const getStoredDeviceIds = (): string[] => {
  const deviceIds: string[] = [];
  
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const deviceId = key.substring(STORAGE_KEY_PREFIX.length);
        deviceIds.push(deviceId);
      }
    }
  } catch {
    // Ignore errors
  }
  
  return deviceIds;
};


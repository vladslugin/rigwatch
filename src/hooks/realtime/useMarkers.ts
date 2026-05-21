import { useCallback, useRef, useState } from 'react';
import type { ChartMarker, ParameterInfo } from '../../types';

type DatasetPoint = {
  x: number;
  y: number | null;
  originalY?: number;
};

type Dataset = {
  hidden?: boolean;
  data: DatasetPoint[];
  paramId: string;
};

interface UseMarkersArgs {
  datasets: Dataset[];
  parameters: ParameterInfo[];
  findClosestIndex: (data: DatasetPoint[], x: number) => number;
  closeValueThresholdMs: number;
  scheduleChartUpdate: () => void;
  saveFixedRange: () => void;
  chartRef: React.MutableRefObject<any>;
  isHistoricalMode: boolean;
  autoScroll: boolean;
  setUserHasScrolled: (v: boolean) => void;
  setAutoScroll: (v: boolean) => void;
}

const EMPTY_MARKER: ChartMarker = { timestamp: null, values: {}, normalizedValues: {} };
const MARKER_SLOTS = 3;
const FIXED_MARKER_COUNT = 2;

export const useMarkers = ({
  datasets,
  parameters,
  findClosestIndex,
  closeValueThresholdMs,
  scheduleChartUpdate,
  saveFixedRange,
  chartRef,
  isHistoricalMode,
  autoScroll,
  setUserHasScrolled,
  setAutoScroll,
}: UseMarkersArgs) => {
  // LEGACY: parameters kept for hook signature parity with callers
  void parameters;
  const [markers, setMarkers] = useState<ChartMarker[]>(Array.from({ length: MARKER_SLOTS }, () => ({ ...EMPTY_MARKER })));

  // Stable cursor tracking without causing re-renders
  const cursorMarkerRef = useRef<ChartMarker>({ ...EMPTY_MARKER });

  const getValuesAtTimestamp = useCallback((timestamp: number, getNormalized = false): Record<string, number> => {
    const values: Record<string, number> = {};
    datasets.forEach(dataset => {
      if (dataset.hidden || !dataset.data.length) return;
      const idx = findClosestIndex(dataset.data, timestamp);
      if (idx !== -1) {
        const closestPoint = dataset.data[idx];
        const minDistance = Math.abs(closestPoint.x - timestamp);
        // MAGIC: threshold-based match for "close enough" point selection in live data
        if (closestPoint && closestPoint.y !== null && minDistance < closeValueThresholdMs) {
          if (getNormalized) {
            values[dataset.paramId] = closestPoint.y;
          } else {
            // WORKAROUND: default to 0 if original value is missing
            values[dataset.paramId] = closestPoint.originalY ?? 0;
          }
        }
      }
    });
    return values;
  }, [datasets, findClosestIndex, closeValueThresholdMs]);

  const clearMarkers = useCallback(() => {
    setMarkers(Array.from({ length: MARKER_SLOTS }, () => ({ ...EMPTY_MARKER })));
  }, []);

  const zoomToMarkers = useCallback(() => {
    if (!markers[0].timestamp || !markers[1].timestamp) {
      console.warn('[RealtimeChart] Set two markers first');
      return;
    }
    const minTime = Math.min(markers[0].timestamp, markers[1].timestamp);
    const maxTime = Math.max(markers[0].timestamp, markers[1].timestamp);
    const range = maxTime - minTime;
    if (range <= 0) {
      console.warn('[RealtimeChart] Markers are at the same time');
      return;
    }
    // MAGIC: 5% padding with 5s minimum keeps UI readable for tiny ranges
    const padding = range * 0.05 || 5000;
    const chart = chartRef.current;
    if (chart) {
      chart.options.scales.x.min = minTime - padding;
      chart.options.scales.x.max = maxTime + padding;
      setUserHasScrolled(true);
      setAutoScroll(false);
      scheduleChartUpdate();
      saveFixedRange();
    }
  }, [markers, chartRef, setUserHasScrolled, setAutoScroll, scheduleChartUpdate, saveFixedRange]);

  const handleChartClick = useCallback((timestampX: number) => {
    const chart = chartRef.current;
    if (!chart) return;

    // Disable auto scroll when placing markers in live mode
    if (!isHistoricalMode && autoScroll) {
      setUserHasScrolled(true);
      setAutoScroll(false);
      saveFixedRange();
    }

    const clickedNormalizedValues = getValuesAtTimestamp(timestampX, true);
    const clickedOriginalValues = getValuesAtTimestamp(timestampX, false);
    const markerData: ChartMarker = {
      timestamp: timestampX,
      values: clickedOriginalValues,
      normalizedValues: clickedNormalizedValues,
    };

    // Check if clicking near existing marker (for removal)
    const viewRange = chart.scales.x.max - chart.scales.x.min;
    // MAGIC: proportional click threshold with 500ms minimum for usability
    const clickThresholdMs = viewRange * 0.005 || 500;

    let clickedOnExistingMarker = -1;
    for (let i = 0; i < FIXED_MARKER_COUNT; i++) {
      if (markers[i].timestamp && Math.abs((markers[i].timestamp as number) - timestampX) < clickThresholdMs) {
        clickedOnExistingMarker = i;
        break;
      }
    }

    if (clickedOnExistingMarker !== -1) {
      setMarkers(prev => {
        const newMarkers = [...prev];
        newMarkers[clickedOnExistingMarker] = { ...EMPTY_MARKER };
        return newMarkers;
      });
      scheduleChartUpdate();
    } else {
      setMarkers(prev => {
        const newMarkers = [...prev];
        const marker0Time = newMarkers[0].timestamp as number | null;
        const marker1Time = newMarkers[1].timestamp as number | null;
        if (marker0Time === null) {
          newMarkers[0] = markerData;
        } else if (marker1Time === null) {
          newMarkers[1] = markerData;
          // LEGACY: keep marker[0] <= marker[1] for downstream assumptions
          if ((newMarkers[0].timestamp as number) > (newMarkers[1].timestamp as number)) {
            [newMarkers[0], newMarkers[1]] = [newMarkers[1], newMarkers[0]];
          }
        } else {
          const markerDistance = Math.abs((marker1Time as number) - (marker0Time as number));
          if (timestampX < (marker0Time as number)) {
            newMarkers[0] = markerData;
          } else if (timestampX > (marker1Time as number)) {
            newMarkers[1] = markerData;
          } else {
            // LEGACY: replace closer marker based on midpoint distance
            if (timestampX < (marker0Time as number) + markerDistance / 2) {
              newMarkers[0] = markerData;
            } else {
              newMarkers[1] = markerData;
            }
          }
        }
        return newMarkers;
      });
      scheduleChartUpdate();
    }
  }, [autoScroll, isHistoricalMode, chartRef, markers, getValuesAtTimestamp, setAutoScroll, setUserHasScrolled, saveFixedRange]);

  return {
    markers,
    setMarkers,
    cursorMarkerRef,
    getValuesAtTimestamp,
    clearMarkers,
    zoomToMarkers,
    handleChartClick,
  } as const;
}; 
import { useCallback } from 'react';
import type { ChartMarker, ParameterInfo } from '../../types';

type DatasetPoint = {
  x: number;
  originalY: number | null;
};

type Dataset = {
  paramId: string;
  hidden?: boolean;
  data: DatasetPoint[];
};

interface UseAnalysisArgs {
  datasets: Dataset[];
  markers: ChartMarker[];
  lowerBound: (data: DatasetPoint[], x: number) => number;
  upperBound: (data: DatasetPoint[], x: number) => number;
  formatDisplayValue: (paramId: string, value: number | null) => string;
}

const START_MARKER_INDEX = 0;
const END_MARKER_INDEX = 1;
const MAX_DISPLAYED_DIFFS = 3;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

const hasTwoMarkers = (markers: ChartMarker[]) =>
  Boolean(markers[START_MARKER_INDEX].timestamp && markers[END_MARKER_INDEX].timestamp);

const getMarkerTimestamp = (markers: ChartMarker[], index: number) =>
  markers[index].timestamp as number;

export const useAnalysis = ({ datasets, markers, lowerBound, upperBound, formatDisplayValue }: UseAnalysisArgs) => {
  const calculateIntegral = useCallback((paramId: string): number => {
    if (!hasTwoMarkers(markers)) return 0;
    const dataset = datasets.find(d => d.paramId === paramId);
    if (!dataset || dataset.hidden || !dataset.data.length) return 0;
    const startTime = getMarkerTimestamp(markers, START_MARKER_INDEX);
    const endTime = getMarkerTimestamp(markers, END_MARKER_INDEX);
    let integral = 0;
    const data = dataset.data;
    const i0 = Math.max(0, lowerBound(data, startTime));
    const i1 = Math.min(data.length - 1, upperBound(data, endTime));
    if (i1 - i0 < 1) return 0;
    for (let i = i0; i < i1; i++) {
      const p1 = data[i];
      const p2 = data[i + 1];
      if (p1.originalY === null || p2.originalY === null) continue;
      const dt = (p2.x - p1.x) / MS_PER_SECOND;
      // WORKAROUND: preserve legacy behavior by falling back to 0 for falsy values
      integral += dt * ((p1.originalY || 0) + (p2.originalY || 0)) / 2;
    }
    return integral;
  }, [datasets, markers, lowerBound, upperBound]);

  const calculateAverage = useCallback((paramId: string): number => {
    if (!hasTwoMarkers(markers)) return 0;
    const dataset = datasets.find(d => d.paramId === paramId);
    if (!dataset || dataset.hidden || !dataset.data.length) return 0;
    const startTime = getMarkerTimestamp(markers, START_MARKER_INDEX);
    const endTime = getMarkerTimestamp(markers, END_MARKER_INDEX);
    const data = dataset.data;
    const i0 = Math.max(0, lowerBound(data, startTime));
    const i1 = Math.min(data.length - 1, upperBound(data, endTime));
    if (i1 < i0) return 0;
    let sum = 0;
    let count = 0;
    for (let i = i0; i <= i1; i++) {
      const p = data[i];
      if (p.originalY !== null) {
        // WORKAROUND: preserve legacy behavior by falling back to 0 for falsy values
        sum += (p.originalY || 0);
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }, [datasets, markers, lowerBound, upperBound]);

  const updateAnalysisText = useCallback(() => {
    if (!hasTwoMarkers(markers)) {
      return 'Results: Set two markers to analyze.';
    }
    const timeDiff = Math.abs(getMarkerTimestamp(markers, END_MARKER_INDEX) - getMarkerTimestamp(markers, START_MARKER_INDEX));
    const timeDiffSec = Math.round(timeDiff / MS_PER_SECOND);
    // MAGIC: one-decimal rounding for minutes is a UX expectation
    const timeDiffMin = Math.round((timeDiffSec / SECONDS_PER_MINUTE) * 10) / 10;
    let analysisText = `Time difference: ${timeDiffSec}s (${timeDiffMin}min)`;
    const valueDiffs: string[] = [];
    const allParamIds = new Set([
      ...Object.keys(markers[START_MARKER_INDEX].values),
      ...Object.keys(markers[END_MARKER_INDEX].values)
    ]);
    allParamIds.forEach(paramId => {
      const dataset = datasets.find(d => d.paramId === paramId);
      if (!dataset || dataset.hidden) return;
      const val0 = (markers[START_MARKER_INDEX].values as Record<string, number>)[paramId];
      const val1 = (markers[END_MARKER_INDEX].values as Record<string, number>)[paramId];
      if (val0 !== undefined && val1 !== undefined) {
        const diff = val1 - val0;
        const formattedDiff = formatDisplayValue(paramId, Math.abs(diff));
        const sign = diff >= 0 ? '+' : '-';
        const paramConfig = dataset; // only for color/label here we skip
        valueDiffs.push(`${paramId}: ${sign}${formattedDiff}`);
      }
    });
    if (valueDiffs.length > 0) {
      // MAGIC: keep output short; UI expects a summary with 3 items max
      analysisText += ` | Δ: ${valueDiffs.slice(0, MAX_DISPLAYED_DIFFS).join(', ')}`;
      if (valueDiffs.length > MAX_DISPLAYED_DIFFS) {
        analysisText += ` (${valueDiffs.length - MAX_DISPLAYED_DIFFS} more...)`;
      }
    }
    return analysisText;
  }, [datasets, markers, formatDisplayValue]);

  return { calculateIntegral, calculateAverage, updateAnalysisText } as const;
}; 
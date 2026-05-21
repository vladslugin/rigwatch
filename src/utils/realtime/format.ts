import type { ChartMarker, ParameterInfo } from '../../types';
import { formatDateWithUserTimezone } from '../timezone';

export interface ColoredValue { name: string; value: string; color: string }
export interface CursorInfoData { time: string; parameters: ColoredValue[]; hasData: boolean }
export interface MarkerInfoData { time: string; parameters: ColoredValue[]; hasData: boolean }

export const buildColoredCursorInfo = (
  markerData: ChartMarker | null,
  datasets: any[],
  parameters: ParameterInfo[],
  formatDisplayValue: (paramId: string, value: number | null) => string
): CursorInfoData | string => {
  if (!markerData || markerData.timestamp === null) {
    return 'Hover over chart for values';
  }
  const time = formatDateWithUserTimezone(markerData.timestamp, 'de-DE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit'
  });
  const parameterInfos: Array<ColoredValue> = [];
  for (const paramId in markerData.values) {
    const dataset = datasets.find((d: any) => d.paramId === paramId);
    if (dataset && !dataset.hidden) {
      const paramConfig = parameters.find((p: any) => p.originalName === paramId);
      if (paramConfig) {
        const formattedVal = formatDisplayValue(paramId, markerData.values[paramId]);
        parameterInfos.push({
          name: paramConfig.displayName || paramConfig.originalName,
          value: formattedVal,
          color: paramConfig.color
        });
      }
    }
  }
  return { time, parameters: parameterInfos, hasData: parameterInfos.length > 0 };
};

export const buildColoredMarkerInfo = (
  markerData: ChartMarker,
  datasets: any[],
  parameters: ParameterInfo[],
  formatDisplayValue: (paramId: string, value: number | null) => string
): MarkerInfoData | string => {
  if (!markerData || markerData.timestamp === null) {
    return `Marker: (click on chart to set)`;
  }
  const time = formatDateWithUserTimezone(markerData.timestamp, 'de-DE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit'
  });
  const parameterInfos: Array<ColoredValue> = [];
  for (const paramId in markerData.values) {
    const dataset = datasets.find((d: any) => d.paramId === paramId);
    if (dataset && !dataset.hidden) {
      const paramConfig = parameters.find((p: any) => p.originalName === paramId);
      if (paramConfig) {
        const formattedVal = formatDisplayValue(paramId, markerData.values[paramId]);
        parameterInfos.push({
          name: paramConfig.displayName || paramConfig.originalName,
          value: formattedVal,
          color: paramConfig.color
        });
      }
    }
  }
  return { time, parameters: parameterInfos, hasData: parameterInfos.length > 0 };
}; 
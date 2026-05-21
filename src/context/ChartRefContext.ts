import React from 'react';

export interface ChartDivElement extends HTMLDivElement {
  addHistoricalDataToChart?: (historicalLog: any, baseTimestamp: number) => void;
  clearChartData?: () => void;
  clearMarkers?: () => void;
  setAutoScroll?: (enabled: boolean) => void;
}

export const ChartRefContext = React.createContext<React.MutableRefObject<ChartDivElement | null> | null>(null);

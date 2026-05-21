import React, { useState, useCallback, useMemo, useRef } from 'react';
import RealtimeChart from './RealtimeChart';
import type { ParameterInfo } from '../types';
import { useTranslation } from 'react-i18next';
import { useRigStore } from '../store/useRigStore';

interface ChartInstance {
  id: string;
  isMain: boolean;
  createdAt: number;
  // Each chart will manage its own internal state for historical data
  // This is just metadata about the instance
}

interface MultiChartContainerProps {
  parameters: ParameterInfo[];
  isHistoricalMode?: boolean;
  deviceId?: string;
  rigModel?: string;
  rigModelInfo?: string;
  parameterSet?: string;
}

// MAGIC: hard cap to keep UI and performance predictable
const MAX_CHARTS = 5;
const MAIN_CHART_ID = 'main';

const createChartInstance = (id: string, isMain: boolean, createdAt: number): ChartInstance => ({
  id,
  isMain,
  createdAt,
});

const MultiChartContainer: React.FC<MultiChartContainerProps> = ({
  parameters,
  isHistoricalMode = false,
  deviceId = 'N/A',
  rigModel = 'N/A',
  rigModelInfo = '',
  parameterSet = 'N/A',
}) => {
  const currentData = useRigStore(state => state.currentData);
  const { t } = useTranslation();
  
  // State to manage multiple chart instances
  const [chartInstances, setChartInstances] = useState<ChartInstance[]>([
    createChartInstance(MAIN_CHART_ID, true, Date.now()),
  ]);
  
  // Ref to track instance counter for unique IDs
  const instanceCounterRef = useRef(1);
  
  // Clone a chart (create new instance)
  const handleCloneChart = useCallback((sourceChartId: string) => {
    if (chartInstances.length >= MAX_CHARTS) {
      console.warn(`[MultiChartContainer] Maximum ${MAX_CHARTS} charts allowed`);
      return;
    }
    
    const newId = `chart-${instanceCounterRef.current++}-${Date.now()}`;
    const newInstance: ChartInstance = {
      id: newId,
      isMain: false,
      createdAt: Date.now(),
    };
    
    setChartInstances(prev => [...prev, newInstance]);
    console.log(`[MultiChartContainer] Cloned chart from ${sourceChartId}, new instance: ${newId}`);
  }, [chartInstances.length]);
  
  // Delete a chart (only non-main charts)
  const handleDeleteChart = useCallback((chartId: string) => {
    setChartInstances(prev => {
      const chart = prev.find(c => c.id === chartId);
      if (chart?.isMain) {
        console.warn('[MultiChartContainer] Cannot delete main chart');
        return prev;
      }
      console.log(`[MultiChartContainer] Deleting chart: ${chartId}`);
      return prev.filter(c => c.id !== chartId);
    });
  }, []);
  
  // Check if can clone more charts
  const canClone = useMemo(() => chartInstances.length < MAX_CHARTS, [chartInstances.length]);
  
  return (
    <div className="space-y-4">
      {chartInstances.map((instance, index) => (
        <div key={instance.id} className="relative">
          {/* Chart number indicator for non-main charts */}
          {!instance.isMain && (
            <div className="absolute -top-2 -left-2 z-10 bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow">
              #{index + 1}
            </div>
          )}
          
          <RealtimeChart
            chartInstanceId={instance.id}
            isMainChart={instance.isMain}
            parameters={parameters}
            currentData={currentData}
            isHistoricalMode={isHistoricalMode}
            deviceId={deviceId}
            rigModel={rigModel}
            rigModelInfo={rigModelInfo}
            parameterSet={parameterSet}
            onCloneChart={canClone ? handleCloneChart : undefined}
            onDeleteChart={instance.isMain ? undefined : handleDeleteChart}
            chartIndex={index}
            totalCharts={chartInstances.length}
          />
        </div>
      ))}
      
      {/* Info about chart limits */}
      {chartInstances.length > 1 && (
        <div className="text-center text-xs text-gray-500 dark:text-gray-400">
          {t('chart.multiChart.count', { current: chartInstances.length, max: MAX_CHARTS })}
        </div>
      )}
    </div>
  );
};

export default MultiChartContainer;


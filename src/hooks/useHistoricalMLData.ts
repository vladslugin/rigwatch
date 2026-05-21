import { useState, useCallback } from 'react';
import { useHistoricalData } from './useFirebase';
import { flattenHistoricalLog, mergeHistoricalLogs } from '../utils/historicalDataUtils';
import { preprocessStoveData } from '../utils/mlEngine';
import type { StoveData, CO2TrainingData, HistoricalLog } from '../types';

interface HistoricalMLDataState {
  isLoading: boolean;
  rawData: StoveData[];
  trainingData: CO2TrainingData[];
  realCO2Count: number;
  totalPoints: number;
  loadedTimestamps: string[];
  error: string | null;
}

export const useHistoricalMLData = () => {
  const { loadHistoricalData } = useHistoricalData();
  
  const [state, setState] = useState<HistoricalMLDataState>({
    isLoading: false,
    rawData: [],
    trainingData: [],
    realCO2Count: 0,
    totalPoints: 0,
    loadedTimestamps: [],
    error: null
  });

  /**
   * Load multiple historical logs and merge them into ML training dataset
   */
  const loadHistoricalMLData = useCallback(async (
    timestamps: string[],
    windowSize: number = 10
  ): Promise<CO2TrainingData[]> => {
    if (timestamps.length === 0) {
      setState(prev => ({ 
        ...prev, 
        error: 'No timestamps provided',
        rawData: [],
        trainingData: [],
        realCO2Count: 0,
        totalPoints: 0
      }));
      return [];
    }

    setState(prev => ({ 
      ...prev, 
      isLoading: true, 
      error: null,
      loadedTimestamps: timestamps
    }));

    try {
      console.log(`[HistoricalML] Loading ${timestamps.length} historical logs for ML training`);
      
      // Load all historical logs in parallel
      const logPromises = timestamps.map(async (timestamp) => {
        const log = await loadHistoricalData(timestamp);
        return log ? { log, baseTimestamp: timestamp } : null;
      });

      const results = await Promise.all(logPromises);
      const validLogs = results.filter((result): result is { log: HistoricalLog; baseTimestamp: string } => 
        result !== null
      );

      if (validLogs.length === 0) {
        throw new Error('No valid historical logs found');
      }

      console.log(`[HistoricalML] Successfully loaded ${validLogs.length}/${timestamps.length} logs`);

      // Merge all logs into chronological order
      const rawData = mergeHistoricalLogs(validLogs);
      console.log(`[HistoricalML] Merged ${rawData.length} raw data points`);

      // Filter out points without CO2 data for statistics
      const pointsWithCO2 = rawData.filter(point => typeof point.CO2 === 'number');
      console.log(`[HistoricalML] Found ${pointsWithCO2.length} points with CO2 measurements`);

      if (pointsWithCO2.length === 0) {
        console.warn('[HistoricalML] No CO2 measurements found in historical data');
      }

      // Convert to training data
      const trainingData = preprocessStoveData(rawData, windowSize);
      const realTargetCount = trainingData.filter(item => item.hasRealTarget).length;

      console.log(`[HistoricalML] Created ${trainingData.length} training examples, ${realTargetCount} with real CO2 targets`);

      setState(prev => ({
        ...prev,
        isLoading: false,
        rawData,
        trainingData,
        realCO2Count: realTargetCount,
        totalPoints: trainingData.length,
        error: null
      }));

      return trainingData;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error loading historical data';
      console.error('[HistoricalML] Error loading historical ML data:', error);
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
        rawData: [],
        trainingData: [],
        realCO2Count: 0,
        totalPoints: 0
      }));

      return [];
    }
  }, [loadHistoricalData]);

  /**
   * Load single historical log for ML
   */
  const loadSingleHistoricalLog = useCallback(async (
    timestamp: string,
    windowSize: number = 10
  ): Promise<CO2TrainingData[]> => {
    return loadHistoricalMLData([timestamp], windowSize);
  }, [loadHistoricalMLData]);

  /**
   * Clear loaded data
   */
  const clearHistoricalMLData = useCallback(() => {
    setState({
      isLoading: false,
      rawData: [],
      trainingData: [],
      realCO2Count: 0,
      totalPoints: 0,
      loadedTimestamps: [],
      error: null
    });
  }, []);

  /**
   * Get statistics about loaded data
   */
  const getDataStatistics = useCallback(() => {
    if (state.trainingData.length === 0) {
      return null;
    }

    const realTargets = state.trainingData
      .filter(item => item.hasRealTarget)
      .map(item => item.target);

    if (realTargets.length === 0) {
      return {
        totalPoints: state.totalPoints,
        realCO2Points: 0,
        coveragePercent: 0,
        co2Range: null,
        timeRange: null
      };
    }

    const timestamps = state.trainingData.map(item => item.timestamp);
    
    return {
      totalPoints: state.totalPoints,
      realCO2Points: state.realCO2Count,
      coveragePercent: (state.realCO2Count / state.totalPoints) * 100,
      co2Range: {
        min: Math.min(...realTargets),
        max: Math.max(...realTargets),
        avg: realTargets.reduce((a, b) => a + b, 0) / realTargets.length
      },
      timeRange: {
        start: Math.min(...timestamps),
        end: Math.max(...timestamps),
        durationHours: (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60)
      }
    };
  }, [state]);

  return {
    ...state,
    loadHistoricalMLData,
    loadSingleHistoricalLog,
    clearHistoricalMLData,
    getDataStatistics
  };
}; 
import { useCallback } from 'react';
import { useLocalSettings } from './useLocalSettings';
import { useStoveStore } from '../store/useStoveStore';
import type { ParameterInfo } from '../types';

export const useChartLegend = () => {
  const { 
    toggleVisibleOnChart, 
    setColor 
  } = useLocalSettings();
  
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);
  const setDiscoveredParameters = useStoveStore(state => state.setDiscoveredParameters);

  // Toggle parameter visibility on chart with local storage
  const toggleParameterVisibility = useCallback(async (paramId: string, visible: boolean) => {
    console.log(`[ChartLegend] Toggling visibility for ${paramId}: ${visible}`);
    
    try {
      // Save to localStorage
      const success = toggleVisibleOnChart(paramId, visible);
      
      if (success) {
        // Update store immediately for UI responsiveness
        const updatedParams = discoveredParameters.map(param => 
          param.originalName === paramId 
            ? { ...param, visible_on_chart: visible }
            : param
        );
        setDiscoveredParameters(updatedParams);
        
        console.log(`[ChartLegend] Successfully toggled visibility for ${paramId}`);
      } else {
        console.error(`[ChartLegend] Failed to save visibility for ${paramId}`);
      }
      
      return success;
    } catch (error) {
      console.error(`[ChartLegend] Error toggling visibility for ${paramId}:`, error);
      return false;
    }
  }, [toggleVisibleOnChart, discoveredParameters, setDiscoveredParameters]);

  // Change parameter color with local storage
  const changeParameterColor = useCallback(async (paramId: string, color: string) => {
    console.log(`[ChartLegend] Changing color for ${paramId}: ${color}`);
    
    try {
      // Save to localStorage
      const success = setColor(paramId, color);
      
      if (success) {
        // Update store immediately for UI responsiveness
        const updatedParams = discoveredParameters.map(param => 
          param.originalName === paramId 
            ? { ...param, color }
            : param
        );
        setDiscoveredParameters(updatedParams);
        
        console.log(`[ChartLegend] Successfully changed color for ${paramId}`);
      } else {
        console.error(`[ChartLegend] Failed to save color for ${paramId}`);
      }
      
      return success;
    } catch (error) {
      console.error(`[ChartLegend] Error changing color for ${paramId}:`, error);
      return false;
    }
  }, [setColor, discoveredParameters, setDiscoveredParameters]);

  // Get parameters that should be shown in legend
  const legendParameters = useCallback((): ParameterInfo[] => {
    return discoveredParameters.filter(param => param.show_in_legend);
  }, [discoveredParameters]);

  // Get parameters that are visible on chart
  const visibleParameters = useCallback((): ParameterInfo[] => {
    return discoveredParameters.filter(param => param.show_in_legend && param.visible_on_chart);
  }, [discoveredParameters]);

  // Check if parameter is visible on chart
  const isParameterVisible = useCallback((paramId: string): boolean => {
    const param = discoveredParameters.find(p => p.originalName === paramId);
    return param ? (param.show_in_legend && param.visible_on_chart) : false;
  }, [discoveredParameters]);

  // Get parameter by ID
  const getParameter = useCallback((paramId: string): ParameterInfo | undefined => {
    return discoveredParameters.find(p => p.originalName === paramId);
  }, [discoveredParameters]);

  return {
    toggleParameterVisibility,
    changeParameterColor,
    legendParameters,
    visibleParameters,
    isParameterVisible,
    getParameter,
  };
};

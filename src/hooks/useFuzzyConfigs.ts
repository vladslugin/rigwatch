import { useState, useEffect } from 'react';

export interface FunctionConfig {
  type: 'linear' | 'triangular' | 'inverted_triangular';
  points: number[];
  color: string;
  name: string;
}

export interface FunctionGroup {
  id: string;
  title: string;
  xLabel: string;
  xMax: number;
  xUnit: string;
  functions: {
    positive: FunctionConfig;
    negative: FunctionConfig;
  };
}

// Default configurations (duplicated from FuzzyMembershipVisualizer)
const defaultConfigs: FunctionGroup[] = [
  {
    id: 'performance',
    title: 'Performance Functions (p, p_ph1..p_ph4)',
    xLabel: 'Performance',
    xMax: 100,
    xUnit: '%',
    functions: {
      positive: {
        type: 'linear',
        points: [50, 70],
        color: '#22c55e',
        name: 'good_p'
      },
      negative: {
        type: 'linear',
        points: [60, 80],
        color: '#ef4444',
        name: 'bad_p'
      }
    }
  },
  {
    id: 'ignition_time',
    title: 'Ignition Time (z_ph1)',
    xLabel: 'Time',
    xMax: 1200,
    xUnit: 's',
    functions: {
      positive: {
        type: 'linear',
        points: [300, 800],
        color: '#22c55e',
        name: 'z_ph1_gut'
      },
      negative: {
        type: 'linear',
        points: [300, 800],
        color: '#ef4444',
        name: 'z_ph1_schlecht'
      }
    }
  },
  {
    id: 'main_burn_time',
    title: 'Main Burn Time (z_ph2)',
    xLabel: 'Time',
    xMax: 3000,
    xUnit: 's',
    functions: {
      positive: {
        type: 'triangular',
        points: [1000, 2400, 2520],
        color: '#22c55e',
        name: 'z_ph2_gut'
      },
      negative: {
        type: 'linear',
        points: [1000, 2520],
        color: '#ef4444',
        name: 'z_ph2_schlecht'
      }
    }
  },
  {
    id: 'refuel_time',
    title: 'Refuel Action Time (z_ph3)',
    xLabel: 'Time',
    xMax: 400,
    xUnit: 's',
    functions: {
      positive: {
        type: 'triangular',
        points: [0, 5, 300],
        color: '#22c55e',
        name: 'z_ph3_gut'
      },
      negative: {
        type: 'linear',
        points: [5, 300],
        color: '#ef4444',
        name: 'z_ph3_schlecht2'
      }
    }
  },
  {
    id: 'reheat_time',
    title: 'Re-heating Time (z_ph4)',
    xLabel: 'Time',
    xMax: 300,
    xUnit: 's',
    functions: {
      positive: {
        type: 'linear',
        points: [60, 180],
        color: '#22c55e',
        name: 'z_ph4_gut'
      },
      negative: {
        type: 'linear',
        points: [60, 180],
        color: '#ef4444',
        name: 'z_ph4_schlecht'
      }
    }
  }
];

export const useFuzzyConfigs = () => {
  const [configs, setConfigs] = useState<FunctionGroup[]>(() => {
    try {
      const saved = localStorage.getItem('fuzzy-membership-configs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === defaultConfigs.length) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load saved fuzzy configs:', error);
    }
    return defaultConfigs;
  });

  // Get configuration for a function by its name
  const getFunctionConfig = (functionName: string): FunctionConfig | null => {
    for (const group of configs) {
      if (group.functions.positive.name === functionName) {
        return group.functions.positive;
      }
      if (group.functions.negative.name === functionName) {
        return group.functions.negative;
      }
    }
    return null;
  };

  // Get parameter values (points) for a specific function
  const getFunctionPoints = (functionName: string): number[] => {
    const config = getFunctionConfig(functionName);
    return config?.points || [];
  };

  // Update configurations when localStorage changes (e.g., visualizer open in another tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'fuzzy-membership-configs' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed) && parsed.length === defaultConfigs.length) {
            setConfigs(parsed);
          }
        } catch (error) {
          console.warn('Failed to parse updated fuzzy configs:', error);
        }
      }
    };

    // Also listen to same-tab updates from the visualizer
    const handleLocalUpdate = () => {
      try {
        const saved = localStorage.getItem('fuzzy-membership-configs');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length === defaultConfigs.length) {
            setConfigs(parsed);
          }
        }
      } catch (error) {
        console.warn('Failed to refresh fuzzy configs after local update:', error);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('fuzzy-membership-configs-updated', handleLocalUpdate as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('fuzzy-membership-configs-updated', handleLocalUpdate as EventListener);
    };
  }, []);

  return {
    configs,
    getFunctionConfig,
    getFunctionPoints,
    defaultConfigs
  };
};

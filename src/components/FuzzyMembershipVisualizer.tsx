import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// Types for function configuration
export interface FunctionConfig {
  type: 'linear' | 'triangular' | 'inverted_triangular';
  points: number[]; // transition points for the function
  color: string;
  name: string;
}

export interface FunctionGroup {
  id: string;
  title: string;
  xLabel: string;
  xMax: number;
  xUnit: string;
  inverseMode?: boolean; // bad function is always negative of good
  functions: {
    positive: FunctionConfig;
    negative: FunctionConfig;
  };
}

interface FuzzyMembershipVisualizerProps {
  className?: string;
  isOpen?: boolean;
  onClose?: () => void;
}

// Default configurations for all function groups
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
        points: [50, 70], // good_p: 0 to 50, linear growth 50-70, 1 after 70
        color: 'var(--success)',
        name: 'good_p'
      },
      negative: {
        type: 'linear',
        points: [60, 80], // bad_p: 1 to 60, linear fall 60-80, 0 after 80
        color: 'var(--destructive)',
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
        points: [300, 800], // z_ph1_gut: 1 to 300, linear fall 300-800, 0 after 800
        color: 'var(--success)',
        name: 'z_ph1_gut'
      },
      negative: {
        type: 'linear',
        points: [300, 800], // z_ph1_schlecht: 0 to 300, linear growth 300-800, 1 after 800
        color: 'var(--destructive)',
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
        points: [1000, 2400, 2520], // z_ph2_gut: triangle with peak at 2400
        color: 'var(--success)',
        name: 'z_ph2_gut'
      },
      negative: {
        type: 'linear', // Two separate ranges: schlecht1 (too short) and schlecht2 (too long)
        points: [1000, 2520], // Combined range for display
        color: 'var(--destructive)',
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
        points: [0, 5, 300], // z_ph3_gut: triangle with peak at 5
        color: 'var(--success)',
        name: 'z_ph3_gut'
      },
      negative: {
        type: 'linear', // Two separate types: schlecht1 (too early) and schlecht2 (too late)
        points: [5, 300], // Display range for schlecht2 (too late)
        color: 'var(--destructive)',
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
        points: [60, 180], // z_ph4_gut: 1 to 60, linear fall 60-180, 0 after 180
        color: 'var(--success)',
        name: 'z_ph4_gut'
      },
      negative: {
        type: 'linear',
        points: [60, 180], // z_ph4_schlecht: 0 to 60, linear growth 60-180, 1 after 180
        color: 'var(--destructive)',
        name: 'z_ph4_schlecht'
      }
    }
  }
];

// Function to calculate the membership value at point x
const calculateMembershipValue = (x: number, config: FunctionConfig, group?: FunctionGroup, isNegative?: boolean): number => {
  // If this is a negative function in inverse mode, calculate as 1 - positive
  if (isNegative && group?.inverseMode) {
    const positiveValue = calculateMembershipValue(x, group.functions.positive);
    return 1 - positiveValue;
  }
  const { type, points, name } = config;
  
  switch (type) {
    case 'linear':
      if (points.length !== 2) return 0;
      const [p1, p2] = points;
      
      // Specific logic for each function type
      if (name === 'good_p') {
        // good_p: 0 to 50, linear growth 50-70, 1 after 70
        if (x <= p1) return 0;
        if (x >= p2) return 1;
        return (x - p1) / (p2 - p1);
      } else if (name === 'bad_p') {
        // bad_p: 1 to 60, linear fall 60-80, 0 after 80
        if (x <= p1) return 1;
        if (x >= p2) return 0;
        return (p2 - x) / (p2 - p1);
      } else if (name === 'z_ph1_gut') {
        // z_ph1_gut: 1 to 300, linear fall 300-800, 0 after 800
        if (x <= p1) return 1;
        if (x >= p2) return 0;
        return (p2 - x) / (p2 - p1);
      } else if (name === 'z_ph1_schlecht') {
        // z_ph1_schlecht: 0 to 300, linear growth 300-800, 1 after 800
        if (x <= p1) return 0;
        if (x >= p2) return 1;
        return (x - p1) / (p2 - p1);
      } else if (name === 'z_ph4_gut') {
        // z_ph4_gut: 1 to 60, linear fall 60-180, 0 after 180
        if (x <= p1) return 1;
        if (x >= p2) return 0;
        return (p2 - x) / (p2 - p1);
      } else if (name === 'z_ph4_schlecht') {
        // z_ph4_schlecht: 0 to 60, linear growth 60-180, 1 after 180
        if (x <= p1) return 0;
        if (x >= p2) return 1;
        return (x - p1) / (p2 - p1);
      } else if (name === 'z_ph2_schlecht') {
        // z_ph2_schlecht: combination of schlecht1 (too short) and schlecht2 (too long)
        // schlecht1: 1 to 1000, linear fall 1000-2400, 0 after 2400
        // schlecht2: 0 to 2400, linear growth 2400-2520, 1 after 2520
        if (x <= 1000) return 1; // too short
        if (x <= 2400) return (2400 - x) / (2400 - 1000); // falling edge of schlecht1
        if (x <= 2520) return (x - 2400) / (2520 - 2400); // rising edge of schlecht2
        return 1; // too long
      } else if (name === 'z_ph3_schlecht2') {
        // z_ph3_schlecht2: 0 to 5, linear growth 5-300, 1 after 300
        if (x <= p1) return 0;
        if (x >= p2) return 1;
        return (x - p1) / (p2 - p1);
      }
      break;
      
    case 'triangular':
      if (points.length !== 3) return 0;
      const [start, peak, end] = points;
      
      if (x <= start || x >= end) return 0;
      if (x === peak) return 1;
      if (x < peak) return (x - start) / (peak - start);
      return (end - x) / (end - peak);
      
    case 'inverted_triangular':
      if (points.length !== 3) return 0;
      const [start2, valley, end2] = points;
      
      if (name.includes('schlecht')) {
        // For "bad" functions: high values at the edges, low in the center
        if (x <= start2) return 1;
        if (x >= end2) return 1;
        if (x === valley) return 0;
        if (x < valley) return 1 - (x - start2) / (valley - start2);
        return 1 - (end2 - x) / (end2 - valley);
      } else {
        // For other functions: normal inverted triangle
        if (x <= start2 || x >= end2) return 0;
        if (x === valley) return 1;
        if (x < valley) return (x - start2) / (valley - start2);
        return (end2 - x) / (end2 - valley);
      }
      
    default:
      return 0;
  }
  
  return 0;
};

// Component for rendering a single chart
const FunctionChart: React.FC<{
  group: FunctionGroup;
  onConfigChange: (groupId: string, functionType: 'positive' | 'negative', newConfig: FunctionConfig) => void;
  onXMaxChange: (groupId: string, newXMax: number) => void;
  onUnitChange: (groupId: string, newUnit: string) => void;
  onInverseModeChange: (groupId: string, inverseMode: boolean) => void;
}> = ({ group, onConfigChange, onXMaxChange, onUnitChange, onInverseModeChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedFunction, setSelectedFunction] = useState<'positive' | 'negative' | null>(null);
  
  // Chart rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI canvas settings
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Set physical dimensions
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Scale context for sharpness
    ctx.scale(dpr, dpr);

    // Size settings for calculations
    const width = rect.width;
    const height = rect.height;
    const padding = 40;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    // Resolve theme tokens from CSS custom properties for canvas drawing
    const rootStyles = getComputedStyle(document.documentElement);
    const tokenColor = (name: string, fallback: string) =>
      (rootStyles.getPropertyValue(name).trim() || fallback);
    const resolveColor = (value: string): string => {
      if (!value) return value;
      const trimmed = value.trim();
      const match = trimmed.match(/^var\((--[^,)]+)(?:,\s*([^)]+))?\)$/);
      if (!match) return trimmed;
      const fallback = match[2] ? match[2].trim() : '';
      return rootStyles.getPropertyValue(match[1]).trim() || fallback;
    };
    const cardBg = tokenColor('--card', '#ffffff');
    const borderColor = tokenColor('--border', '#e2e8f0');
    const fgColor = tokenColor('--foreground', '#0f172a');
    const mutedFg = tokenColor('--muted-foreground', '#64748b');

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Background uses card token (adaptive across themes)
    ctx.fillStyle = cardBg;
    ctx.fillRect(0, 0, width, height);

    // Grid uses border token
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    
    // Vertical grid lines
    for (let i = 0; i <= 10; i++) {
      const x = padding + (i / 10) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
    }
    
    // Horizontal grid lines
    for (let i = 0; i <= 10; i++) {
      const y = padding + (i / 10) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }
    
    // Axes use muted foreground token
    ctx.strokeStyle = mutedFg;
    ctx.lineWidth = 2;
    
    // X axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();
    
    // Y axis
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();
    
    // Axis labels use foreground token
    ctx.fillStyle = fgColor;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    
    // X labels
    for (let i = 0; i <= 5; i++) {
      const x = padding + (i / 5) * plotWidth;
      const value = (i / 5) * group.xMax;
      ctx.fillText(`${Math.round(value)}${group.xUnit}`, x, height - 10);
    }
    
    // Y labels
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const y = height - padding - (i / 5) * plotHeight;
      const value = i / 5;
      ctx.fillText(value.toFixed(1), padding - 10, y + 4);
    }
    
    // Function rendering
    const drawFunction = (config: FunctionConfig, isSelected: boolean) => {
      ctx.strokeStyle = resolveColor(config.color);
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.beginPath();
      
      const step = group.xMax / 200; // 200 points for smoothness
      let first = true;
      
      for (let x = 0; x <= group.xMax; x += step) {
        const isNegativeFunc = config === group.functions.negative;
        const y = calculateMembershipValue(x, config, group, isNegativeFunc);
        const canvasX = padding + (x / group.xMax) * plotWidth;
        const canvasY = height - padding - y * plotHeight;
        
        if (first) {
          ctx.moveTo(canvasX, canvasY);
          first = false;
        } else {
          ctx.lineTo(canvasX, canvasY);
        }
      }
      
      ctx.stroke();
      
      // Parameter points
      if (isSelected) {
        ctx.fillStyle = resolveColor(config.color);
        config.points.forEach(point => {
          const canvasX = padding + (point / group.xMax) * plotWidth;
          const isNegativeFunc = config === group.functions.negative;
          const y = calculateMembershipValue(point, config, group, isNegativeFunc);
          const canvasY = height - padding - y * plotHeight;
          
          ctx.beginPath();
          ctx.arc(canvasX, canvasY, 4, 0, 2 * Math.PI);
          ctx.fill();
        });
      }
    };
    
    // Draw functions
    drawFunction(group.functions.positive, selectedFunction === 'positive');
    drawFunction(group.functions.negative, selectedFunction === 'negative');
    
    // Legend (adaptive for dark theme)
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    
    // Positive function
    ctx.fillStyle = resolveColor(group.functions.positive.color);
    ctx.fillRect(width - 150, 20, 12, 12);
    ctx.fillStyle = fgColor;
    ctx.fillText(group.functions.positive.name, width - 135, 31);

    // Negative function
    ctx.fillStyle = resolveColor(group.functions.negative.color);
    ctx.fillRect(width - 150, 40, 12, 12);
    ctx.fillStyle = fgColor;
    ctx.fillText(group.functions.negative.name, width - 135, 51);
    
  }, [group, selectedFunction]);
  
  return (
    <div className="bg-muted p-4 border-l-4 border-border">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 ${
            group.id === 'performance' ? 'bg-info' :
            group.id === 'ignition_time' ? 'bg-success' :
            group.id === 'main_burn_time' ? 'bg-primary' :
            group.id === 'refuel_time' ? 'bg-warning' :
            'bg-destructive'
          }`}></div>
          <h4 className="text-base font-semibold text-foreground">{group.title}</h4>
        </div>

        {/* Function Type Indicators */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded" style={{ backgroundColor: group.functions.positive.color }}></div>
            <span className="text-xs font-medium text-muted-foreground">
              {group.functions.positive.name}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded" style={{ backgroundColor: group.functions.negative.color }}></div>
            <span className="text-xs font-medium text-muted-foreground">
              {group.functions.negative.name}
            </span>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Canvas for the chart */}
        <div className="lg:col-span-3">
          <div className="bg-card p-3 border border-border">
            <canvas
              ref={canvasRef}
              width={800}
              height={400}
              style={{ width: '100%', height: 'auto', maxHeight: '250px' }}
              className="rounded cursor-pointer hover:shadow-md transition-shadow"
              onClick={(e) => {
                // const rect = e.currentTarget.getBoundingClientRect();
                // const _x = e.clientX - rect.left;
                // const _y = e.clientY - rect.top;
                
                // Simple logic to determine function click
                // Can be improved for more accuracy
                if (e.nativeEvent.offsetY < 125) { // top half
                  setSelectedFunction(selectedFunction === 'positive' ? null : 'positive');
                } else { // bottom half  
                  setSelectedFunction(selectedFunction === 'negative' ? null : 'negative');
                }
              }}
            />
            <div className="mt-2 text-center">
              <span className="text-xs text-muted-foreground">
                Click chart to select functions
              </span>
            </div>
          </div>
        </div>
        
        {/* Settings panel */}
        <div className="lg:col-span-2 space-y-3">
          {/* Settings for positive function */}
          <div className={`p-3 ${
            selectedFunction === 'positive'
              ? 'border-l-4 border-success bg-success/10'
              : 'border border-border bg-muted'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3" style={{ backgroundColor: group.functions.positive.color }}></div>
              <span className="text-xs font-semibold text-foreground">
                {group.functions.positive.name}
              </span>
              {selectedFunction === 'positive' && (
                <div className="flex-1 flex justify-end">
                  <span className="text-xs bg-success/20 text-success px-1.5 py-0.5 rounded text-xs">
                    Selected
                  </span>
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <select
                value={group.functions.positive.type}
                onChange={(e) => {
                  const newConfig = {
                    ...group.functions.positive,
                    type: e.target.value as FunctionConfig['type']
                  };
                  onConfigChange(group.id, 'positive', newConfig);
                }}
                className="w-full text-xs px-2 py-1 rounded border border-border bg-background text-foreground h-7"
              >
                <option value="linear">Linear</option>
                <option value="triangular">Triangular</option>
                <option value="inverted_triangular">Inverted Triangular</option>
              </select>
              
              {group.functions.positive.points.map((point, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground w-6">P{i+1}:</span>
                  <input
                    type="number"
                    value={point}
                    onChange={(e) => {
                      const newPoints = [...group.functions.positive.points];
                      newPoints[i] = Number(e.target.value);
                      const newConfig = {
                        ...group.functions.positive,
                        points: newPoints
                      };
                      onConfigChange(group.id, 'positive', newConfig);
                    }}
                    className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background text-foreground h-6"
                    min="0"
                    max={group.xMax}
                  />
                  <span className="text-xs text-muted-foreground w-6">{group.xUnit}</span>
                  {((group.functions.positive.type === 'triangular' && group.functions.positive.points.length > 3) ||
                    (group.functions.positive.type === 'inverted_triangular' && group.functions.positive.points.length > 3) ||
                    (group.functions.positive.type === 'linear' && group.functions.positive.points.length > 2)) && (
                    <button
                      onClick={() => {
                        const newPoints = group.functions.positive.points.filter((_, idx) => idx !== i);
                        const newConfig = {
                          ...group.functions.positive,
                          points: newPoints
                        };
                        onConfigChange(group.id, 'positive', newConfig);
                      }}
                      className="text-destructive hover:text-destructive/80 text-xs p-0.5 rounded hover:bg-destructive/10 w-5 h-5 flex items-center justify-center"
                      title="Remove point"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              
              {(group.functions.positive.type === 'triangular' || group.functions.positive.type === 'inverted_triangular') && group.functions.positive.points.length < 5 && (
                <button
                  onClick={() => {
                    const newPoints = [...group.functions.positive.points];
                    // Add a point in the middle of the range
                    const avgPoint = Math.round((Math.min(...newPoints) + Math.max(...newPoints)) / 2);
                    newPoints.push(avgPoint);
                    newPoints.sort((a, b) => a - b);
                    const newConfig = {
                      ...group.functions.positive,
                      points: newPoints
                    };
                    onConfigChange(group.id, 'positive', newConfig);
                  }}
                  className="text-xs text-primary hover:text-primary/80 py-1"
                >
                  + Add Point
                </button>
              )}
            </div>
          </div>

          {/* Settings for negative function */}
          <div className={`p-3 ${
            selectedFunction === 'negative'
              ? 'border-l-4 border-destructive bg-destructive/10'
              : 'border border-border bg-muted'
          } ${group.inverseMode ? 'opacity-75' : ''}`}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3" style={{ backgroundColor: group.functions.negative.color }}></div>
              <span className="text-xs font-semibold text-foreground">
                {group.functions.negative.name}
              </span>
              {selectedFunction === 'negative' && (
                <div className="flex-1 flex justify-end">
                  <span className="text-xs bg-destructive/20 text-destructive px-1.5 py-0.5 rounded text-xs">
                    Selected
                  </span>
                </div>
              )}
            </div>
            {group.inverseMode && (
              <div className="mb-2 p-2 bg-warning/10 border-l-2 border-warning">
                <span className="text-xs text-warning font-medium flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Auto-generated as inverse
                </span>
              </div>
            )}
            
            <div className="space-y-2">
              <select
                value={group.functions.negative.type}
                onChange={(e) => {
                  if (group.inverseMode) return; // Block changes in inverse mode
                  const newConfig = {
                    ...group.functions.negative,
                    type: e.target.value as FunctionConfig['type']
                  };
                  onConfigChange(group.id, 'negative', newConfig);
                }}
                disabled={group.inverseMode}
                className="w-full text-xs px-2 py-1 rounded border border-border bg-background text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="linear">Linear</option>
                <option value="triangular">Triangular</option>
                <option value="inverted_triangular">Inverted Triangular</option>
              </select>
              
              {group.functions.negative.points.map((point, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground w-8">P{i+1}:</span>
                  <input
                    type="number"
                    value={point}
                    onChange={(e) => {
                      if (group.inverseMode) return; // Block changes in inverse mode
                      const newPoints = [...group.functions.negative.points];
                      newPoints[i] = Number(e.target.value);
                      const newConfig = {
                        ...group.functions.negative,
                        points: newPoints
                      };
                      onConfigChange(group.id, 'negative', newConfig);
                    }}
                    disabled={group.inverseMode}
                    className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                    min="0"
                    max={group.xMax}
                  />
                  <span className="text-xs text-muted-foreground">{group.xUnit}</span>
                  {((group.functions.negative.type === 'triangular' && group.functions.negative.points.length > 3) ||
                    (group.functions.negative.type === 'inverted_triangular' && group.functions.negative.points.length > 3) ||
                    (group.functions.negative.type === 'linear' && group.functions.negative.points.length > 2)) && (
                    <button
                      onClick={() => {
                        if (group.inverseMode) return; // Block changes in inverse mode
                        const newPoints = group.functions.negative.points.filter((_, idx) => idx !== i);
                        const newConfig = {
                          ...group.functions.negative,
                          points: newPoints
                        };
                        onConfigChange(group.id, 'negative', newConfig);
                      }}
                      disabled={group.inverseMode}
                      className="text-destructive hover:text-destructive/80 text-xs p-1 rounded hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Remove point"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              
              {(group.functions.negative.type === 'triangular' || group.functions.negative.type === 'inverted_triangular') && group.functions.negative.points.length < 5 && !group.inverseMode && (
                <button
                  onClick={() => {
                    const newPoints = [...group.functions.negative.points];
                    // Add a point in the middle of the range
                    const avgPoint = Math.round((Math.min(...newPoints) + Math.max(...newPoints)) / 2);
                    newPoints.push(avgPoint);
                    newPoints.sort((a, b) => a - b);
                    const newConfig = {
                      ...group.functions.negative,
                      points: newPoints
                    };
                    onConfigChange(group.id, 'negative', newConfig);
                  }}
                  className="text-xs text-primary hover:text-primary/80"
                >
                  + Add Point
                </button>
              )}
            </div>
          </div>
          
          {/* X-axis range settings */}
          <div className="p-3 border-l-2 border-border bg-muted">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
              <h5 className="text-xs font-semibold text-foreground">Axis Config</h5>
            </div>
            <div className="flex items-center gap-1 mb-2">
              <span className="text-xs text-muted-foreground w-8">Max:</span>
              <input
                type="number"
                value={group.xMax}
                onChange={(e) => {
                  const newValue = Number(e.target.value);
                  if (newValue > 0) {
                    onXMaxChange(group.id, newValue);
                  }
                }}
                className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background text-foreground h-6"
                min="1"
              />
              <span className="text-xs text-muted-foreground w-6">{group.xUnit}</span>
            </div>
            <div className="flex items-center gap-1 mb-2">
              <span className="text-xs text-muted-foreground w-8">Unit:</span>
              <select
                value={group.xUnit}
                onChange={(e) => onUnitChange(group.id, e.target.value)}
                className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background text-foreground h-6"
              >
                <option value="%">%</option>
                <option value="s">s</option>
                <option value="min">min</option>
                <option value="h">h</option>
                <option value="°C">°C</option>
                <option value="K">K</option>
                <option value="kW">kW</option>
                <option value="kg">kg</option>
                <option value="l">l</option>
                <option value="units">units</option>
              </select>
            </div>
            
            {/* Inverse Mode Checkbox */}
            <div className="p-2 bg-info/10 border-l-2 border-info">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`inverse-${group.id}`}
                  checked={group.inverseMode || false}
                  onChange={(e) => onInverseModeChange(group.id, e.target.checked)}
                  className="w-3 h-3 accent-primary bg-background border-border rounded focus:ring-primary focus:ring-2"
                />
                <label
                  htmlFor={`inverse-${group.id}`}
                  className="text-xs text-foreground cursor-pointer font-medium"
                >
                  Auto-inverse mode
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const FuzzyMembershipVisualizer: React.FC<FuzzyMembershipVisualizerProps> = ({ 
  className = '', 
  isOpen = false, 
  onClose 
}) => {
  const { /* t */ } = useTranslation(); // i18n support ready but not used yet
  const [configs, setConfigs] = useState<FunctionGroup[]>(() => {
    // Attempt to load saved settings from localStorage
    try {
      const saved = localStorage.getItem('fuzzy-membership-configs');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Check that the structure is correct
        if (Array.isArray(parsed) && parsed.length === defaultConfigs.length) {
          // Ensure inverseMode is set if not present
          return parsed.map(group => ({
            ...group,
            inverseMode: group.inverseMode || false
          }));
        }
      }
    } catch (error) {
      console.warn('Failed to load saved fuzzy configs:', error);
    }
    return defaultConfigs.map(group => ({
      ...group,
      inverseMode: false
    }));
  });
  
  // Auto-save to localStorage when configuration changes
  const saveToLocalStorage = (newConfigs: FunctionGroup[]) => {
    try {
      localStorage.setItem('fuzzy-membership-configs', JSON.stringify(newConfigs));
      // Notify current tab listeners (storage event doesn't fire in same tab)
      try {
        const evt = new CustomEvent('fuzzy-membership-configs-updated');
        window.dispatchEvent(evt);
      } catch {}
    } catch (error) {
      console.warn('Failed to save fuzzy configs to localStorage:', error);
    }
  };

  const handleConfigChange = (groupId: string, functionType: 'positive' | 'negative', newConfig: FunctionConfig) => {
    const newConfigs = configs.map(group => {
      if (group.id !== groupId) return group;
      // Base update
      let updatedGroup: FunctionGroup = {
        ...group,
        functions: {
          ...group.functions,
          [functionType]: newConfig
        }
      };

      // If inverse mode is enabled, keep negative in sync with positive semantics
      if (updatedGroup.inverseMode && functionType === 'positive') {
        const pos = newConfig;
        const neg = { ...updatedGroup.functions.negative } as FunctionConfig;
        switch (updatedGroup.id) {
          case 'performance':
          case 'ignition_time':
          case 'reheat_time': {
            // Linear inverse with same points works (engine handles orientation)
            neg.type = 'linear';
            neg.points = [...pos.points];
            break;
          }
          case 'main_burn_time': {
            // Inverted triangular mirror of z_ph2_gut
            neg.type = 'inverted_triangular';
            neg.points = [...pos.points];
            break;
          }
          case 'refuel_time': {
            // z_ph3_schlecht2 late: rise from mid to end; sync end to positive end
            const points = [...pos.points].sort((a,b)=>a-b);
            const mid = points[Math.floor(points.length/2)] ?? 5;
            const end = points[points.length-1] ?? 300;
            neg.type = 'linear';
            neg.points = [mid, end];
            break;
          }
        }
        updatedGroup = {
          ...updatedGroup,
          functions: {
            positive: pos,
            negative: neg
          }
        };
      }

      return updatedGroup;
    });
    setConfigs(newConfigs);
    saveToLocalStorage(newConfigs);
  };
  
  const handleXMaxChange = (groupId: string, newXMax: number) => {
    const newConfigs = configs.map(group => 
      group.id === groupId 
        ? { ...group, xMax: newXMax }
        : group
    );
    setConfigs(newConfigs);
    saveToLocalStorage(newConfigs);
  };

  const handleUnitChange = (groupId: string, newUnit: string) => {
    const newConfigs = configs.map(group => 
      group.id === groupId 
        ? { ...group, xUnit: newUnit }
        : group
    );
    setConfigs(newConfigs);
    saveToLocalStorage(newConfigs);
  };

  const handleInverseModeChange = (groupId: string, inverseMode: boolean) => {
    const newConfigs = configs.map(group =>
      group.id === groupId ? { ...group, inverseMode } : group
    );
    setConfigs(newConfigs);
    saveToLocalStorage(newConfigs);
  };
  
  const resetToDefaults = () => {
    const defaultConfigsCopy = [...defaultConfigs];
    setConfigs(defaultConfigsCopy);
    saveToLocalStorage(defaultConfigsCopy);
  };
  
  const exportConfig = () => {
    const configData = JSON.stringify(configs, null, 2);
    const blob = new Blob([configData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fuzzy-membership-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Explicit Save button to persist and notify listeners
  const handleSave = () => {
    saveToLocalStorage(configs);
  };
  
  const importConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string);
        // Validation of imported configuration
        if (Array.isArray(imported) && imported.length === defaultConfigs.length) {
          setConfigs(imported);
          saveToLocalStorage(imported);
        } else {
          console.error('Invalid config structure');
          alert('Invalid configuration file structure');
        }
      } catch (error) {
        console.error('Failed to import config:', error);
        alert('Failed to import configuration file');
      }
    };
    reader.readAsText(file);
    
    // Reset input to allow re-selecting the same file
    event.target.value = '';
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className={`bg-card rounded border border-border max-w-7xl w-full max-h-[95vh] overflow-hidden flex flex-col ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-section-header text-section-header-foreground p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <h2 className="text-xl font-bold">
                Fuzzy Functions Editor
              </h2>
            </div>
            
            <button
              onClick={onClose}
              className="p-2 text-section-header-foreground hover:bg-section-header-foreground/20"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Action Buttons Bar */}
          <div className="flex items-center gap-2">
            <button
              onClick={resetToDefaults}
              className="px-3 py-1.5 text-xs bg-section-header-foreground/20 hover:bg-section-header-foreground/30 text-section-header-foreground flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset
            </button>
            
            <button
              onClick={exportConfig}
              className="px-3 py-1.5 text-xs bg-section-header-foreground/20 hover:bg-section-header-foreground/30 text-section-header-foreground flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export
            </button>
            
            <label className="px-3 py-1.5 text-xs bg-section-header-foreground/20 hover:bg-section-header-foreground/30 text-section-header-foreground cursor-pointer flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
              Import
              <input
                type="file"
                accept=".json"
                onChange={importConfig}
                className="hidden"
              />
            </label>

            <div className="flex-1"></div>

            <button
              onClick={handleSave}
              className="px-4 py-2 text-xs bg-success hover:bg-success/90 text-success-foreground font-medium flex items-center gap-1 border border-success"
              title="Save and apply configuration"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto">
          <div className="p-4">
            {/* Function Groups */}
            <div className="space-y-4">
              {configs.map(group => (
                <FunctionChart
                  key={group.id}
                  group={group}
                  onConfigChange={handleConfigChange}
                  onXMaxChange={handleXMaxChange}
                  onUnitChange={handleUnitChange}
                  onInverseModeChange={handleInverseModeChange}
                />
              ))}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="bg-muted border-t border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Click on chart areas to select functions. Parameters update in real-time.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground">
                Auto-saved to localStorage
              </div>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium border border-border"
              >
                Close Editor
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FuzzyMembershipVisualizer;

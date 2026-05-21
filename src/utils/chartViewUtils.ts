export interface ChartLike {
  options: { scales: { x: { min?: number; max?: number } } };
}

export function recordCurrentRange(chart: ChartLike): { min: number | undefined; max: number | undefined } {
  const range = {
    min: chart?.options?.scales?.x?.min,
    max: chart?.options?.scales?.x?.max,
  };
  // Reduce log spam - only log occasionally
  if (Math.random() < 0.01) { // 1% chance to log
    console.log(`[ChartViewUtils] Recording current range:`, range);
  }
  return range;
}

export function applyFixedRange(chart: ChartLike, range: { min?: number; max?: number }) {
  if (!chart?.options?.scales?.x) {
    console.log(`[ChartViewUtils] Cannot apply range - no chart or x-axis found`);
    return;
  }

  const xAxis = chart.options.scales.x;
  
  // Reduce log spam - only log occasionally
  const shouldLog = Math.random() < 0.01; // 1% chance to log
  if (shouldLog) {
    console.log(`[ChartViewUtils] Before applying range - current axis:`, { min: xAxis.min, max: xAxis.max });
    console.log(`[ChartViewUtils] Applying range:`, range);
  }

  // If stored range values are undefined, initialize them
  if (range.min === undefined && xAxis.min !== undefined) {
    range.min = xAxis.min;
  }
  if (range.max === undefined && xAxis.max !== undefined) {
    range.max = xAxis.max;
  }

  if (range.min !== undefined) xAxis.min = range.min;
  if (range.max !== undefined) xAxis.max = range.max;
  
  if (shouldLog) {
    console.log(`[ChartViewUtils] After applying range - new axis:`, { min: xAxis.min, max: xAxis.max });
  }
}

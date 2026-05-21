export const getRuntimeScaleX = (chart: any) => {
  return chart?.scales?.x ?? null;
};

export const getScaleRange = (chart: any): { min: number | undefined; max: number | undefined } => {
  const runtime = getRuntimeScaleX(chart);
  const opt = chart?.options?.scales?.x;
  const min = runtime && isFinite(runtime.min) ? runtime.min : opt?.min;
  const max = runtime && isFinite(runtime.max) ? runtime.max : opt?.max;
  return { min, max };
};

export const setScaleRangeBoth = (chart: any, min: number, max: number) => {
  if (chart?.options?.scales?.x) {
    chart.options.scales.x.min = min;
    chart.options.scales.x.max = max;
  }
  const runtime = getRuntimeScaleX(chart);
  if (runtime) {
    runtime.min = min;
    runtime.max = max;
  }
}; 
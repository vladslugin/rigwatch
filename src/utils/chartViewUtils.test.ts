import { describe, it, expect } from 'vitest';
import { applyFixedRange, recordCurrentRange, ChartLike } from './chartViewUtils';

describe('chartViewUtils', () => {
  it('recordCurrentRange returns current min and max', () => {
    const chart: ChartLike = { options: { scales: { x: { min: 1, max: 5 } } } } as any;
    const range = recordCurrentRange(chart);
    expect(range).toEqual({ min: 1, max: 5 });
  });

  it('applyFixedRange sets min and max on chart', () => {
    const chart: ChartLike = { options: { scales: { x: {} } } } as any;
    applyFixedRange(chart, { min: 2, max: 6 });
    expect(chart.options.scales.x.min).toBe(2);
    expect(chart.options.scales.x.max).toBe(6);
  });

  it('applyFixedRange initializes range when undefined', () => {
    const chart: ChartLike = { options: { scales: { x: { min: 1, max: 5 } } } } as any;
    const range: { min?: number; max?: number } = {};
    applyFixedRange(chart, range);
    expect(range).toEqual({ min: 1, max: 5 });
    expect(chart.options.scales.x.min).toBe(1);
    expect(chart.options.scales.x.max).toBe(5);
  });
});

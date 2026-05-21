import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import { vi } from 'vitest';
import RealtimeChart from '../RealtimeChart';
import { ChartRefContext, type ChartDivElement } from '../../context/ChartRefContext';
import type { ParameterInfo } from '../../types';

// Mock react-chartjs-2 Chart component
let chartInstance: any = null;
vi.mock('react-chartjs-2', () => {
  const React = require('react');
  return {
    Chart: React.forwardRef(({ data, options }: any, ref) => {
      const chartRef = React.useRef({ data, options: { ...options }, update: vi.fn() });
      React.useEffect(() => {
        chartRef.current.data = data;
        Object.assign(chartRef.current.options, options);
      }, [data, options]);
      React.useImperativeHandle(ref, () => chartRef.current);
      chartInstance = chartRef.current;
      return React.createElement('div', { 'data-testid': 'chart' });
    }),
  };
});

// Mock useChartLegend to allow parameter visibility updates
let updateVisibility: (id: string, visible: boolean) => void = () => {};
vi.mock('../../hooks/useChartLegend', () => {
  return {
    useChartLegend: () => ({
      toggleParameterVisibility: (id: string, visible: boolean) => {
        updateVisibility(id, visible);
        return Promise.resolve();
      },
      changeParameterColor: vi.fn(),
    }),
  };
});

const baseParam = (id: string): ParameterInfo => ({
  originalName: id,
  displayName: id,
  unit: '%',
  description: '',
  icon: '',
  color: '#ff0000',
  divisor: 1,
  form: 0,
  yAxisID: 'yPercentage',
  favorite: 0,
  position: 0,
  show_in_legend: true,
  visible_on_chart: true,
  rangeString: '',
  defaultChart: true,
  isInitiallyVisibleOnChart: true,
});

function renderWithParams(params: ParameterInfo[]) {
  const ref = React.createRef<ChartDivElement>();
  const Wrapper: React.FC = () => {
    const [p, setP] = React.useState(params);
    updateVisibility = (id, visible) =>
      setP(curr => curr.map(param => param.originalName === id ? { ...param, visible_on_chart: visible } : param));
    return (
      <ChartRefContext.Provider value={ref as any}>
        <RealtimeChart parameters={p} currentData={{}} deviceId="" />
      </ChartRefContext.Provider>
    );
  };
  const result = render(<Wrapper />);
  return { ...result, ref };
}

function getAxisRange() {
  return { min: chartInstance.options.scales.x.min, max: chartInstance.options.scales.x.max };
}

vi.useFakeTimers();
vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));

it('keeps axis range stable when toggling parameters', async () => {
  const { getAllByRole } = renderWithParams([baseParam('T'), baseParam('P')]);
  await act(async () => {
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  const checkboxes = getAllByRole('checkbox').filter(el => !el.getAttribute('data-role'));
  fireEvent.click(checkboxes[1]);
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
  const rangeAfterFirstToggle = getAxisRange();
  fireEvent.click(checkboxes[1]);
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
  const rangeAfterSecondToggle = getAxisRange();
  const window1 = rangeAfterFirstToggle.max - rangeAfterFirstToggle.min;
  const window2 = rangeAfterSecondToggle.max - rangeAfterSecondToggle.min;
  expect(window2).toBeCloseTo(window1, 1);
});

it('zoomToShowAllData fits loaded historical data', async () => {
  const { ref } = renderWithParams([baseParam('T')]);
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
  const log = { '0': { T: 10 }, '60': { T: 20 } };
  await act(async () => {
    ref.current!.addHistoricalDataToChart!(log, 100);
  });
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
  // call again to ensure zoom uses populated datasets
  await act(async () => {
    ref.current!.addHistoricalDataToChart!(log, 100);
  });
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
  const range = getAxisRange();
  const first = 100 * 1000;
  const last = 160 * 1000;
  const padding = (last - first) * 0.05;
  expect(range.min).toBeDefined();
  expect(range.max).toBeDefined();
  expect(range.max - range.min).toBeCloseTo(last + padding - (first - padding), 1);
});

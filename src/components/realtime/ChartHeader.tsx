import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

type ChartStatus = {
  label: string;
  dotColor: string;
  textColor: string;
};

const getChartStatus = (isChartPaused: boolean, historicalDate: string | null): ChartStatus => {
  if (historicalDate !== null) {
    return {
      label: 'Historical',
      dotColor: 'bg-info',
      textColor: 'text-info',
    };
  }
  if (isChartPaused) {
    return {
      label: 'Paused',
      dotColor: 'bg-warning',
      textColor: 'text-warning',
    };
  }
  return {
    label: 'Live',
    dotColor: 'bg-success',
    textColor: 'text-success',
  };
};

const buildChartTitle = (
  t: (key: string, fallback?: string) => string,
  historicalDate: string | null,
  isMainChart: boolean,
  totalCharts: number,
  chartIndex: number
) => {
  const baseTitle = historicalDate
    ? `${t('chart.header.historical', 'Historical')}: ${historicalDate}`
    : t('chart.header.liveChart', 'Live Chart');

  // LEGACY: show chart index only for non-main charts in multi-chart mode
  if (!isMainChart && totalCharts > 1) {
    return `${baseTitle} #${chartIndex + 1}`;
  }
  return baseTitle;
};

interface ChartHeaderProps {
  isChartPaused: boolean;
  historicalDate: string | null;
  totalPoints: number;
  isStretched?: boolean;
  onToggleStretch?: () => void;
  compact?: boolean;
  /** Chart instance ID for multi-chart support */
  chartInstanceId?: string;
  /** Whether this is the main (primary) chart */
  isMainChart?: boolean;
  /** Callback to clone this chart */
  onCloneChart?: (chartId: string) => void;
  /** Callback to delete this chart (only for non-main charts) */
  onDeleteChart?: (chartId: string) => void;
  /** Current chart index (1-based for display) */
  chartIndex?: number;
  /** Total number of charts */
  totalCharts?: number;
}

const ChartHeader = forwardRef<HTMLDivElement, ChartHeaderProps>(({
  isChartPaused,
  historicalDate,
  totalPoints,
  isStretched = false,
  onToggleStretch,
  compact = false,
  chartInstanceId = 'main',
  isMainChart = true,
  onCloneChart,
  onDeleteChart,
  chartIndex = 0,
  totalCharts = 1,
}, ref) => {
  const { t } = useTranslation();
  const status = getChartStatus(isChartPaused, historicalDate);

  // Chart title with optional index
  const chartTitle = buildChartTitle(t, historicalDate, isMainChart, totalCharts, chartIndex);

  return (
    <div
      ref={ref}
      className={`flex items-center justify-between bg-muted/70 text-foreground border-b border-border ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1.5'}`}
    >
      <div className="flex items-center">
        {!compact && (
          <div className="w-3.5 h-3.5 mr-1.5 flex items-center justify-center">
            <svg className="w-3 h-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
        )}
        <span className={compact ? 'text-[10px] font-medium' : 'text-xs font-semibold'}>
          {chartTitle}
        </span>
        
        {/* Chart number badge for non-main charts */}
        {!isMainChart && !compact && (
          <span className="ml-2 bg-info/20 text-info px-1.5 py-0.5 rounded text-[10px] font-medium">
            #{chartIndex + 1}
          </span>
        )}
      </div>
      <div className={`flex items-center ${compact ? 'space-x-1 text-[10px]' : 'space-x-2 text-xs'}`}>
        <span className={`flex items-center space-x-1 ${status.textColor}`}>
          <span className={`${compact ? 'w-1 h-1' : 'w-1.5 h-1.5'} rounded-full ${status.dotColor}`} />
          <span>{status.label}</span>
        </span>
        <span className="text-muted-foreground">|</span>
        <span className="text-info">{totalPoints} pts</span>
        
        {/* Clone Chart Button */}
        {!compact && onCloneChart && (
          <button
            type="button"
            onClick={() => onCloneChart(chartInstanceId)}
            className="ml-1 px-1.5 py-0.5 rounded border border-success text-success text-xs hover:bg-success/10 focus:outline-none focus:ring-1 focus:ring-success flex items-center gap-1"
            title={t('chart.header.cloneChart', 'Clone Chart') as string}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span className="hidden sm:inline">{t('chart.header.clone', 'Clone')}</span>
          </button>
        )}
        
        {/* Delete Chart Button (only for non-main charts) */}
        {!compact && onDeleteChart && !isMainChart && (
          <button
            type="button"
            onClick={() => onDeleteChart(chartInstanceId)}
            className="ml-1 px-1.5 py-0.5 rounded border border-destructive text-destructive text-xs hover:bg-destructive/10 focus:outline-none focus:ring-1 focus:ring-destructive flex items-center gap-1"
            title={t('chart.header.deleteChart', 'Delete Chart') as string}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span className="hidden sm:inline">{t('chart.header.delete', 'Delete')}</span>
          </button>
        )}
        
        {/* Stretch Toggle Button */}
        {!compact && (
          <button
            type="button"
            onClick={onToggleStretch}
            className="ml-1 px-1.5 py-0.5 rounded border border-border text-xs hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {isStretched ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12M9 9l3-3 3 3M9 15l3 3 3-3" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12M15 9l-3-3-3 3M15 15l-3 3-3-3" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
});

export default ChartHeader; 
import React, { useMemo } from 'react';
import type { ChartMarker, ParameterInfo } from '../../types';
import { useTranslation } from 'react-i18next';

interface ColoredValue { name: string; value: string; color: string; }

interface CursorInfoData { time: string; parameters: ColoredValue[]; hasData: boolean }
interface MarkerInfoData { time: string; parameters: ColoredValue[]; hasData: boolean }

interface InfoPanelsProps {
  cursorInfo: CursorInfoData | string;
  leftMarkerInfo: MarkerInfoData | string;
  rightMarkerInfo: MarkerInfoData | string;
  markers: ChartMarker[];
  datasets: Array<{ hidden?: boolean; paramId: string }>;
  parameters: ParameterInfo[];
  showIntegrals: boolean;
  setShowIntegrals: (v: boolean) => void;
  calculateIntegral: (paramId: string) => number;
  calculateAverage: (paramId: string) => number;
  compact?: boolean;
}

const START_MARKER_INDEX = 0;
const END_MARKER_INDEX = 1;
const MAX_COMPACT_PARAMS = 3;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

const getTheme = () =>
  typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;

const getTimeDiff = (leftTimestamp: number, rightTimestamp: number) =>
  Math.abs(rightTimestamp - leftTimestamp);

const InfoPanels: React.FC<InfoPanelsProps> = ({
  cursorInfo,
  leftMarkerInfo,
  rightMarkerInfo,
  markers,
  datasets,
  parameters,
  showIntegrals,
  setShowIntegrals,
  calculateIntegral,
  calculateAverage,
  compact = false,
}) => {
  const { t } = useTranslation();
  const currentTheme = getTheme();
  const isNeo = currentTheme === 'neo-brutalism';
  const panelClass = (type: 'cursor' | 'left' | 'right' | 'analysis') => {
    if (isNeo) {
      return 'bg-transparent border border-border rounded p-2 sm:p-1.5 transition-colors';
    }
    if (type === 'cursor') {
      return 'bg-muted/50 p-2 sm:p-1.5 rounded border-l-2 border-border transition-colors';
    }
    if (type === 'left') {
      return 'bg-muted/50 p-2 sm:p-1.5 rounded border-l-2 border-secondary transition-colors';
    }
    if (type === 'right') {
      return 'bg-muted/50 p-2 sm:p-1.5 rounded border-l-2 border-warning transition-colors';
    }
    return 'bg-muted/50 p-2 sm:p-1.5 rounded border-l-2 border-primary transition-colors';
  };
  // Check markers once to avoid accessing undefined indices.
  const hasBothMarkers = markers.length >= 2 && Boolean(markers[START_MARKER_INDEX]?.timestamp && markers[END_MARKER_INDEX]?.timestamp);
  const visibleParams = useMemo<ParameterInfo[]>(() => {
    return datasets
      .filter((dataset) => !dataset.hidden)
      .map((dataset) => parameters.find((param) => param.originalName === dataset.paramId))
      .filter((param): param is ParameterInfo => Boolean(param));
  }, [datasets, parameters]);
  const renderCursor = () => {
    if (typeof cursorInfo === 'string') {
      return <p className="text-sm sm:text-xs text-muted-foreground">{cursorInfo}</p>;
    }
    return (
      <div className="text-sm sm:text-xs">
        <p className="text-muted-foreground mb-1 sm:mb-0.5">{cursorInfo.time}</p>
        {cursorInfo.hasData ? (
          <p className="text-foreground leading-relaxed sm:leading-tight">
            {cursorInfo.parameters.map((param, idx) => (
              <span key={idx} className="block sm:inline">
                {idx > 0 && <span className="hidden sm:inline"> | </span>}
                <span style={{ color: param.color }} className="font-medium">
                  {param.name}:
                </span>
                <span className="ml-1">{param.value}</span>
              </span>
            ))}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('chart.infoPanels.noDataCursor')}</p>
        )}
      </div>
    );
  };

  const renderMarker = (data: MarkerInfoData | string, _label: 'Left' | 'Right') => {
    if (typeof data === 'string') {
      return <p className="text-sm sm:text-xs text-muted-foreground">{data}</p>;
    }
    return (
      <div className="text-sm sm:text-xs">
        <p className="text-muted-foreground mb-1 sm:mb-0.5">{data.time}</p>
        {data.hasData ? (
          <p className="text-foreground leading-relaxed sm:leading-tight">
            {data.parameters.map((param, idx) => (
              <span key={idx} className="block sm:inline">
                {idx > 0 && <span className="hidden sm:inline"> | </span>}
                <span style={{ color: param.color }} className="font-medium">
                  {param.name}:
                </span>
                <span className="ml-1">{param.value}</span>
              </span>
            ))}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('chart.infoPanels.noDataMarker')}</p>
        )}
      </div>
    );
  };

  const renderAnalysis = () => {
    if (!hasBothMarkers) {
      return <p className="text-sm sm:text-xs text-muted-foreground">{t('chart.infoPanels.setTwoMarkers')}</p>;
    }
    const leftTimestamp = (markers[START_MARKER_INDEX]?.timestamp ?? 0) as number;
    const rightTimestamp = (markers[END_MARKER_INDEX]?.timestamp ?? 0) as number;
    const timeDiff = getTimeDiff(leftTimestamp, rightTimestamp);
    const timeDiffSec = Math.round(timeDiff / MS_PER_SECOND);
    // MAGIC: one-decimal rounding for minutes is part of UX expectations
    const timeDiffMin = Math.round((timeDiffSec / SECONDS_PER_MINUTE) * 10) / 10;

    return (
      <div className="text-sm sm:text-xs">
        <p className="text-muted-foreground mb-1 sm:mb-0.5">{t('chart.infoPanels.dt')}: {timeDiffSec}s ({timeDiffMin}min)</p>
        {showIntegrals && visibleParams.length > 0 && (
          <p className="text-foreground leading-relaxed sm:leading-tight mb-1">
            {visibleParams.map((param, idx) => {
              const integral = calculateIntegral(param.originalName);
              const formattedIntegral = integral.toFixed(1);
              const unit = param.unit || '';
              return (
                <span key={idx} className="block sm:inline">
                  {idx > 0 && <span className="hidden sm:inline"> | </span>}
                  <span style={{ color: param.color }} className="font-medium">∫{param.displayName || param.originalName}:</span>
                  <span className="ml-1">{formattedIntegral}{unit}·s</span>
                </span>
              );
            })}
          </p>
        )}
        {visibleParams.length > 0 ? (
          <p className="text-foreground leading-relaxed sm:leading-tight">
            {visibleParams.map((param, idx) => {
              const avg = calculateAverage(param.originalName).toFixed(1);
              const unit = param.unit || '';
              return (
                <span key={idx} className="block sm:inline">
                  {idx > 0 && <span className="hidden sm:inline"> | </span>}
                  <span style={{ color: param.color }} className="font-medium">⌀{param.displayName || param.originalName}:</span>
                  <span className="ml-1">{avg}{unit}</span>
                </span>
              );
            })}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('chart.infoPanels.noVisibleParams')}</p>
        )}
      </div>
    );
  };

  // Compact mode - show only cursor info in a single row
  if (compact) {
    const renderCompactCursor = () => {
      if (typeof cursorInfo === 'string') {
        return <span className="text-muted-foreground">{cursorInfo}</span>;
      }
      if (!cursorInfo.hasData) {
        return <span className="text-muted-foreground">No data</span>;
      }
      return (
        <span className="text-foreground">
          <span className="text-muted-foreground mr-1">{cursorInfo.time}</span>
          {cursorInfo.parameters.slice(0, MAX_COMPACT_PARAMS).map((param, idx) => (
            <span key={idx}>
              {idx > 0 && ' | '}
              <span style={{ color: param.color }}>{param.name}:</span>
              <span className="ml-0.5">{param.value}</span>
            </span>
          ))}
          {cursorInfo.parameters.length > MAX_COMPACT_PARAMS && (
            <span className="text-muted-foreground"> +{cursorInfo.parameters.length - MAX_COMPACT_PARAMS}</span>
          )}
        </span>
      );
    };

    return (
      <div className="p-1 rounded text-[10px] bg-muted/50 text-foreground border border-border">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Cursor:</span>
          {renderCompactCursor()}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      <div className={panelClass('cursor')}>
        <h4 className="text-sm sm:text-xs font-medium text-foreground mb-1 sm:mb-0.5">{t('chart.infoPanels.cursor')}</h4>
        {renderCursor()}
      </div>
      <div className={panelClass('left')}>
        <h4 className="text-sm sm:text-xs font-medium text-foreground mb-1 sm:mb-0.5">{t('chart.infoPanels.leftMarker')}</h4>
        {renderMarker(leftMarkerInfo, 'Left')}
      </div>
      <div className={panelClass('right')}>
        <h4 className="text-sm sm:text-xs font-medium text-foreground mb-1 sm:mb-0.5">{t('chart.infoPanels.rightMarker')}</h4>
        {renderMarker(rightMarkerInfo, 'Right')}
      </div>
      <div className={panelClass('analysis')}>
        <div className="flex items-center justify-between gap-2 mb-1 sm:mb-0.5">
          <h4 className="text-sm sm:text-xs font-medium text-foreground truncate">{t('chart.infoPanels.analysis')} ({showIntegrals ? '∫ & ⌀' : '⌀'})</h4>
          <button
            onClick={() => setShowIntegrals(!showIntegrals)}
            className="text-xs px-1.5 py-0.5 rounded border flex-shrink-0 border-border hover:bg-muted transition-colors"
            title={showIntegrals ? (t('chart.infoPanels.hideIntegrals') as string) : (t('chart.infoPanels.showIntegrals') as string)}
          >
            ∫
          </button>
        </div>
        {renderAnalysis()}
      </div>
    </div>
  );
};

export default InfoPanels; 
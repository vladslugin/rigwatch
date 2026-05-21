import React from 'react';
import type { ParameterInfo } from '../../types';

const LEGEND_ITEM_KEY = (param: ParameterInfo) => param.originalName;
const getLegendLabel = (param: ParameterInfo) => param.displayName || param.originalName;
const getColorTitle = (param: ParameterInfo) => `Change color for ${param.displayName}`;

interface ParameterLegendProps {
  parameters: ParameterInfo[];
  formatLegendLabel: (p: ParameterInfo) => string;
  onColorClick: (paramId: string, currentColor: string) => void;
  onToggleVisible: (paramId: string, visible: boolean) => void;
  onOpenSettings?: (paramId: string) => void;
  compact?: boolean;
}

const ParameterLegend: React.FC<ParameterLegendProps> = ({
  parameters,
  formatLegendLabel,
  onColorClick,
  onToggleVisible,
  onOpenSettings,
  compact = false,
}) => {
  const visibleParameters = parameters.filter((param) => param.show_in_legend);
  if (compact) {
    return (
      <div className="mb-1 p-1 bg-muted/70 text-foreground rounded border border-border">
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          {visibleParameters.map((param) => (
            <div key={LEGEND_ITEM_KEY(param)} className="flex items-center space-x-0.5">
              <span
                className="w-2 h-2 rounded-sm cursor-pointer hover:scale-110 transition-transform"
                style={{ backgroundColor: param.color }}
                title={getColorTitle(param)}
                onClick={() => onColorClick(param.originalName, param.color)}
              />
            {/* MAGIC: compact legend truncates labels to keep the header row small */}
            <span className="text-muted-foreground truncate max-w-[50px]" title={formatLegendLabel(param)}>
                {getLegendLabel(param)}
              </span>
              <input
                type="checkbox"
                checked={param.visible_on_chart}
                onChange={(e) => onToggleVisible(param.originalName, e.target.checked)}
                className="h-2 w-2 rounded border border-border"
              />
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => onOpenSettings(param.originalName)}
                  className="h-4 w-4 inline-flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/70"
                  title="Serie einstellen"
                >
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 p-2 lg:p-1.5 bg-muted rounded-md border border-border transition-colors">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:gap-5 text-xs sm:text-xs lg:text-xs text-foreground">
        {visibleParameters.map((param) => (
          <div key={LEGEND_ITEM_KEY(param)} className="flex items-center space-x-1 min-w-0 max-w-full sm:min-w-0 px-1 py-0.5 rounded border border-border/40 bg-card/40">
            <span
              className="w-3 h-3 lg:w-2.5 lg:h-2.5 rounded-sm border border-border cursor-pointer hover:scale-110 transition-transform touch-manipulation flex-shrink-0"
              style={{ backgroundColor: param.color }}
              title={getColorTitle(param)}
              onClick={() => onColorClick(param.originalName, param.color)}
            />
            {/* MAGIC: responsive truncation keeps legend items aligned across breakpoints */}
            <span className="font-medium text-foreground cursor-pointer truncate max-w-[92px] sm:max-w-20 lg:max-w-20" title={formatLegendLabel(param)}>
              {getLegendLabel(param)}
            </span>
            <input
              type="checkbox"
              checked={param.visible_on_chart}
              onChange={(e) => onToggleVisible(param.originalName, e.target.checked)}
              className="h-4 w-4 lg:h-3 lg:w-3 text-info focus:ring-ring border-border rounded touch-manipulation bg-card flex-shrink-0"
            />
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => onOpenSettings(param.originalName)}
                className="h-5 w-5 inline-flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/70 flex-shrink-0"
                title="Serie einstellen"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ParameterLegend; 
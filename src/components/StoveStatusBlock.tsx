import React from 'react';
import { useStoveStatus } from '../hooks/useStoveStatus';
import type { ComponentError } from '../hooks/useStoveStatus';
import { useTranslation } from 'react-i18next';

const StoveStatusBlock: React.FC = () => {
  const {
    temperature,
    scheibenluft,
    rueckwandluft,
    brennprigopsLabel,
    motorAErrors,
    motorBErrors,
    sensorErrors
  } = useStoveStatus();
  const { t } = useTranslation();

  // Helper to format values
  const formatValue = (value: number | undefined, suffix: string = ''): string => {
    if (value === undefined || value === null) return '—';
    return `${value}${suffix}`;
  };

  // Helper to render status indicator with error list
  const renderStatus = (errors: ComponentError[], label: string) => {
    const hasErrors = errors.length > 0;
    
    return (
      <div className="flex flex-col p-2 bg-muted/50 rounded-lg">
        <div className="flex items-center space-x-2 mb-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${hasErrors ? 'bg-destructive' : 'bg-success'}`} />
          <span className="text-xs font-semibold text-foreground">{label}</span>
        </div>
        {hasErrors ? (
          <ul className="ml-4 space-y-0.5">
            {errors.map((error, index) => (
              <li key={index} className="text-xs text-destructive">
                • {error.description}
              </li>
            ))}
          </ul>
        ) : (
          <span className="ml-4 text-xs text-success">i.O.</span>
        )}
      </div>
    );
  };

  return (
    <div className="bg-card rounded-xl overflow-hidden border border-border shadow-sm">
      {/* Header */}
      <div className="bg-muted/70 dark:bg-muted/50 text-foreground border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold flex items-center">
          <div className="w-4 h-4 mr-2 flex items-center justify-center">
            <svg
              className="w-3.5 h-3.5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span>{t('stoveStatusBlock.title')}</span>
        </h2>
      </div>

      {/* Content */}
      <div className="p-3 transition-colors">
        {/* Live Data Section */}
        <div className="mb-3 pb-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {t('stoveStatusBlock.liveData')}
          </h3>
          <div className="grid grid-cols-4 gap-2">
            <div className="p-2 bg-muted/50 rounded-lg text-center">
              <div className="text-xs text-muted-foreground mb-0.5">
                {t('stoveStatusBlock.temperature')}
              </div>
              <div className="text-lg font-bold text-foreground [font-variant-numeric:tabular-nums]">
                {formatValue(temperature, ' °C')}
              </div>
            </div>
            <div className="p-2 bg-muted/50 rounded-lg text-center">
              <div className="text-xs text-muted-foreground mb-0.5">
                {t('stoveStatusBlock.scheibenluft')}
              </div>
              <div className="text-lg font-bold text-foreground [font-variant-numeric:tabular-nums]">
                {formatValue(scheibenluft, ' %')}
              </div>
            </div>
            <div className="p-2 bg-muted/50 rounded-lg text-center">
              <div className="text-xs text-muted-foreground mb-0.5">
                {t('stoveStatusBlock.rueckwandluft')}
              </div>
              <div className="text-lg font-bold text-foreground [font-variant-numeric:tabular-nums]">
                {formatValue(rueckwandluft, ' %')}
              </div>
            </div>
            <div className="p-2 bg-muted/50 rounded-lg text-center">
              <div className="text-xs text-muted-foreground mb-0.5">
                {t('stoveStatusBlock.brennphase')}
              </div>
              <div className="text-sm font-semibold text-foreground">
                {brennprigopsLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Status Section */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {t('stoveStatusBlock.systemStatus')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {renderStatus(motorAErrors, t('stoveStatusBlock.motorA'))}
            {renderStatus(motorBErrors, t('stoveStatusBlock.motorB'))}
            {renderStatus(sensorErrors, t('stoveStatusBlock.sensor'))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoveStatusBlock;


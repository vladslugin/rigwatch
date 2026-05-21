import * as React from 'react';
import { useTranslation } from 'react-i18next';

const DevModeIndicator: React.FC = () => {
  const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';
  const { t } = useTranslation();

  if (!isDevelopment) return null;

  return (
    <div className="fixed top-3 right-3 bg-warning text-warning-foreground border border-warning/50 backdrop-blur-sm rounded-full px-2.5 py-1 shadow-lg z-50">
      <div className="flex items-center text-xs font-semibold uppercase tracking-wider">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning-foreground mr-1.5 animate-pulse" />
        <span>{t('devMode.badge')}</span>
        <span className="ml-2 opacity-80 normal-case tracking-normal font-medium">{t('devMode.subtitle')}</span>
      </div>
    </div>
  );
};

export default DevModeIndicator;
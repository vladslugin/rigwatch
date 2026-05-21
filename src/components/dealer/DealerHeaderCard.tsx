import React from 'react';
import { useTranslation } from 'react-i18next';
import { extractSeriennr } from '../../utils/seriennrResolver';

export type DealerConnectivity = 'unknown' | 'online' | 'offline';

export interface DealerHeaderCardProps {
  modelName: string | null;
  /** Full device ID. We never display it — only the first 7 digits (Seriennr). */
  deviceId: string | null;
  /** Optional product image URL (resolved by useStoveModel upstream). */
  imageUrl: string | null;
  /**
   * Stable connectivity status for the badge. The card no longer exposes a
   * manual "Re-check" button — DealerModeLayout polls in the background and
   * updates this prop. While the background ping is running, the parent keeps
   * the last known result here so the badge doesn't flicker.
   */
  connectivity: DealerConnectivity;
}

const StatusDot: React.FC<{ connectivity: DealerConnectivity }> = ({ connectivity }) => {
  if (connectivity === 'online') {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-success" />;
  }
  if (connectivity === 'offline') {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-destructive" />;
  }
  return <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-warning" />;
};

export const DealerHeaderCard: React.FC<DealerHeaderCardProps> = React.memo(
  ({ modelName, deviceId, imageUrl, connectivity }) => {
    const { t } = useTranslation();
    const seriennr = deviceId ? extractSeriennr(deviceId) : '';

    const statusLabel = (() => {
      if (connectivity === 'online') return t('dealerV2.status.online');
      if (connectivity === 'offline') return t('dealerV2.status.offline');
      return t('dealerV2.status.checking');
    })();

    const statusToneClass = (() => {
      if (connectivity === 'online') return 'tint-success-strong text-success';
      if (connectivity === 'offline') return 'tint-destructive-strong text-destructive';
      return 'tint-warning-strong text-warning';
    })();

    return (
      <section
        className="rounded-theme bg-card p-5 shadow-theme-md"
        aria-label={t('dealerV2.header.aria') as string}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={modelName ?? ''}
              className="h-24 w-24 flex-shrink-0 rounded-theme object-cover sm:h-28 sm:w-28"
              loading="lazy"
            />
          ) : (
            <div className="tint-raised flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-theme text-muted-foreground sm:h-28 sm:w-28">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-10 w-10">
                <path d="M8 21h8M12 17v4M5 3h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                <path d="M9 11a3 3 0 0 1 6 0" />
              </svg>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('dealerV2.header.modelLabel')}
            </p>
            <h2 className="mt-0.5 truncate text-2xl font-semibold text-foreground">
              {modelName || t('dealerV2.header.unknownModel')}
            </h2>
            {seriennr ? (
              <p className="mt-1.5 font-mono text-sm text-muted-foreground">
                <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
                  {t('dealerV2.header.seriennrLabel')}
                </span>{' '}
                <span className="text-foreground">{seriennr}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${statusToneClass}`}>
              <StatusDot connectivity={connectivity} />
              <span>{statusLabel}</span>
            </div>
          </div>
        </div>
      </section>
    );
  },
);

DealerHeaderCard.displayName = 'DealerHeaderCard';

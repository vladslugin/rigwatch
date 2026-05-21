import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DecodedStoveError } from '../../utils/decodeStoveErrors';

export interface OfenFunktionCardProps {
  /** Decoded controller errors. Empty list = "alles fehlerfrei". */
  errors: DecodedStoveError[];
  /** Optional: dealer-friendly hint to update the firmware when errors are present. */
  showFirmwareHint?: boolean;
}

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m5 12 5 5L20 7" />
  </svg>
);

const AlertIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
  </svg>
);

const ErrorEntryRow: React.FC<{ error: DecodedStoveError }> = ({ error }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hasMassnahmen = error.massnahmen.length > 0;

  return (
    <li className="tint-destructive-strong rounded-theme p-3 shadow-theme-sm ring-1 ring-tint-destructive">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{error.description}</p>
        {hasMassnahmen ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="flex-shrink-0 rounded-full bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:opacity-80"
          >
            {open
              ? t('dealerV2.funktion.hideMassnahmen')
              : t('dealerV2.funktion.showMassnahmen')}
          </button>
        ) : null}
      </div>
      {open && hasMassnahmen ? (
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {error.massnahmen.map((step, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 text-foreground/60">›</span>
              <span>{step}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
};

export const OfenFunktionCard: React.FC<OfenFunktionCardProps> = React.memo(({ errors, showFirmwareHint }) => {
  const { t } = useTranslation();
  // Hide errors flagged as not dealer-visible (e.g. "kein Strom" — fires when
  // the stove is simply switched off and would only confuse the dealer).
  const visibleErrors = errors.filter((e) => e.dealerVisible);
  const hasErrors = visibleErrors.length > 0;

  if (!hasErrors) {
    return (
      <section
        className="rounded-theme bg-card p-5 shadow-theme-md"
        aria-label={t('dealerV2.funktion.aria') as string}
      >
        <div className="flex items-start gap-3">
          <div className="tint-success-strong flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-success">
            <CheckIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-foreground">
              {t('dealerV2.funktion.goodTitle')}
            </h3>
            <ul className="mt-2 space-y-1.5 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 text-success">→</span>
                <span>{t('dealerV2.funktion.goodPoint1')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 text-success">→</span>
                <span>{t('dealerV2.funktion.goodPoint2')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 text-success">→</span>
                <span>{t('dealerV2.funktion.goodPoint3')}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    );
  }

  // Pluralisation: i18next picks the right form via { count } automatically
  // for German (one / other). i18n keys carry the plural suffix.
  const titleKey =
    visibleErrors.length === 1 ? 'dealerV2.funktion.badTitle_one' : 'dealerV2.funktion.badTitle_other';

  return (
    <section
      className="rounded-theme bg-card p-5 shadow-theme-md"
      aria-label={t('dealerV2.funktion.aria') as string}
    >
      <div className="flex items-start gap-3">
        <div className="tint-destructive-strong flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-destructive">
          <AlertIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-foreground">
            {t(titleKey, { count: visibleErrors.length })}
          </h3>
          <ul className="mt-3 space-y-2">
            {visibleErrors.map((error, idx) => (
              <ErrorEntryRow key={`${error.source}-${error.bit}-${idx}`} error={error} />
            ))}
          </ul>
          {showFirmwareHint ? (
            <p className="tint-info mt-3 rounded-theme p-3 text-sm text-foreground">
              {t('dealerV2.funktion.firmwareHint')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
});

OfenFunktionCard.displayName = 'OfenFunktionCard';

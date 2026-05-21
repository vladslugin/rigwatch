import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BrennbewertungKey,
  BrennbewertungKnowledgeBase,
  BrennbewertungSource,
  BrennbewertungValues,
} from '../../types/brennbewertung';
import { starsForCValue } from '../../utils/brennbewertungKnowledge';

export interface BrennbewertungCardProps {
  values: BrennbewertungValues;
  topThree: BrennbewertungKey[];
  isAllZero: boolean;
  isLoading: boolean;
  knowledge: BrennbewertungKnowledgeBase;
  source: BrennbewertungSource;
}

const StarRow: React.FC<{ filled: number; total?: number }> = ({ filled, total = 5 }) => (
  <span className="inline-flex items-center" aria-label={`${filled} von ${total} Sternen`}>
    {Array.from({ length: total }, (_, i) => (
      <svg
        key={i}
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`h-4 w-4 ${i < filled ? 'text-warning' : 'text-muted-foreground/30'}`}
      >
        <path d="M9.05 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 0 0 .95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 0 0-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.539 1.118l-3.977-2.888a1 1 0 0 0-1.176 0l-3.976 2.888c-.784.57-1.838-.196-1.539-1.118l1.518-4.674a1 1 0 0 0-.364-1.118L2.075 10.1c-.783-.57-.38-1.81.588-1.81h4.915a1 1 0 0 0 .95-.69l1.518-4.674Z" />
      </svg>
    ))}
  </span>
);

const FlameIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2c-1 5-5 6-5 11a5 5 0 0 0 10 0c0-1.5-.5-3-2-4 .5 2-.5 3-1.5 3-1 0-1.5-1-1.5-2 0-3 1-5 0-8Z" />
    <path d="M9.5 14.5c0-1 .5-2 1.5-2.5.2 1 .8 1.5 1.5 1.5.7 0 1.2-.4 1.5-1 .8.7 1 1.7 1 2.5 0 1.7-1.5 3-3.5 3s-3-1.3-3-2.5c0-.4.1-.7.3-1Z" fillOpacity="0.5" />
  </svg>
);

const GoodState: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3">
      <div className="tint-success-strong flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-success">
        <FlameIcon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-semibold text-foreground">
          {t('dealerV2.brennbewertung.goodTitle')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('dealerV2.brennbewertung.goodSubtitle')}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-foreground">
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 text-success">→</span>
            <span>{t('dealerV2.brennbewertung.goodPoint1')}</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 text-success">→</span>
            <span>{t('dealerV2.brennbewertung.goodPoint2')}</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 text-success">→</span>
            <span>{t('dealerV2.brennbewertung.goodPoint3')}</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

/**
 * Per-problem circular info button. Lucide-style "i" icon, sized generously
 * (40 px) so non-technical users notice it. Each ProblemEntry owns its own
 * toggle so the dealer can drill into the symptoms (Auswirkungen) of any
 * individual problem without unfolding the rest.
 */
const ProblemInfoToggle: React.FC<{ open: boolean; onToggle: () => void; label: string }> = ({
  open,
  onToggle,
  label,
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-info focus:ring-offset-2 focus:ring-offset-muted ${
      open
        ? 'bg-info text-primary-foreground hover:opacity-90'
        : 'tint-info-strong text-info hover:opacity-80'
    }`}
    title={label}
    aria-label={label}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  </button>
);

const ProblemEntry: React.FC<{
  cKey: BrennbewertungKey;
  value: number;
  knowledge: BrennbewertungKnowledgeBase[BrennbewertungKey];
}> = ({ cKey, value, knowledge }) => {
  const { t } = useTranslation();
  const [showBg, setShowBg] = useState(false);
  const stars = starsForCValue(value);
  const hasAuswirkungen = knowledge.auswirkungen.length > 0;

  return (
    <li className="tint-raised rounded-theme p-4 shadow-theme-sm ring-1 ring-tint-soft">
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <span className="rounded-full bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {cKey}
        </span>
        <h4 className="min-w-0 flex-1 text-base font-semibold text-foreground">
          {knowledge.title}
        </h4>
        {/* Stars + info toggle stack on the right so the "i" sits directly
            under the rating, as Vladi requested 2026-05-05. */}
        <div className="flex flex-col items-end gap-2">
          <StarRow filled={stars} />
          {hasAuswirkungen ? (
            <ProblemInfoToggle
              open={showBg}
              onToggle={() => setShowBg((prev) => !prev)}
              label={
                showBg
                  ? (t('dealerV2.brennbewertung.backgroundHide') as string)
                  : (t('dealerV2.brennbewertung.backgroundShow') as string)
              }
            />
          ) : null}
        </div>
      </div>
      {knowledge.massnahmen.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {knowledge.massnahmen.slice(0, 4).map((step, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 text-foreground/60">›</span>
              <span>{step}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {showBg && hasAuswirkungen ? (
        <div className="tint-info mt-3 rounded-theme p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-info">
            {t('dealerV2.brennbewertung.backgroundHeading')}
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {knowledge.auswirkungen.map((line, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 text-info">→</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
};

export const BrennbewertungCard: React.FC<BrennbewertungCardProps> = React.memo(
  ({ values, topThree, isAllZero, isLoading, knowledge, source }) => {
    const { t } = useTranslation();

    if (isLoading) {
      return (
        <section className="rounded-theme bg-card p-5 shadow-theme-md">
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-muted/70" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted/70" />
        </section>
      );
    }

    if (isAllZero) {
      return (
        <section
          className="rounded-theme bg-card p-5 shadow-theme-md"
          aria-label={t('dealerV2.brennbewertung.aria') as string}
        >
          <GoodState />
        </section>
      );
    }

    return (
      <section
        className="rounded-theme bg-card p-5 shadow-theme-md"
        aria-label={t('dealerV2.brennbewertung.aria') as string}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="tint-destructive-strong flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-destructive">
            <FlameIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {t('dealerV2.brennbewertung.badTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('dealerV2.brennbewertung.badSubtitle')}
            </p>
          </div>
        </div>

        <ul className="space-y-3">
          {topThree.map((key) => (
            <ProblemEntry
              key={key}
              cKey={key}
              value={values[key]}
              knowledge={knowledge[key]}
            />
          ))}
        </ul>

        {source === 'devOverride' ? (
          <p className="tint-warning mt-3 rounded p-2 text-xs text-warning">
            {t('dealerV2.brennbewertung.devOverrideHint')}
          </p>
        ) : null}
      </section>
    );
  },
);

BrennbewertungCard.displayName = 'BrennbewertungCard';

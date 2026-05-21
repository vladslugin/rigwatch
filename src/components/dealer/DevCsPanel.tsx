import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import {
  BRENNBEWERTUNG_KEYS,
  type BrennbewertungKey,
  type BrennbewertungValues,
} from '../../types/brennbewertung';
import type { BrennbewertungKnowledgeBase } from '../../types/brennbewertung';

export interface DevCsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Currently active values (firebase or override). Used as initial form state. */
  currentValues: BrennbewertungValues;
  /** Whether a developer override is already active. */
  hasDevOverride: boolean;
  onApply: (values: BrennbewertungValues) => void;
  onClear: () => void;
  knowledge: BrennbewertungKnowledgeBase;
}

const ZEROS: BrennbewertungValues = {
  C0: 0, C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0,
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Developer/super-admin testing panel. Lets you punch in fake C0–C6 values to
 * exercise the dealer view before the firmware actually emits them. Values are
 * applied via {@link useBrennbewertung}'s `setDevOverride` and persist in
 * localStorage so a page reload keeps the test scenario active.
 *
 * The panel is opened via the "C0–C6" floating button in DealerModeLayout,
 * which itself only renders for `developer` / `super_admin` roles. Dealers
 * never see this UI.
 */
export const DevCsPanel: React.FC<DevCsPanelProps> = ({
  isOpen,
  onClose,
  currentValues,
  hasDevOverride,
  onApply,
  onClear,
  knowledge,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<BrennbewertungValues>(currentValues);

  useEscapeKey(onClose, { enabled: isOpen });

  // Reset draft to the live values whenever the panel re-opens, so the user
  // doesn't keep stale numbers from a previous session.
  useEffect(() => {
    if (isOpen) setDraft(currentValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleChange = (key: BrennbewertungKey, raw: string | number) => {
    const num = typeof raw === 'number' ? raw : Number(raw);
    setDraft((prev) => ({ ...prev, [key]: clamp(Number.isFinite(num) ? num : 0) }));
  };

  const isDirty = useMemo(
    () => BRENNBEWERTUNG_KEYS.some((key) => draft[key] !== currentValues[key]),
    [draft, currentValues],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dev-cs-panel-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-theme border border-border bg-card shadow-theme-md"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 id="dev-cs-panel-title" className="text-base font-semibold text-foreground">
              {t('dealerV2.devCs.title')}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('dealerV2.devCs.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-theme border border-border bg-card px-2 py-1 text-sm text-foreground transition-colors hover:bg-muted"
            aria-label={t('dealerV2.devCs.close') as string}
          >
            ✕
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {BRENNBEWERTUNG_KEYS.map((key) => {
              const info = knowledge[key];
              const value = draft[key];
              return (
                <div key={key} className="rounded-theme border border-border bg-background p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {key}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {info?.title ?? key}
                    </span>
                    <span className="font-mono text-sm text-foreground">{value}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={value}
                      onChange={(event) => handleChange(key, event.target.value)}
                      className="flex-1"
                      aria-label={`${key} ${info?.title ?? ''}`}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={value}
                      onChange={(event) => handleChange(key, event.target.value)}
                      className="w-16 rounded-theme border border-border bg-card px-2 py-1 text-right font-mono text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDraft(ZEROS)}
              className="rounded-theme border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t('dealerV2.devCs.allZero')}
            </button>
            <button
              type="button"
              onClick={() => setDraft({ C0: 0, C1: 0, C2: 0, C3: 75, C4: 30, C5: 50, C6: 0 })}
              className="rounded-theme border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t('dealerV2.devCs.samplePreset')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasDevOverride ? (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  onClose();
                }}
                className="rounded-theme border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                {t('dealerV2.devCs.clearOverride')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onApply(draft);
                onClose();
              }}
              disabled={!isDirty && !hasDevOverride}
              className="rounded-theme bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('dealerV2.devCs.apply')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

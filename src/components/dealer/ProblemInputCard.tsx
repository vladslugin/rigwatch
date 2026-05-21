import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDealerAnswer, type DealerAnswerCause } from '../../analysis/parseDealerAnswer';

export interface ProblemInputCardProps {
  customerProblem: string;
  onCustomerProblemChange: (next: string) => void;
  aiAnswer: string;
  aiError: string | null;
  isAnalysing: boolean;
  onAnalyse: () => void;
  /** Optional: developer-only debug view of the prompt sent to Gemini. */
  debugPrompt?: string;
  showDebugPrompt?: boolean;
}

const SparkleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2 13.5 8.5 20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5L12 2Z" />
    <path d="M19 14 19.7 16.3 22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z" opacity=".6" />
  </svg>
);

const Spinner: React.FC = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 animate-spin">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
);

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

const CauseEntry: React.FC<{ cause: DealerAnswerCause }> = ({ cause }) => (
  <li className="tint-raised rounded-theme p-4 shadow-theme-sm ring-1 ring-tint-soft">
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
      <h4 className="min-w-0 flex-1 text-base font-semibold text-foreground">{cause.text}</h4>
      {cause.stars > 0 ? <StarRow filled={cause.stars} /> : null}
    </div>
    {cause.subItems.length > 0 ? (
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {cause.subItems.map((line, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 text-foreground/60">›</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    ) : null}
  </li>
);

export const ProblemInputCard: React.FC<ProblemInputCardProps> = ({
  customerProblem,
  onCustomerProblemChange,
  aiAnswer,
  aiError,
  isAnalysing,
  onAnalyse,
  debugPrompt,
  showDebugPrompt,
}) => {
  const { t } = useTranslation();
  const canAnalyse = customerProblem.trim().length > 0 && !isAnalysing;

  const parsed = useMemo(() => parseDealerAnswer(aiAnswer), [aiAnswer]);

  return (
    <section
      className="rounded-theme bg-card p-5 shadow-theme-md"
      aria-label={t('dealerV2.problemInput.aria') as string}
    >
      <h3 className="text-lg font-semibold text-foreground">
        {t('dealerV2.problemInput.title')}
      </h3>

      <textarea
        value={customerProblem}
        onChange={(event) => onCustomerProblemChange(event.target.value)}
        placeholder={t('dealerV2.problemInput.placeholder') as string}
        rows={4}
        // bg-background is a fully-opaque hex var (— Tailwind opacity modifiers
        // can degrade with hex-based CSS vars, which made the textarea flash
        // white before focus. Solid colour stays safe across the lifecycle).
        className="mt-3 w-full resize-y rounded-theme bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary"
      />

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onAnalyse}
          disabled={!canAnalyse}
          className="inline-flex items-center gap-2 rounded-theme bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAnalysing ? <Spinner /> : <SparkleIcon className="h-4 w-4" />}
          {isAnalysing ? t('dealerV2.problemInput.analysing') : t('dealerV2.problemInput.analyse')}
        </button>
      </div>

      {aiError ? (
        <div className="tint-destructive mt-4 rounded-theme p-3 text-sm text-destructive">
          {aiError}
        </div>
      ) : null}

      {aiAnswer ? (
        <div className="mt-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('dealerV2.problemInput.answerHeading')}
          </p>

          {parsed.isStructured ? (
            <>
              {parsed.intro ? (
                <p className="mb-3 text-base font-semibold text-foreground">{parsed.intro}</p>
              ) : null}

              {parsed.causes.length > 0 ? (
                <>
                  <p className="mb-2 text-sm text-muted-foreground">
                    {t('dealerV2.problemInput.causesHeading')}
                  </p>
                  <ul className="space-y-3">
                    {parsed.causes.map((cause, idx) => (
                      <CauseEntry key={idx} cause={cause} />
                    ))}
                  </ul>
                </>
              ) : null}

              {parsed.steps.length > 0 ? (
                <div className="tint-info mt-4 rounded-theme p-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-info">
                    {t('dealerV2.problemInput.stepsHeading')}
                  </p>
                  <ul className="space-y-1.5 text-sm text-foreground">
                    {parsed.steps.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span aria-hidden="true" className="mt-0.5 text-info">→</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            // Fallback: AI returned an unparseable answer — show the raw text
            // so the dealer at least sees something.
            <div className="tint-info rounded-theme p-4">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {aiAnswer}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {showDebugPrompt && debugPrompt ? (
        <details className="tint-raised mt-4 rounded-theme p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-mono">debug: prompt sent to Gemini</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
            {debugPrompt}
          </pre>
        </details>
      ) : null}
    </section>
  );
};

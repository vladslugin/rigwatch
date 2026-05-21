import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import {
  DEALER_PROMPT_SETTINGS_LIMITS,
  DEFAULT_DEALER_PROMPT_SETTINGS,
  DEFAULT_PERSONA_INSTRUCTION,
  DEFAULT_TASK_INSTRUCTION,
  type DealerPromptSettings,
} from '../../types/dealerPromptSettings';
import { saveDealerPromptSettings } from '../../hooks/useDealerPromptSettings';

export interface DealerPromptEditorProps {
  isOpen: boolean;
  onClose: () => void;
  settings: DealerPromptSettings;
  /** UID of the editor — recorded in the Firestore document for audit. */
  editorUid?: string;
  /** False = fields are read-only. Hides Save button. */
  canEdit: boolean;
}

const settingsEqual = (a: DealerPromptSettings, b: DealerPromptSettings): boolean =>
  a.personaInstruction === b.personaInstruction &&
  a.taskInstruction === b.taskInstruction &&
  a.additionalWishes === b.additionalWishes &&
  a.causeMin === b.causeMin &&
  a.causeMax === b.causeMax &&
  a.maxWords === b.maxWords &&
  a.maxOutputTokens === b.maxOutputTokens &&
  a.temperature === b.temperature;

const NumberField: React.FC<{
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}> = ({ label, hint, value, min, max, step = 1, disabled, onChange }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => {
        const parsed = Number(event.target.value);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      className="w-full rounded-theme border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
    />
    {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
  </label>
);

const TextareaField: React.FC<{
  label: string;
  hint?: string;
  value: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  onResetToDefault?: () => void;
  resetLabel?: string;
}> = ({
  label,
  hint,
  value,
  rows = 6,
  placeholder,
  disabled,
  onChange,
  onResetToDefault,
  resetLabel,
}) => (
  <div className="block">
    <div className="mb-1 flex items-center justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {onResetToDefault && resetLabel ? (
        <button
          type="button"
          onClick={onResetToDefault}
          disabled={disabled}
          className="rounded-theme border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {resetLabel}
        </button>
      ) : null}
    </div>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full resize-y rounded-theme border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
    />
    {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
  </div>
);

/**
 * Modal for editing the globally-shared dealer prompt settings. Saved values
 * live in Firestore (`dealer_knowledge/prompt_settings`) and are pushed to
 * every dealer in real time. Editing is restricted to `developer` and
 * `super_admin` — other roles see the form in read-only mode and the Save
 * button is hidden.
 */
export const DealerPromptEditor: React.FC<DealerPromptEditorProps> = ({
  isOpen,
  onClose,
  settings,
  editorUid,
  canEdit,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DealerPromptSettings>(settings);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEscapeKey(onClose, { enabled: isOpen });

  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
      setSaveState('idle');
      setErrorMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const isDirty = useMemo(() => !settingsEqual(draft, settings), [draft, settings]);

  const update = <K extends keyof DealerPromptSettings>(key: K, value: DealerPromptSettings[K]) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      // Keep causeMax >= causeMin so the prompt always renders sensibly.
      if (key === 'causeMin' && typeof value === 'number' && next.causeMax < value) {
        next.causeMax = value;
      }
      if (key === 'causeMax' && typeof value === 'number' && next.causeMin > value) {
        next.causeMin = value;
      }
      return next;
    });
  };

  const handleResetAll = () => {
    setDraft(DEFAULT_DEALER_PROMPT_SETTINGS);
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaveState('saving');
    setErrorMsg(null);
    const result = await saveDealerPromptSettings(draft, editorUid);
    if (result.success) {
      setSaveState('saved');
      window.setTimeout(() => onClose(), 800);
    } else {
      setSaveState('error');
      setErrorMsg(result.error ?? null);
    }
  };

  if (!isOpen) return null;

  const limits = DEALER_PROMPT_SETTINGS_LIMITS;
  const disabled = !canEdit;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dealer-prompt-editor-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-theme border border-border bg-card shadow-theme-md"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 id="dealer-prompt-editor-title" className="text-base font-semibold text-foreground">
              {t('dealerV2.promptEditor.title')}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {canEdit
                ? t('dealerV2.promptEditor.subtitle')
                : t('dealerV2.promptEditor.subtitleReadOnly')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-theme border border-border bg-card px-2 py-1 text-sm text-foreground transition-colors hover:bg-muted"
            aria-label={t('dealerV2.promptEditor.close') as string}
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <TextareaField
            label={t('dealerV2.promptEditor.fields.persona')}
            hint={t('dealerV2.promptEditor.fields.personaHint') as string}
            value={draft.personaInstruction}
            placeholder={DEFAULT_PERSONA_INSTRUCTION}
            rows={5}
            disabled={disabled}
            onChange={(next) => update('personaInstruction', next)}
            onResetToDefault={
              canEdit
                ? () => update('personaInstruction', DEFAULT_PERSONA_INSTRUCTION)
                : undefined
            }
            resetLabel={t('dealerV2.promptEditor.resetField') as string}
          />

          <TextareaField
            label={t('dealerV2.promptEditor.fields.task')}
            hint={t('dealerV2.promptEditor.fields.taskHint') as string}
            value={draft.taskInstruction}
            placeholder={DEFAULT_TASK_INSTRUCTION}
            rows={14}
            disabled={disabled}
            onChange={(next) => update('taskInstruction', next)}
            onResetToDefault={
              canEdit
                ? () => update('taskInstruction', DEFAULT_TASK_INSTRUCTION)
                : undefined
            }
            resetLabel={t('dealerV2.promptEditor.resetField') as string}
          />

          <TextareaField
            label={t('dealerV2.promptEditor.fields.wishes')}
            hint={t('dealerV2.promptEditor.fields.wishesHint') as string}
            value={draft.additionalWishes}
            placeholder={t('dealerV2.promptEditor.fields.wishesPlaceholder') as string}
            rows={5}
            disabled={disabled}
            onChange={(next) => update('additionalWishes', next)}
          />

          <div className="rounded-theme border border-border bg-background p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {t('dealerV2.promptEditor.parametersHeading')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField
                label={t('dealerV2.promptEditor.fields.causeMin')}
                hint={t('dealerV2.promptEditor.fields.causeMinHint') as string}
                value={draft.causeMin}
                min={limits.causeMinMin}
                max={limits.causeMaxMax}
                disabled={disabled}
                onChange={(v) => update('causeMin', v)}
              />
              <NumberField
                label={t('dealerV2.promptEditor.fields.causeMax')}
                hint={t('dealerV2.promptEditor.fields.causeMaxHint') as string}
                value={draft.causeMax}
                min={limits.causeMinMin}
                max={limits.causeMaxMax}
                disabled={disabled}
                onChange={(v) => update('causeMax', v)}
              />
              <NumberField
                label={t('dealerV2.promptEditor.fields.maxWords')}
                hint={t('dealerV2.promptEditor.fields.maxWordsHint') as string}
                value={draft.maxWords}
                min={0}
                max={limits.maxWordsMax}
                step={10}
                disabled={disabled}
                onChange={(v) => update('maxWords', v)}
              />
              <NumberField
                label={t('dealerV2.promptEditor.fields.maxOutputTokens')}
                hint={t('dealerV2.promptEditor.fields.maxOutputTokensHint') as string}
                value={draft.maxOutputTokens}
                min={0}
                max={limits.maxOutputTokensMax}
                step={64}
                disabled={disabled}
                onChange={(v) => update('maxOutputTokens', v)}
              />
              <NumberField
                label={t('dealerV2.promptEditor.fields.temperature')}
                hint={t('dealerV2.promptEditor.fields.temperatureHint') as string}
                value={draft.temperature}
                min={limits.temperatureMin}
                max={limits.temperatureMax}
                step={0.1}
                disabled={disabled}
                onChange={(v) => update('temperature', v)}
              />
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          {canEdit ? (
            <button
              type="button"
              onClick={handleResetAll}
              className="rounded-theme border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t('dealerV2.promptEditor.resetAll')}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('dealerV2.promptEditor.readOnlyHint')}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {saveState === 'saved' ? (
              <span className="text-sm font-medium text-success">
                {t('dealerV2.promptEditor.saved')}
              </span>
            ) : null}
            {saveState === 'error' && errorMsg ? (
              <span className="text-sm text-destructive">{errorMsg}</span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-theme border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {canEdit
                ? t('dealerV2.promptEditor.cancel')
                : t('dealerV2.promptEditor.close')}
            </button>
            {canEdit ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || saveState === 'saving'}
                className="rounded-theme bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveState === 'saving'
                  ? t('dealerV2.promptEditor.saving')
                  : t('dealerV2.promptEditor.save')}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
};

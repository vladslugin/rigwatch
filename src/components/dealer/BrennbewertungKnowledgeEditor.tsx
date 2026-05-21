import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import {
  BRENNBEWERTUNG_KEYS,
  type BrennbewertungKey,
  type BrennbewertungKnowledgeBase,
  type BrennbewertungVariableInfo,
} from '../../types/brennbewertung';
import { DEFAULT_BRENNBEWERTUNG_KNOWLEDGE } from '../../utils/brennbewertungKnowledge';
import { saveBrennbewertungKnowledge } from '../../hooks/useBrennbewertungKnowledge';

export interface BrennbewertungKnowledgeEditorProps {
  isOpen: boolean;
  onClose: () => void;
  knowledge: BrennbewertungKnowledgeBase;
  /** UID of the editor — recorded in the Firestore document for audit. */
  editorUid?: string;
}

type Draft = Record<BrennbewertungKey, {
  title: string;
  grund: string;          // newline-separated lines
  auswirkungen: string;   // newline-separated lines
  massnahmen: string;     // newline-separated lines
}>;

const linesToText = (lines: string[]) => lines.join('\n');
const textToLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const buildDraft = (knowledge: BrennbewertungKnowledgeBase): Draft => {
  const draft = {} as Draft;
  for (const key of BRENNBEWERTUNG_KEYS) {
    const info = knowledge[key];
    draft[key] = {
      title: info.title,
      grund: linesToText(info.grund),
      auswirkungen: linesToText(info.auswirkungen),
      massnahmen: linesToText(info.massnahmen),
    };
  }
  return draft;
};

const draftToKnowledge = (draft: Draft): BrennbewertungKnowledgeBase => {
  const result = {} as BrennbewertungKnowledgeBase;
  for (const key of BRENNBEWERTUNG_KEYS) {
    const entry = draft[key];
    result[key] = {
      title: entry.title.trim() || DEFAULT_BRENNBEWERTUNG_KNOWLEDGE[key].title,
      grund: textToLines(entry.grund),
      auswirkungen: textToLines(entry.auswirkungen),
      massnahmen: textToLines(entry.massnahmen),
    } as BrennbewertungVariableInfo;
  }
  return result;
};

const Section: React.FC<{
  cKey: BrennbewertungKey;
  draft: Draft[BrennbewertungKey];
  onChange: (next: Draft[BrennbewertungKey]) => void;
  onResetToDefault: () => void;
  isOpen: boolean;
  onToggle: () => void;
}> = ({ cKey, draft, onChange, onResetToDefault, isOpen, onToggle }) => {
  const { t } = useTranslation();
  return (
    <div className="rounded-theme border border-border bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        aria-expanded={isOpen}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {cKey}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {draft.title || t('dealerV2.editor.untitled')}
          </span>
        </div>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {isOpen ? (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('dealerV2.editor.fields.title')}
            </span>
            <input
              type="text"
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="w-full rounded-theme border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('dealerV2.editor.fields.grund')}
            </span>
            <textarea
              value={draft.grund}
              onChange={(event) => onChange({ ...draft, grund: event.target.value })}
              rows={3}
              placeholder={t('dealerV2.editor.fields.linesHint') as string}
              className="w-full rounded-theme border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('dealerV2.editor.fields.auswirkungen')}
            </span>
            <textarea
              value={draft.auswirkungen}
              onChange={(event) => onChange({ ...draft, auswirkungen: event.target.value })}
              rows={6}
              placeholder={t('dealerV2.editor.fields.linesHint') as string}
              className="w-full rounded-theme border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('dealerV2.editor.fields.massnahmen')}
            </span>
            <textarea
              value={draft.massnahmen}
              onChange={(event) => onChange({ ...draft, massnahmen: event.target.value })}
              rows={4}
              placeholder={t('dealerV2.editor.fields.linesHint') as string}
              className="w-full rounded-theme border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onResetToDefault}
              className="rounded-theme border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t('dealerV2.editor.resetSection')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Modal where Claus (and other privileged users) edit the dealer-mode
 * knowledge base. Each variable C0..C6 gets a collapsible section with four
 * fields (title + three line-separated lists). On save we push the merged
 * payload to Firestore via {@link saveBrennbewertungKnowledge}; the dealer
 * view picks up the change in real time through {@link useBrennbewertungKnowledge}.
 *
 * Every textarea uses a "one item per line" convention — the cleanest UX
 * given that we only need plain text bullet points. No add/remove buttons
 * needed; pasting from Word works as expected.
 */
export const BrennbewertungKnowledgeEditor: React.FC<BrennbewertungKnowledgeEditorProps> = ({
  isOpen,
  onClose,
  knowledge,
  editorUid,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => buildDraft(knowledge));
  const [openSection, setOpenSection] = useState<BrennbewertungKey | null>('C0');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEscapeKey(onClose, { enabled: isOpen });

  // Reset the draft when the panel opens, so we always start from the live
  // Firestore snapshot rather than stale form values from a previous session.
  useEffect(() => {
    if (isOpen) {
      setDraft(buildDraft(knowledge));
      setSaveState('idle');
      setErrorMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const isDirty = useMemo(() => {
    const live = buildDraft(knowledge);
    return BRENNBEWERTUNG_KEYS.some((key) => {
      const a = draft[key];
      const b = live[key];
      return (
        a.title !== b.title ||
        a.grund !== b.grund ||
        a.auswirkungen !== b.auswirkungen ||
        a.massnahmen !== b.massnahmen
      );
    });
  }, [draft, knowledge]);

  const updateSection = (key: BrennbewertungKey, next: Draft[BrennbewertungKey]) => {
    setDraft((prev) => ({ ...prev, [key]: next }));
  };

  const resetSectionToDefault = (key: BrennbewertungKey) => {
    const def = DEFAULT_BRENNBEWERTUNG_KNOWLEDGE[key];
    setDraft((prev) => ({
      ...prev,
      [key]: {
        title: def.title,
        grund: linesToText(def.grund),
        auswirkungen: linesToText(def.auswirkungen),
        massnahmen: linesToText(def.massnahmen),
      },
    }));
  };

  const resetAllToDefault = () => {
    setDraft(buildDraft(DEFAULT_BRENNBEWERTUNG_KNOWLEDGE));
  };

  const handleSave = async () => {
    setSaveState('saving');
    setErrorMsg(null);
    const payload = draftToKnowledge(draft);
    const result = await saveBrennbewertungKnowledge(payload, editorUid);
    if (result.success) {
      setSaveState('saved');
      // Auto-close after a short success indicator.
      window.setTimeout(() => onClose(), 800);
    } else {
      setSaveState('error');
      setErrorMsg(result.error ?? null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="brennbewertung-editor-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-theme border border-border bg-card shadow-theme-md"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 id="brennbewertung-editor-title" className="text-base font-semibold text-foreground">
              {t('dealerV2.editor.title')}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('dealerV2.editor.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-theme border border-border bg-card px-2 py-1 text-sm text-foreground transition-colors hover:bg-muted"
            aria-label={t('dealerV2.editor.close') as string}
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-3">
            {BRENNBEWERTUNG_KEYS.map((key) => (
              <Section
                key={key}
                cKey={key}
                draft={draft[key]}
                onChange={(next) => updateSection(key, next)}
                onResetToDefault={() => resetSectionToDefault(key)}
                isOpen={openSection === key}
                onToggle={() => setOpenSection((prev) => (prev === key ? null : key))}
              />
            ))}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={resetAllToDefault}
            className="rounded-theme border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {t('dealerV2.editor.resetAll')}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {saveState === 'saved' ? (
              <span className="text-sm font-medium text-success">{t('dealerV2.editor.saved')}</span>
            ) : null}
            {saveState === 'error' && errorMsg ? (
              <span className="text-sm text-destructive">{errorMsg}</span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-theme border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t('dealerV2.editor.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saveState === 'saving'}
              className="rounded-theme bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveState === 'saving' ? t('dealerV2.editor.saving') : t('dealerV2.editor.save')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

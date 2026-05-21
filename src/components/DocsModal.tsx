import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useEscapeKey } from '../hooks/useEscapeKey';
import {
  DOC_SECTIONS,
  filterByAudience,
  searchSections,
  type DocAudience,
  type DocSection,
} from '../docs/docsRegistry';

export interface DocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AudienceFilter = 'all' | DocAudience;

const AUDIENCE_ORDER: ReadonlyArray<AudienceFilter> = ['all', 'user', 'dev'];

/**
 * Modal containing the full in-app documentation. Layout: searchable TOC on
 * the left, rendered Markdown on the right. Top toolbar exposes an audience
 * filter (Alle / Endnutzer / Entwickler) so dealers don't see Cloud Functions
 * config and developers don't have to scroll past "wie sich anmelden".
 *
 * Source of truth: the project-root `DOKUMENTATION_DE.md`. The registry
 * (`docsRegistry.ts`) parses that file at build time, splitting it on the
 * `## N. Title` headings and pairing each section with an audience tag.
 */
const DocsModal: React.FC<DocsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  const [audience, setAudience] = useState<AudienceFilter>('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const contentScrollRef = useRef<HTMLDivElement>(null);

  useEscapeKey(onClose, { enabled: isOpen });

  // Reset transient state when the modal closes — feels off if a stale search
  // term or a previously-opened section is still selected next time.
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setAudience('all');
      setActiveId(null);
    }
  }, [isOpen]);

  // Visible sections after audience + search filters.
  const visibleSections = useMemo<DocSection[]>(() => {
    const byAudience = filterByAudience(DOC_SECTIONS, audience);
    return searchSections(byAudience, query).sort((a, b) => a.number - b.number);
  }, [audience, query]);

  // Pick the first visible section when filters change or modal opens.
  useEffect(() => {
    if (!isOpen) return;
    if (visibleSections.length === 0) {
      setActiveId(null);
      return;
    }
    const stillVisible = visibleSections.some((s) => s.id === activeId);
    if (!stillVisible) {
      setActiveId(visibleSections[0].id);
      // Scroll the content pane back to top when the section changes.
      if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
    }
  }, [isOpen, visibleSections, activeId]);

  // Smoothly scroll content to top when the user picks a different section.
  const handleSelect = (id: string) => {
    setActiveId(id);
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const activeSection = useMemo(
    () => visibleSections.find((s) => s.id === activeId) ?? null,
    [visibleSections, activeId],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="docs-modal-title"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-theme bg-card shadow-theme-lg"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 id="docs-modal-title" className="text-base font-semibold text-foreground">
              {t('docs.title')}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('docs.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.open('/docs', '_blank', 'noopener,noreferrer')}
              className="inline-flex items-center gap-1.5 rounded-theme bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              title={t('docs.openPrintView') as string}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              <span>{t('docs.openPrintView')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-theme bg-card px-2 py-1 text-sm text-foreground transition-colors hover:bg-muted"
              aria-label={t('docs.close') as string}
            >
              ✕
            </button>
          </div>
        </header>

        {/* Toolbar: search + audience filter */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative min-w-[200px] flex-1">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('docs.searchPlaceholder') as string}
              className="w-full rounded-theme bg-background px-3 py-2 pl-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <div
            role="tablist"
            aria-label={t('docs.audienceLabel') as string}
            className="inline-flex rounded-theme bg-background p-1"
          >
            {AUDIENCE_ORDER.map((aud) => (
              <button
                key={aud}
                type="button"
                role="tab"
                aria-selected={audience === aud}
                onClick={() => setAudience(aud)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  audience === aud
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`docs.audience.${aud}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Body: TOC + content */}
        <div className="flex min-h-0 flex-1">
          {/* TOC */}
          <nav
            className="hidden w-64 flex-shrink-0 overflow-y-auto border-r border-border bg-background/50 px-3 py-3 md:block"
            aria-label={t('docs.tocLabel') as string}
          >
            {visibleSections.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                {t('docs.noResults')}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {visibleSections.map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(section.id)}
                      className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                        activeId === section.id
                          ? 'bg-primary/15 text-foreground'
                          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                      }`}
                    >
                      <span className="mt-0.5 inline-block min-w-[1.5rem] font-mono text-[11px] text-muted-foreground">
                        {section.number}.
                      </span>
                      <span className="min-w-0 flex-1 leading-snug">{section.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          {/* Mobile section picker */}
          <div className="border-b border-border px-4 py-2 md:hidden">
            <select
              value={activeId ?? ''}
              onChange={(event) => handleSelect(event.target.value)}
              className="w-full rounded-theme bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {visibleSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.number}. {section.title}
                </option>
              ))}
            </select>
          </div>

          {/* Content */}
          <div
            ref={contentScrollRef}
            className="min-w-0 flex-1 overflow-y-auto px-6 py-6"
          >
            {activeSection ? (
              <article>
                <header className="mb-4 flex flex-wrap items-baseline gap-3">
                  <h1 className="text-2xl font-semibold text-foreground">
                    {activeSection.title}
                  </h1>
                  <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    Kapitel {activeSection.number}
                  </span>
                  <AudienceBadge audience={activeSection.audience} />
                </header>
                <div className="prose prose-invert prose-sm max-w-none prose-headings:text-foreground prose-h3:mt-6 prose-h3:text-base prose-h3:font-semibold prose-p:text-foreground/90 prose-strong:text-foreground prose-a:text-info prose-code:rounded prose-code:bg-background prose-code:px-1 prose-code:py-0.5 prose-code:text-info prose-code:before:content-none prose-code:after:content-none prose-pre:bg-background prose-pre:text-foreground prose-li:text-foreground/90 prose-table:text-sm prose-th:text-foreground prose-th:border-border prose-td:border-border">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {activeSection.content}
                  </ReactMarkdown>
                </div>
              </article>
            ) : (
              <p className="text-sm text-muted-foreground">{t('docs.noResults')}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2 text-xs text-muted-foreground">
          <span>{t('docs.footerHint')}</span>
          <span className="font-mono">
            {visibleSections.length} / {DOC_SECTIONS.length}
          </span>
        </footer>
      </div>
    </div>
  );
};

const AudienceBadge: React.FC<{ audience: DocAudience }> = ({ audience }) => {
  const { t } = useTranslation();
  const tone =
    audience === 'dev'
      ? 'tint-warning-strong text-warning'
      : audience === 'user'
        ? 'tint-success-strong text-success'
        : 'tint-info-strong text-info';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {t(`docs.audience.${audience}`)}
    </span>
  );
};

export default DocsModal;

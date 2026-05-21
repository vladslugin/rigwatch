import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';

import { DOC_SECTIONS, type DocSection } from '../docs/docsRegistry';
import {
  DemoBrennbewertungGood,
  DemoBrennbewertungBad,
  DemoOfenFunktionError,
  DemoCauseEntry,
} from '../docs/demos/dealerDemos';
import {
  DemoStatusPills,
  DemoFirmwareStatus,
  DemoInfoToggle,
} from '../docs/demos/utilityDemos';
import { DemoTerminal, DemoHasenfetch } from '../docs/demos/terminalDemos';

/**
 * Visual demos that get rendered below the markdown body of specific chapters.
 * Keep the list short and meaningful — demos exist where they actually help a
 * reader picture the UI. Chapters not in this map render text-only.
 *
 * Note: a Luftstrom schematic existed earlier but was removed — it was an
 * imagined drawing rather than a real reflection of HASE-stove geometry, and
 * a wrong picture is worse than no picture. Chapter 20 stays text-only until
 * we get an authoritative diagram from the HASE team.
 */
const DEMOS_BY_CHAPTER: Record<number, React.FC[]> = {
  // Ch.12 Terminal — sample session showing prompt, commands, output.
  12: [DemoTerminal],
  // Ch.15 Händlermodus — the most visual chapter; show the dealer cards.
  15: [
    DemoStatusPills,
    DemoBrennbewertungGood,
    DemoBrennbewertungBad,
    DemoOfenFunktionError,
    DemoCauseEntry,
    DemoInfoToggle,
  ],
  // Ch.25 Aktionen-Block — the three firmware states.
  25: [DemoFirmwareStatus],
  // Ch.32 Easter Eggs — the hasenfetch ASCII output.
  32: [DemoHasenfetch],
};

/**
 * Print-ready, single-scroll documentation page mounted at `/docs`.
 *
 * Goals:
 *  - Browser view: clean, readable, long-form layout — like reading a book.
 *  - Print view: each chapter starts on a new page, A4-sized, black on white,
 *    no app chrome, no buttons, no nav. Hit Cmd/Ctrl-P → ready to print or
 *    save as PDF.
 *
 * The page bypasses the normal Hasenradar shell completely (App.tsx renders
 * this component instead of the dealer/simple/full layout when the path is
 * `/docs`), so there is no header, no auth gate, no Firebase wiring — just
 * the raw markdown content. This makes the print output deterministic.
 */
const DocsFullPage: React.FC = () => {
  const { t } = useTranslation();
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Force light theme on this page — printing dark mode wastes ink.
  // We also flip <html>'s `dark` class off in case the user came from
  // dark-mode browsing.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    if (wasDark) root.classList.remove('dark');
    // Set the page title so the print header / saved PDF gets a good name.
    const prevTitle = document.title;
    document.title = 'Hasenradar — Dokumentation';
    return () => {
      if (wasDark) root.classList.add('dark');
      document.title = prevTitle;
    };
  }, []);

  // Show "back to top" button after the cover scrolls out of view.
  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="docs-page">
      {/* Print-only @page rules + screen styling are defined inline so the
          page is self-contained — no global CSS dependency, no risk of
          theming variables overriding the print output. */}
      <style>{PRINT_CSS}</style>

      <header className="docs-page__cover">
        <h1 className="docs-page__cover-title">Hasenradar</h1>
        <p className="docs-page__cover-subtitle">{t('docs.title')}</p>
        <p className="docs-page__cover-meta">
          {t('docs.printGeneratedOn', { defaultValue: 'Stand:' })}{' '}
          {new Date().toLocaleDateString('de-DE', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
        <p className="docs-page__cover-author">
          Autor: Vladislav Slugin ·{' '}
          <a href="mailto:vladslugin987@gmail.com">vladslugin987@gmail.com</a>
        </p>

        {/* Action bar — visible on screen, hidden in print */}
        <div className="docs-page__actions no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="docs-page__btn docs-page__btn--primary"
          >
            {t('docs.print', { defaultValue: 'Drucken / Als PDF speichern' })}
          </button>
          <a
            href="/"
            className="docs-page__btn"
          >
            {t('docs.backToApp', { defaultValue: 'Zur App zurück' })}
          </a>
        </div>

        {/* Table of contents */}
        <nav className="docs-page__toc" aria-label={t('docs.tocLabel') as string}>
          <h2 className="docs-page__toc-title">{t('docs.tocLabel')}</h2>
          <ol className="docs-page__toc-list">
            {DOC_SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="docs-page__toc-link">
                  <span className="docs-page__toc-num">{section.number}.</span>{' '}
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <main className="docs-page__main">
        {DOC_SECTIONS.map((section) => (
          <Chapter key={section.id} section={section} />
        ))}
      </main>

      <footer className="docs-page__footer">
        <p>Hasenradar — © HASE, Trier</p>
        <p>
          Dokumentation verfasst von Vladislav Slugin ·{' '}
          <a href="mailto:vladslugin987@gmail.com">vladslugin987@gmail.com</a>
        </p>
      </footer>

      {/* Floating back-to-top button — appears after the cover scrolls away.
          Hidden in print via .no-print. */}
      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="docs-page__back-to-top no-print"
          aria-label={t('docs.backToTop', { defaultValue: 'Nach oben' }) as string}
          title={t('docs.backToTop', { defaultValue: 'Nach oben' }) as string}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="20"
            height="20"
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
};

const Chapter: React.FC<{ section: DocSection }> = ({ section }) => {
  const demos = DEMOS_BY_CHAPTER[section.number];
  return (
    <article id={section.id} className="docs-chapter">
      <header className="docs-chapter__header">
        <p className="docs-chapter__number">Kapitel {section.number}</p>
        <h1 className="docs-chapter__title">{section.title}</h1>
      </header>
      <div className="docs-chapter__body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content}</ReactMarkdown>
      </div>
      {demos && demos.length > 0 ? (
        <div className="docs-chapter__demos">
          {demos.map((Demo, idx) => (
            <Demo key={idx} />
          ))}
        </div>
      ) : null}
    </article>
  );
};

/**
 * All styles are scoped under `.docs-page` so they cannot leak into any
 * other view if React unmounts this component without removing the <style>
 * tag (it does remove it, but defense-in-depth never hurts).
 *
 * The `@page` rule sets A4 paper with 2cm margins. `page-break-before` on
 * each chapter ensures each one starts on a fresh sheet — important so
 * the printed booklet has a clean, scannable layout.
 */
const PRINT_CSS = `
:root[data-docs-page] {
  background: #ffffff;
  color: #111111;
}

/* Smooth anchor-link scrolling, with a slight top offset so the chapter
   header doesn't slam into the top edge of the viewport. */
html { scroll-behavior: smooth; }
.docs-chapter { scroll-margin-top: 1.5rem; }

.docs-page {
  background: #ffffff;
  color: #111111;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  max-width: 800px;
  margin: 0 auto;
  padding: 2.5rem 2rem 4rem;
  line-height: 1.6;
  font-size: 14px;
}

.docs-page__cover {
  padding: 3rem 0 2rem;
  border-bottom: 1px solid #d1d5db;
  margin-bottom: 2rem;
}

.docs-page__cover-title {
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 0.5rem;
}
.docs-page__cover-subtitle {
  font-size: 1.25rem;
  color: #4b5563;
  margin: 0 0 0.25rem;
}
.docs-page__cover-meta {
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0 0 0.25rem;
}
.docs-page__cover-author {
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0 0 2rem;
}
.docs-page__cover-author a {
  color: inherit;
  text-decoration: underline;
}

.docs-page__actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 2.5rem;
  flex-wrap: wrap;
}
.docs-page__btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #111111;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 0.15s;
}
.docs-page__btn:hover { background: #f3f4f6; }
.docs-page__btn--primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}
.docs-page__btn--primary:hover { background: #1d4ed8; }

.docs-page__toc-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0 0 0.75rem;
}
.docs-page__toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
  column-count: 2;
  column-gap: 2rem;
}
.docs-page__toc-list li {
  break-inside: avoid;
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}
.docs-page__toc-link {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  color: #1f2937;
  text-decoration: none;
  padding: 0.25rem 0.4rem;
  margin: 0 -0.4rem;
  border-radius: 0.25rem;
  transition: background-color 0.12s ease;
}
.docs-page__toc-link:hover {
  background: #f3f4f6;
  text-decoration: none;
}
.docs-page__toc-num {
  display: inline-block;
  min-width: 1.75rem;
  font-variant-numeric: tabular-nums;
  color: #9ca3af;
  font-weight: 500;
}

.docs-page__main { }

.docs-chapter {
  margin: 0 0 3rem;
  /* Each chapter starts on a fresh printed page. On screen this is just an
     extra top margin (handled by the natural document flow). */
  break-before: page;
  -webkit-column-break-before: page;
  page-break-before: always;
}
.docs-chapter:first-child {
  break-before: auto;
  page-break-before: auto;
}

.docs-chapter__header {
  margin: 0 0 1.5rem;
  padding: 0 0 0.75rem;
  border-bottom: 2px solid #111111;
}
.docs-chapter__number {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
  margin: 0 0 0.25rem;
}
.docs-chapter__title {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.01em;
}

/* Container for the inline demo components below each chapter's body. */
.docs-chapter__demos {
  margin: 1.5rem 0 0;
}
.docs-chapter__demos > * + * {
  margin-top: 1rem;
}

/* Markdown body styles — readable defaults that translate well to print. */
.docs-chapter__body { }
.docs-chapter__body h2,
.docs-chapter__body h3,
.docs-chapter__body h4 {
  break-after: avoid;
  page-break-after: avoid;
  font-weight: 600;
  margin: 1.75rem 0 0.5rem;
  letter-spacing: -0.01em;
}
.docs-chapter__body h2 { font-size: 1.25rem; }
.docs-chapter__body h3 { font-size: 1.125rem; }
.docs-chapter__body h4 { font-size: 1rem; }
.docs-chapter__body p { margin: 0 0 0.85rem; }
.docs-chapter__body ul, .docs-chapter__body ol {
  margin: 0 0 0.85rem;
  padding-left: 1.5rem;
}
.docs-chapter__body li { margin: 0.15rem 0; }
.docs-chapter__body a { color: #2563eb; }
.docs-chapter__body strong { font-weight: 600; }
.docs-chapter__body em { font-style: italic; }
.docs-chapter__body code {
  background: #f3f4f6;
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.875em;
}
.docs-chapter__body pre {
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  padding: 0.85rem 1rem;
  margin: 0.5rem 0 1rem;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.825rem;
  line-height: 1.45;
  white-space: pre;
  word-break: keep-all;
  /* Keep code blocks together on a page when possible. */
  break-inside: avoid;
  page-break-inside: avoid;
}
.docs-chapter__body pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}
.docs-chapter__body table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5rem 0 1rem;
  font-size: 0.875rem;
  break-inside: avoid;
  page-break-inside: avoid;
}
.docs-chapter__body th, .docs-chapter__body td {
  border: 1px solid #d1d5db;
  padding: 0.45rem 0.65rem;
  text-align: left;
  vertical-align: top;
}
.docs-chapter__body th {
  background: #f9fafb;
  font-weight: 600;
}
.docs-chapter__body blockquote {
  border-left: 3px solid #d1d5db;
  padding: 0.25rem 0 0.25rem 1rem;
  margin: 0.85rem 0;
  color: #4b5563;
  font-style: italic;
}
.docs-chapter__body hr {
  border: 0;
  border-top: 1px solid #d1d5db;
  margin: 1.5rem 0;
}

.docs-page__footer {
  margin-top: 4rem;
  padding-top: 1rem;
  border-top: 1px solid #d1d5db;
  font-size: 0.75rem;
  color: #6b7280;
  text-align: center;
}
.docs-page__footer p { margin: 0.15rem 0; }
.docs-page__footer a { color: inherit; text-decoration: underline; }

/* Floating back-to-top button. Plain black-on-white with a soft shadow —
   keeps the print aesthetic on screen too. */
.docs-page__back-to-top {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  width: 2.5rem;
  height: 2.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #111111;
  color: #ffffff;
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition: transform 0.15s ease, background-color 0.15s ease;
  z-index: 50;
}
.docs-page__back-to-top:hover {
  background: #000000;
  transform: translateY(-1px);
}

/* ───── Print-specific overrides ───── */
@media print {
  @page {
    size: A4;
    margin: 2cm;
  }
  html, body, .docs-page {
    background: #ffffff !important;
    color: #000000 !important;
  }
  .docs-page {
    max-width: none;
    margin: 0;
    padding: 0;
    font-size: 11pt;
    line-height: 1.5;
  }
  .docs-page__cover {
    padding: 0;
    border-bottom: 1px solid #000;
    margin-bottom: 1.5rem;
  }
  .docs-page__cover-title { font-size: 28pt; }
  .docs-page__cover-subtitle { font-size: 14pt; }
  .docs-page__cover-meta { font-size: 9pt; }
  .docs-page__cover-author { font-size: 9pt; }
  .docs-page__cover-author a { color: #000 !important; }
  .docs-page__footer a { color: #000 !important; }
  .docs-page__toc-list { column-count: 2; column-gap: 1.5cm; font-size: 9pt; }
  .docs-page__toc-link { color: #000 !important; }
  .docs-chapter__title { font-size: 16pt; }
  .docs-chapter__body h2 { font-size: 12pt; }
  .docs-chapter__body h3 { font-size: 11pt; }
  .docs-chapter__body h4 { font-size: 10.5pt; }
  .docs-chapter__body a { color: #000 !important; text-decoration: none; }
  .docs-chapter__body pre { background: #f3f4f6 !important; }
  .docs-chapter__body code { background: #f3f4f6 !important; }
  .no-print { display: none !important; }
}
`;

export default DocsFullPage;

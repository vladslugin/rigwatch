// @ts-expect-error — Vite handles ?raw imports at build time; type is declared in vite-env.d.ts
import rawMarkdown from '../../RIGWATCH_DOCS.md?raw';

/**
 * Audience tag for a documentation chapter.
 * - `user`   — relevant to end users / dealers / customer service staff
 * - `dev`    — relevant to developers / deployers only
 * - `all`    — relevant to both
 */
export type DocAudience = 'user' | 'dev' | 'all';

export interface DocSection {
  /** Chapter number from the heading, e.g. 1, 2, 17. */
  number: number;
  /** Anchor-friendly id, e.g. `was-ist-rigwatch`. */
  id: string;
  /** Human-readable title, e.g. "Was ist RigWatch?". */
  title: string;
  /** Markdown body of the section (without the `## N. Title` header line). */
  content: string;
  /** Which audience this section belongs to. */
  audience: DocAudience;
}

/**
 * Audience map keyed by chapter number. Kept here rather than inline in the
 * markdown so the .md file stays clean & GitHub-readable.
 */
const AUDIENCE_BY_NUMBER: Record<number, DocAudience> = {
  1: 'all',  // Was ist RigWatch?
  2: 'all',  // Wie die App aufgebaut ist
  3: 'user', // Anmeldung und Rollen
  4: 'user', // Gerät verbinden
  5: 'user', // Hauptansicht
  6: 'user', // Parameter und Kategorien
  7: 'user', // Diagramme
  8: 'user', // Alarme und Benachrichtigungen
  9: 'all',  // KI-Diagnose
  10: 'user', // Einfacher Modus
  11: 'all', // Admin-Panel
  12: 'dev', // Terminal und Skripte
  13: 'user', // Chat, Tickets und Updates
  14: 'user', // Einstellungen
  15: 'user', // Händlermodus
  16: 'all', // Kundenservice-Inbox
  17: 'dev', // KI-Prompt-Editor
  18: 'all', // Brennbewertung-Texte
  19: 'dev', // Entwickler-Testpanel
  20: 'user', // Luftstrom-Diagramm
  21: 'dev', // Fuzzy-Logik-Visualizer
  22: 'user', // Globale Parametersuche
  23: 'user', // Parameter-Varianten
  24: 'dev', // Firebase-Konsole
  25: 'user', // Ofen-Aktionen
  26: 'user', // Historische Daten
  27: 'all', // Anzeigeprofile
  28: 'all', // Ofen-Identifikation
  29: 'all', // App-Updates
  30: 'all', // Aktive Zuschauer
  31: 'user', // PWA + Push
  32: 'all', // Easter Eggs
  33: 'dev', // Für Entwickler
  34: 'dev', // Deployment
};

/** Slugify a heading text for use as an anchor / id. */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[äöüß]/g, (c) => ({ ä: 'a', ö: 'o', ü: 'u', ß: 'ss' }[c] || c))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Parse the raw `DOKUMENTATION_DE.md` content into an array of sections.
 *
 * Sections are detected by lines matching `## N. Title` at the start of a
 * line. Everything up to the next `## ` heading is the section body. Content
 * before the first `## ` (table of contents, etc.) is discarded — the modal
 * builds its own TOC from the parsed sections.
 */
const parseSections = (raw: string): DocSection[] => {
  const headingRe = /^## (\d+)\.\s+(.+)$/;
  const lines = raw.split(/\r?\n/);

  const sections: DocSection[] = [];
  let current: { number: number; title: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    const match = headingRe.exec(line);
    if (match) {
      if (current) {
        sections.push({
          number: current.number,
          id: slugify(current.title),
          title: current.title,
          content: current.bodyLines.join('\n').trim(),
          audience: AUDIENCE_BY_NUMBER[current.number] ?? 'all',
        });
      }
      current = {
        number: parseInt(match[1], 10),
        title: match[2].trim(),
        bodyLines: [],
      };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }

  if (current) {
    sections.push({
      number: current.number,
      id: slugify(current.title),
      title: current.title,
      content: current.bodyLines.join('\n').trim(),
      audience: AUDIENCE_BY_NUMBER[current.number] ?? 'all',
    });
  }

  // Drop any trailing horizontal rules (`---`) and empty lines from each section
  // body so the rendered Markdown does not show stray separators.
  return sections.map((s) => ({
    ...s,
    content: s.content.replace(/\n*-{3,}\s*$/m, '').trim(),
  }));
};

/** Pre-parsed sections — computed once at module load. */
export const DOC_SECTIONS: ReadonlyArray<DocSection> = parseSections(rawMarkdown);

/**
 * Filter sections by audience. `'all'` (no filter) returns everything.
 * `'user'` returns user + all. `'dev'` returns dev + all.
 */
export const filterByAudience = (
  sections: ReadonlyArray<DocSection>,
  audience: DocAudience | 'all',
): DocSection[] => {
  if (audience === 'all') return [...sections];
  return sections.filter((s) => s.audience === audience || s.audience === 'all');
};

/**
 * Case-insensitive substring search across title + content. Returns sections
 * that match, sorted by section number.
 */
export const searchSections = (
  sections: ReadonlyArray<DocSection>,
  query: string,
): DocSection[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [...sections];
  return sections.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.content.toLowerCase().includes(q),
  );
};

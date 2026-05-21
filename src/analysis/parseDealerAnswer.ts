/**
 * Parser for the structured dealer-mode AI answer.
 *
 * The LLM is instructed to produce a fixed format (see dealerPrompt.ts):
 *
 *   <one-line intro>
 *
 *   Das Problem hängt wahrscheinlich mit folgenden Ursachen zusammen:
 *   • <Ursache 1> ★★★★★
 *   • <Ursache 2> ★★★★☆
 *     ◦ <optional sub-bullet>
 *   …
 *
 *   Maßnahmen:
 *   • <step 1>
 *   • <step 2>
 *
 * The dealer view used to render this as preformatted text. We now parse the
 * structure so the answer can be displayed in the same card style as the
 * Brennbewertung "bad" state — title + bullet list with star ratings + sub
 * notes — which is what the customer-facing UI expects.
 *
 * The parser is intentionally forgiving: any deviation falls through to
 * `rawText` so we can still show the original answer rather than a blank.
 */

export interface DealerAnswerCause {
  text: string;
  /** 1..5 — number of filled stars. 0 if the model omitted them. */
  stars: number;
  /** Optional sub-bullets attached via "◦". */
  subItems: string[];
}

export interface ParsedDealerAnswer {
  intro: string;
  causes: DealerAnswerCause[];
  steps: string[];
  /** True if we got a structured answer worth rendering as cards. */
  isStructured: boolean;
  /** Raw answer — fallback when parsing fails. */
  rawText: string;
}

const STAR_FILLED = '★';
const BULLET_MAIN = /^[•·]\s+/;
const BULLET_SUB = /^[◦∘○]\s+/;
const STEPS_HEADING_RE = /^Maßnahmen:?$/i;

const stripStars = (line: string): { text: string; stars: number } => {
  // Find a trailing run of stars (filled and empty) and split it off.
  const match = line.match(/[★☆]+\s*$/);
  if (!match) return { text: line.trim(), stars: 0 };
  const trailing = match[0];
  const filled = (trailing.match(new RegExp(STAR_FILLED, 'g')) || []).length;
  const text = line.slice(0, match.index).trim();
  return { text, stars: filled };
};

export const parseDealerAnswer = (raw: string): ParsedDealerAnswer => {
  const result: ParsedDealerAnswer = {
    intro: '',
    causes: [],
    steps: [],
    isStructured: false,
    rawText: raw,
  };

  if (!raw || typeof raw !== 'string') return result;

  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  let mode: 'intro' | 'causes' | 'steps' = 'intro';
  let lastCause: DealerAnswerCause | null = null;
  const introLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;

    if (STEPS_HEADING_RE.test(line)) {
      mode = 'steps';
      continue;
    }

    // The "Das Problem hängt … zusammen:" header marks the start of the
    // causes list. Anything before it that's not a bullet is intro copy.
    if (/zusammen:?$/i.test(line) || /Ursachen.*:$/i.test(line)) {
      mode = 'causes';
      continue;
    }

    if (mode === 'steps' && BULLET_MAIN.test(line)) {
      result.steps.push(line.replace(BULLET_MAIN, '').trim());
      continue;
    }

    if (mode === 'causes') {
      if (BULLET_MAIN.test(line)) {
        const stripped = line.replace(BULLET_MAIN, '');
        const { text, stars } = stripStars(stripped);
        const cause: DealerAnswerCause = { text, stars, subItems: [] };
        result.causes.push(cause);
        lastCause = cause;
        continue;
      }
      if (BULLET_SUB.test(line) && lastCause) {
        lastCause.subItems.push(line.replace(BULLET_SUB, '').trim());
        continue;
      }
    }

    if (mode === 'intro') {
      introLines.push(line);
    }
  }

  result.intro = introLines.join(' ').trim();
  result.isStructured = result.causes.length > 0 || result.steps.length > 0;
  return result;
};

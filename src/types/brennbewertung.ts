/**
 * Brennbewertung — combustion-quality assessment exposed by the controller.
 *
 * The controller emits seven status variables C0..C6, each a percentage 0..100
 * indicating how strongly the named condition applies. When all of them are 0
 * the stove is burning correctly. When any is non-zero, the dealer view shows
 * the top three with star ratings and remediation guidance.
 *
 * Variables live under RTDB path `statistik_monat_tage/<deviceId>/c`.
 * Reference: 2026-04-28 specification by Claus-Peter Hamisch.
 */

export const BRENNBEWERTUNG_KEYS = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const;
export type BrennbewertungKey = typeof BRENNBEWERTUNG_KEYS[number];

export type BrennbewertungValues = Record<BrennbewertungKey, number>;

export interface BrennbewertungVariableInfo {
  /** Short headline shown as the bullet text, e.g. "Der Ofen erwärmt sich nur langsam". */
  title: string;
  /** Possible root causes ("Grund"). */
  grund: string[];
  /** Symptoms / consequences ("Auswirkungen"). Used by the AI prompt to match customer complaints. */
  auswirkungen: string[];
  /** Remediation steps ("Maßnahmen"). */
  massnahmen: string[];
}

export type BrennbewertungKnowledgeBase = Record<BrennbewertungKey, BrennbewertungVariableInfo>;

/** Source of the C-values currently displayed in the dealer view. */
export type BrennbewertungSource = 'firebase' | 'devOverride' | 'none';

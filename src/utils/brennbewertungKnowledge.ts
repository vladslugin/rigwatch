import type { BrennbewertungKnowledgeBase } from '../types/brennbewertung';

/**
 * Default Brennbewertung knowledge base (German), straight from the
 * 2026-04-28 specification by Claus-Peter Hamisch (HASE Kaminofenbau).
 *
 * Used as a) the initial seed when the Firestore document does not exist yet
 * and b) the fallback when Firestore is unreachable. Claus can override these
 * texts via the in-app editor; the editor writes back to Firestore and every
 * client picks up the change in real time.
 *
 * Audience: dealers (often older, non-technical). Wording stays plain and
 * action-oriented; do not add jargon when editing.
 */
export const DEFAULT_BRENNBEWERTUNG_KNOWLEDGE: BrennbewertungKnowledgeBase = {
  C0: {
    title: 'Der Ofen erwärmt sich nur langsam',
    grund: [
      'Holz zu feucht',
      'niedriger Kaminzug',
      'falscher Brennstoff',
    ],
    auswirkungen: [
      'Ofen kommt nicht auf Touren',
      'Ofen erwärmt sich langsam',
      'Ofen wird nicht warm',
      'Das Feuer kommt nicht in Gang',
      'Ofen brennt nicht richtig an',
      'Anzünden oder Aufheizen dauert zu lange',
      'Die schädlichen Emissionen sind zu hoch',
      'Die Effizienz ist niedrig',
      'Ofen brennt nicht schön, wenig Flamme',
      'Ofen qualmt, rußt, raucht',
      'Scheibenluft ist geöffnet',
      'Rückwandluft ist geschlossen',
    ],
    massnahmen: [
      'Feuchtigkeit des Holzes messen (Restfeuchte 14 – 20 %)',
      'Evtl. Drosselklappe im Schornstein oder der Zuluft öffnen',
      'Holzart und Aufgabemenge nach Bedienungsanleitung wählen',
    ],
  },
  C1: {
    title: 'Der Ofen brennt sehr stark',
    grund: [
      'Holz zu trocken',
      'Scheite zu dünn',
      'hoher Kaminzug',
    ],
    auswirkungen: [
      'Ofen brennt zu schnell',
      'Ofen brennt zu heiß',
      'Effizienz ist niedrig',
      'Die schädlichen Emissionen sind zu hoch',
      'Ofen brennt nicht schön, Schmiedefeuer, Feuer zu stark',
      'Rückwandluft ist geöffnet',
    ],
    massnahmen: [
      'Feuchtigkeit des Holzes messen (Restfeuchte 14 – 20 %)',
      'Evtl. Drosselklappe im Schornstein oder der Zuluft schließen',
      'Holzart und Aufgabemenge nach Bedienungsanleitung wählen',
    ],
  },
  C2: {
    title: 'Der Ofen brennt träge',
    grund: [
      'Scheite zu dick',
    ],
    auswirkungen: [
      'Ofen kommt nicht auf Touren',
      'Ofen erwärmt sich langsam',
      'Ofen wird nicht warm',
      'Das Feuer kommt nicht in Gang',
      'Ofen brennt nicht richtig an',
      'Anzünden oder Aufheizen dauert zu lange',
      'Ofen brennt zu lange',
      'Die schädlichen Emissionen sind zu hoch',
      'Ofen brennt nicht schön, wenig Flamme',
      'Ofen qualmt, rußt, raucht',
      'Scheibenluft ist geöffnet',
      'Rückwandluft ist geschlossen',
    ],
    massnahmen: [
      'Kleinere Scheite wählen',
      'Nicht nur ein Scheit auflegen',
    ],
  },
  C3: {
    title: 'Zu früh nachgelegt',
    grund: [
      'Zu früh nachgelegt',
    ],
    auswirkungen: [
      'Ofen raucht in den Aufstellraum',
      'Ofen raucht aus der Tür',
      'raucht, rußt, qualmt',
      'Die schädlichen Emissionen sind zu hoch',
      'Die Effizienz ist niedrig',
    ],
    massnahmen: [
      'Erst nachlegen, wenn keine Flammen mehr sichtbar sind',
    ],
  },
  C4: {
    title: 'Zu spät nachgelegt',
    grund: [
      'Zu spät nachgelegt',
    ],
    auswirkungen: [
      'Ofen kommt nicht auf Touren',
      'Ofen erwärmt sich langsam',
      'Ofen wird nicht warm',
      'Das Feuer kommt nicht in Gang',
      'Ofen brennt nicht richtig an',
      'Aufheizen dauert zu lange',
      'Die schädlichen Emissionen sind zu hoch',
      'Die Effizienz ist niedrig',
    ],
    massnahmen: [
      'Nachlegen, wenn keine Flammen mehr sichtbar sind',
      'Das Nachlegesignal wird mit zunehmender Dringlichkeit intensiver, die LED blinkt mit zunehmender Dringlichkeit öfter, wenn es ganz dringend ist, dann leuchtet die LED durchgehend',
      'Wenn das Nachlegesignal erloschen ist, dann mit kleinscheitigem Holz und evtl. Anzündern neu anzünden',
    ],
  },
  C5: {
    title: 'Der Ofen brennt verhalten an',
    grund: [
      'Holz zu feucht',
      'niedriger Kaminzug',
      'falscher Brennstoff',
    ],
    auswirkungen: [
      'Ofen kommt nicht auf Touren',
      'Ofen erwärmt sich langsam',
      'Ofen wird nicht warm',
      'Das Feuer kommt nicht in Gang',
      'Ofen brennt nicht richtig an',
      'Anzünden dauert zu lange',
      'Die schädlichen Emissionen sind zu hoch',
      'Die Effizienz ist niedrig',
      'Ofen brennt nicht schön, wenig Flamme',
      'Scheibenluft ist geöffnet',
      'Rückwandluft ist geschlossen',
    ],
    massnahmen: [
      'Mehr Kleinholz verwenden',
      'Mehr Anzünder (2-3) verwenden',
      'Richtigen Brennstoff verwenden, Bedienungsanleitung beachten',
    ],
  },
  C6: {
    title: 'Zu wenig Brennstoff',
    grund: [
      'Zu wenig Holz',
    ],
    auswirkungen: [
      'Ofen brennt zu kurz',
      'Die schädlichen Emissionen sind zu hoch',
      'Die Effizienz ist niedrig',
    ],
    massnahmen: [
      'Richtige Menge Brennstoff verwenden, Bedienungsanleitung beachten',
    ],
  },
};

/**
 * Star rating thresholds. A C-value of 0 hides the variable entirely; otherwise
 * it gets between 1 and 5 filled stars.
 */
export const starsForCValue = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 80) return 5;
  if (value >= 60) return 4;
  if (value >= 40) return 3;
  if (value >= 20) return 2;
  return 1;
};

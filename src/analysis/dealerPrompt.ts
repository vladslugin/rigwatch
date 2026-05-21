import type {
  BrennbewertungKey,
  BrennbewertungKnowledgeBase,
  BrennbewertungValues,
} from '../types/brennbewertung';
import {
  DEFAULT_DEALER_PROMPT_SETTINGS,
  DEFAULT_PERSONA_INSTRUCTION,
  DEFAULT_TASK_INSTRUCTION,
  type DealerPromptSettings,
} from '../types/dealerPromptSettings';

/**
 * Input for the dealer-mode AI assistant.
 *
 * Privacy contract — per Vladi's 2026-04-29 instruction the prompt MUST NOT
 * contain any data that ties the request to a specific stove or customer:
 *   - no device ID, no Seriennr, no Controller-SN
 *   - no customer name / e-mail / address
 *   - no firmware version, software ID, raw RTDB parameters
 *
 * What we do send:
 *   - the static C0–C6 knowledge base (definitions),
 *   - the current C-values (numbers only),
 *   - the dealer's free-text description of the customer's complaint,
 *   - optionally the model name (a public product label, e.g. "Lhasa") and
 *     decoded controller error labels (e.g. "Motor A hakt") — these are
 *     generic strings, not customer-specific identifiers.
 */
export interface DealerPromptInput {
  customerProblem: string;
  cValues: BrennbewertungValues;
  topThree: BrennbewertungKey[];
  knowledge: BrennbewertungKnowledgeBase;
  /** Decoded controller error labels, e.g. ["Motor A hakt"]. Empty when stove is healthy. */
  controllerErrors?: string[];
  /** Public model label like "Lhasa". NOT a serial. Optional. */
  modelName?: string;
  /** Globally-shared editor settings. Defaults are used when absent. */
  settings?: DealerPromptSettings;
}

/** Centralised model name so flipping to a newer Flash variant is one edit. */
export const DEALER_AI_MODEL = 'gemini-2.5-flash';

const formatKnowledge = (knowledge: BrennbewertungKnowledgeBase): string => {
  return (Object.keys(knowledge) as BrennbewertungKey[])
    .map((key) => {
      const info = knowledge[key];
      const grund = info.grund.map((g) => `  - ${g}`).join('\n');
      const auswirk = info.auswirkungen.map((a) => `  - ${a}`).join('\n');
      const massn = info.massnahmen.map((m) => `  - ${m}`).join('\n');
      return [
        `${key}: ${info.title}`,
        'Grund:',
        grund || '  (keine Angabe)',
        'Auswirkungen:',
        auswirk || '  (keine Angabe)',
        'Maßnahmen:',
        massn || '  (keine Angabe)',
      ].join('\n');
    })
    .join('\n\n');
};

const formatCurrentValues = (values: BrennbewertungValues, top: BrennbewertungKey[]): string => {
  const lines: string[] = [];
  for (const key of Object.keys(values) as BrennbewertungKey[]) {
    const v = values[key];
    const marker = top.includes(key) ? ' ← aktiv' : '';
    lines.push(`  ${key}: ${v}${marker}`);
  }
  return lines.join('\n');
};

const applyTaskPlaceholders = (
  text: string,
  causeMin: number,
  causeMax: number,
): string =>
  text
    .replace(/\{causeMin\}/g, String(causeMin))
    .replace(/\{causeMax\}/g, String(causeMax));

export const buildDealerPrompt = (input: DealerPromptInput): string => {
  const settings = input.settings ?? DEFAULT_DEALER_PROMPT_SETTINGS;
  const sections: string[] = [];

  const persona = settings.personaInstruction.trim() || DEFAULT_PERSONA_INSTRUCTION;
  sections.push(persona);

  sections.push(
    `Wissensbasis: Der Controller liefert sieben Zustandsvariablen C0..C6, jeweils 0 (nicht zutreffend) bis 100 (zutreffend). Bei gutem Betrieb sind alle 0.

${formatKnowledge(input.knowledge)}`,
  );

  sections.push(
    `Aktuelle C-Werte des Ofens (vom Controller gemeldet):
${formatCurrentValues(input.cValues, input.topThree)}`,
  );

  if (input.topThree.length > 0) {
    sections.push(
      `Die drei größten aktuell aktiven Variablen (in absteigender Reihenfolge): ${input.topThree
        .map((key) => `${key} = ${input.cValues[key]}`)
        .join(', ')}`,
    );
  } else {
    sections.push(`Keine Variable ist aktiv. Der Controller meldet einwandfreien Betrieb.`);
  }

  if (input.controllerErrors && input.controllerErrors.length > 0) {
    sections.push(
      `Zusätzlich meldet der Controller folgende technische Fehler:
${input.controllerErrors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  if (input.modelName) {
    sections.push(`Ofen-Modell: ${input.modelName}`);
  }

  sections.push(
    `Beschreibung des Kundenproblems (so wie es der Endkunde schildert):
${input.customerProblem.trim() || '(keine Beschreibung)'}`,
  );

  const taskTemplate = settings.taskInstruction.trim() || DEFAULT_TASK_INSTRUCTION;
  sections.push(applyTaskPlaceholders(taskTemplate, settings.causeMin, settings.causeMax));

  if (settings.maxWords > 0) {
    sections.push(
      `Längenvorgabe: Halte die gesamte Antwort kurz, möglichst unter ${settings.maxWords} Wörtern.`,
    );
  }

  const wishes = settings.additionalWishes.trim();
  if (wishes) {
    sections.push(`Zusätzliche Wünsche der Redaktion (immer beachten):
${wishes}`);
  }

  return sections.join('\n\n');
};

export const getDealerPromptFallback = (errorMessage?: string): string => {
  const prefix = errorMessage ? `(${errorMessage}) ` : '';
  return `${prefix}Die KI-Antwort konnte nicht erzeugt werden. Bitte prüfen Sie die Verbindung und versuchen Sie es erneut.`;
};

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
 * Input for the operator-mode AI assistant.
 *
 * Privacy contract — the prompt MUST NOT contain any data that ties the
 * request to a specific rig or wallet:
 *   - no rig ID, no controller serial, no MAC
 *   - no wallet address, owner name, or worker name
 *   - no firmware build hash, no raw RTDB parameters
 *
 * What we do send:
 *   - the static C0–C6 knowledge base (definitions),
 *   - the current C-values (numbers only),
 *   - the operator's free-text description of the issue,
 *   - optionally the model name (a public product label like "Antminer S21
 *     Pro") and decoded controller error labels (e.g. "Hashboard 2 dropped")
 *     — these are generic strings, not customer-specific identifiers.
 */
export interface DealerPromptInput {
  customerProblem: string;
  cValues: BrennbewertungValues;
  topThree: BrennbewertungKey[];
  knowledge: BrennbewertungKnowledgeBase;
  /** Decoded controller error labels, e.g. ["Hashboard 2 dropped"]. Empty when rig is healthy. */
  controllerErrors?: string[];
  /** Public model label like "Antminer S21 Pro". NOT a serial. Optional. */
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
        'Root causes:',
        grund || '  (none provided)',
        'Symptoms:',
        auswirk || '  (none provided)',
        'Remediations:',
        massn || '  (none provided)',
      ].join('\n');
    })
    .join('\n\n');
};

const formatCurrentValues = (values: BrennbewertungValues, top: BrennbewertungKey[]): string => {
  const lines: string[] = [];
  for (const key of Object.keys(values) as BrennbewertungKey[]) {
    const v = values[key];
    const marker = top.includes(key) ? ' ← active' : '';
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
    `Knowledge base: the controller reports seven health variables C0..C6 in the
range 0 (not applicable) to 100 (highly applicable). A healthy rig has all values at 0.

${formatKnowledge(input.knowledge)}`,
  );

  sections.push(
    `Current C-values from the controller:
${formatCurrentValues(input.cValues, input.topThree)}`,
  );

  if (input.topThree.length > 0) {
    sections.push(
      `The three highest currently-active variables (descending): ${input.topThree
        .map((key) => `${key} = ${input.cValues[key]}`)
        .join(', ')}`,
    );
  } else {
    sections.push(`No active variables. The controller reports normal operation.`);
  }

  if (input.controllerErrors && input.controllerErrors.length > 0) {
    sections.push(
      `The controller also reports the following technical errors:
${input.controllerErrors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  if (input.modelName) {
    sections.push(`Rig model: ${input.modelName}`);
  }

  sections.push(
    `Operator's description of the issue:
${input.customerProblem.trim() || '(no description provided)'}`,
  );

  const taskTemplate = settings.taskInstruction.trim() || DEFAULT_TASK_INSTRUCTION;
  sections.push(applyTaskPlaceholders(taskTemplate, settings.causeMin, settings.causeMax));

  if (settings.maxWords > 0) {
    sections.push(
      `Length limit: keep the full reply short, ideally below ${settings.maxWords} words.`,
    );
  }

  const wishes = settings.additionalWishes.trim();
  if (wishes) {
    sections.push(`Editorial preferences (always honour):
${wishes}`);
  }

  return sections.join('\n\n');
};

export const getDealerPromptFallback = (errorMessage?: string): string => {
  const prefix = errorMessage ? `(${errorMessage}) ` : '';
  return `${prefix}The AI response could not be generated. Verify the connection and try again.`;
};

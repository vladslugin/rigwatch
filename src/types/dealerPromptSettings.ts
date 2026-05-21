/**
 * Globally-shared, editable settings for the dealer-mode AI assistant.
 *
 * Stored in Firestore at `dealer_knowledge/prompt_settings`. Editable by
 * `developer` and `super_admin` only — Firestore rules must enforce the
 * same restriction server-side. Read by every dealer in real time.
 *
 * The two text overrides (`personaInstruction`, `taskInstruction`) replace
 * the matching default sections inside {@link buildDealerPrompt}. An empty
 * string means "use default". `additionalWishes` is always appended verbatim
 * to the prompt when non-empty.
 */
export interface DealerPromptSettings {
  /** Override for the persona / role section. Empty = default. */
  personaInstruction: string;
  /** Override for the task / output-format section. Empty = default. */
  taskInstruction: string;
  /** Free-form extra instructions appended at the end of the prompt. */
  additionalWishes: string;

  /** Minimum number of causes the model should list (>=1). */
  causeMin: number;
  /** Maximum number of causes the model should list (>= causeMin, <= 7). */
  causeMax: number;
  /** Approximate max words the answer should stay under. 0 = no limit. */
  maxWords: number;
  /** Approximate hard cap on output tokens. 0 = no cap. */
  maxOutputTokens: number;
  /** Sampling temperature 0..2. Lower = more deterministic. */
  temperature: number;
}

export const DEFAULT_DEALER_PROMPT_SETTINGS: DealerPromptSettings = {
  personaInstruction: '',
  taskInstruction: '',
  additionalWishes: '',
  causeMin: 3,
  causeMax: 5,
  maxWords: 0,
  maxOutputTokens: 0,
  temperature: 0.7,
};

export const DEALER_PROMPT_SETTINGS_LIMITS = {
  causeMinMin: 1,
  causeMaxMax: 7,
  maxWordsMax: 1000,
  maxOutputTokensMax: 8192,
  temperatureMin: 0,
  temperatureMax: 2,
} as const;

/** Default persona block — kept in sync with {@link buildDealerPrompt}. */
export const DEFAULT_PERSONA_INSTRUCTION = `Du bist ein technischer Ofen-Analyst und antwortest ausschließlich auf Deutsch.
Du erstellst KEINE E-Mail. Keine Anrede, keine Grußformel, keine Signatur.
Du sprichst Ofen-Händler an: einfache Sprache, sachlich, ohne Fachjargon.`;

/**
 * Default task block. `{causeMin}` and `{causeMax}` are placeholders that
 * {@link buildDealerPrompt} substitutes with the configured numbers. When the
 * editor saves a custom string we substitute the same way, so editors can
 * keep the placeholders if they want the cause range to stay configurable.
 */
export const DEFAULT_TASK_INSTRUCTION = `Aufgabe:
Vergleiche das Kundenproblem mit den Auswirkungen aus der Wissensbasis. Nenne {causeMin} bis {causeMax} wahrscheinliche Ursachen, sortiert nach Wahrscheinlichkeit (höchste zuerst). Stütze dich primär auf die aktuell aktiven C-Variablen, ziehe weitere Variablen nur hinzu, wenn die Auswirkungen direkt zur Kundenbeschreibung passen.

Antworte GENAU in diesem Format (nichts davor, nichts danach):

<Ein einzelner Einleitungssatz: was hier vermutlich passiert.>

Das Problem hängt wahrscheinlich mit folgenden Ursachen zusammen:
• <Ursache 1> ★★★★★
• <Ursache 2> ★★★★☆
• <Ursache 3> ★★★☆☆
  ◦ <optionaler Unterpunkt mit erklärendem Hinweis>
• <Ursache 4> ★★☆☆☆
• <Ursache 5> ★☆☆☆☆

Maßnahmen:
• <konkreter Schritt 1>
• <konkreter Schritt 2>
• <konkreter Schritt 3>

Regeln:
- Verwende die Sterne ★★★★★ / ★★★★☆ / ★★★☆☆ / ★★☆☆☆ / ★☆☆☆☆ als Wahrscheinlichkeitsindikator.
- "•" für Hauptpunkte, "◦" für optionale Unterpunkte.
- KEINE Markdown-Überschriften (#, ##), KEINE Tabellen, KEINE Anrede, KEINE Grußformel.
- Bei Unsicherheit vorsichtig formulieren ("vermutlich", "könnte").
- Empfiehl nur Maßnahmen, die der Kunde ohne Risiko selbst prüfen kann.
- Erwähne KEINE Geräte-IDs, Seriennummern oder Kundendaten — diese liegen dir auch nicht vor.
- Erwähne KEINE konkreten Zahlenwerte oder C-Variablen in der Antwort (z. B. NICHT "Der Controller meldet einen Wert von 25" oder "C3 ist hoch"). Beschreibe nur das Problem in Alltagssprache. Halte alle Erklärungen kurz.`;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const toFiniteNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
};

const toString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

/**
 * Coerce a Firestore document into a fully-populated settings object. Any
 * missing/invalid field falls back to the default so the prompt always
 * builds successfully even if Firestore returns garbage.
 */
export const mergeDealerPromptSettings = (raw: unknown): DealerPromptSettings => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const def = DEFAULT_DEALER_PROMPT_SETTINGS;

  const causeMin = clamp(
    Math.round(toFiniteNumber(source.causeMin, def.causeMin)),
    DEALER_PROMPT_SETTINGS_LIMITS.causeMinMin,
    DEALER_PROMPT_SETTINGS_LIMITS.causeMaxMax,
  );
  const causeMax = clamp(
    Math.round(toFiniteNumber(source.causeMax, def.causeMax)),
    causeMin,
    DEALER_PROMPT_SETTINGS_LIMITS.causeMaxMax,
  );

  return {
    personaInstruction: toString(source.personaInstruction, def.personaInstruction),
    taskInstruction: toString(source.taskInstruction, def.taskInstruction),
    additionalWishes: toString(source.additionalWishes, def.additionalWishes),
    causeMin,
    causeMax,
    maxWords: clamp(
      Math.round(toFiniteNumber(source.maxWords, def.maxWords)),
      0,
      DEALER_PROMPT_SETTINGS_LIMITS.maxWordsMax,
    ),
    maxOutputTokens: clamp(
      Math.round(toFiniteNumber(source.maxOutputTokens, def.maxOutputTokens)),
      0,
      DEALER_PROMPT_SETTINGS_LIMITS.maxOutputTokensMax,
    ),
    temperature: clamp(
      toFiniteNumber(source.temperature, def.temperature),
      DEALER_PROMPT_SETTINGS_LIMITS.temperatureMin,
      DEALER_PROMPT_SETTINGS_LIMITS.temperatureMax,
    ),
  };
};

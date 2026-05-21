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
export const DEFAULT_PERSONA_INSTRUCTION = `You are a mining operations engineer assistant. You triage rig health from
controller telemetry and short operator descriptions.
You do NOT compose emails. No greeting, no sign-off, no signatures.
You address rig operators directly: plain language, factual, minimal jargon,
no marketing fluff.`;

/**
 * Default task block. `{causeMin}` and `{causeMax}` are placeholders that
 * {@link buildDealerPrompt} substitutes with the configured numbers. When the
 * editor saves a custom string we substitute the same way, so editors can
 * keep the placeholders if they want the cause range to stay configurable.
 */
export const DEFAULT_TASK_INSTRUCTION = `Task:
Match the operator's description against the symptoms in the knowledge base.
List {causeMin} to {causeMax} likely root causes, sorted by probability
(highest first). Lean primarily on the currently active C variables; only pull
in other variables when their symptoms directly match the operator's note.

Reply EXACTLY in this format (nothing before, nothing after):

<One sentence summarising what is most likely happening.>

Likely root causes:
• <Cause 1> ★★★★★
• <Cause 2> ★★★★☆
• <Cause 3> ★★★☆☆
  ◦ <optional sub-bullet with a clarifying note>
• <Cause 4> ★★☆☆☆
• <Cause 5> ★☆☆☆☆

Next steps:
• <concrete step 1>
• <concrete step 2>
• <concrete step 3>

Rules:
- Use the star glyphs ★★★★★ / ★★★★☆ / ★★★☆☆ / ★★☆☆☆ / ★☆☆☆☆ as the probability indicator.
- "•" for main bullets, "◦" for optional sub-bullets.
- NO markdown headers (#, ##), NO tables, NO greetings, NO sign-offs.
- When uncertain, hedge ("likely", "could be").
- Only recommend steps the operator can safely perform without risking hardware.
- Do NOT mention rig IDs, serial numbers, or wallet addresses — they are not provided to you.
- Do NOT mention concrete numeric values or C-variable names in the reply
  (e.g. NOT "controller reports 25" or "C3 is high"). Describe the issue in
  everyday operator language. Keep every explanation short.`;

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

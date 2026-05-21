import type { NormalizedOutput } from './normalize';
import paramDictionary from './paramDictionary.json';

export interface PromptOptions {
  locale?: 'de' | 'en';
  sendPII?: boolean;
}

// Error code definitions for AI context
const ERROR_DEFINITIONS = {
  E: [
    { bit: 0, description: 'Motor A hakt' },
    { bit: 1, description: 'Motor A dreht durch' },
    { bit: 3, description: 'Motor B hakt' },
    { bit: 4, description: 'Motor B dreht durch' },
    { bit: 6, description: 'Temperatursensor defekt' },
  ],
  E2: [
    { bit: 2, description: 'Motor A kein Strom' },
    { bit: 5, description: 'Motor B kein Strom' },
  ]
};

const decodeErrorCodes = (ecode?: number, ecode2?: number, E?: number, E2?: number): string[] => {
  const descriptions: string[] = [];

  const useE = typeof E === 'number' && E > 0;
  const useE2 = typeof E2 === 'number' && E2 > 0;

  if (useE) {
    ERROR_DEFINITIONS.E.forEach(({ bit, description }) => {
      if ((E! & (1 << bit)) !== 0) {
        descriptions.push(`E${bit}: ${description}`);
      }
    });
  } else if (ecode !== undefined && ecode > 0) {
    ERROR_DEFINITIONS.E.forEach(({ bit, description }) => {
      if ((ecode & (1 << bit)) !== 0) {
        descriptions.push(`E${bit}: ${description}`);
      }
    });
  }

  if (useE2) {
    ERROR_DEFINITIONS.E2.forEach(({ bit, description }) => {
      if ((E2! & (1 << bit)) !== 0) {
        descriptions.push(`E2${bit}: ${description}`);
      }
    });
  } else if (ecode2 !== undefined && ecode2 > 0) {
    ERROR_DEFINITIONS.E2.forEach(({ bit, description }) => {
      if ((ecode2 & (1 << bit)) !== 0) {
        descriptions.push(`E2${bit}: ${description}`);
      }
    });
  }

  return descriptions;
};

const hashIfPII = (_key: string, value: any, sendPII: boolean | undefined) => {
  if (sendPII) return value;
  // Removed IP hashing as IP addresses are no longer included in prompts
  return value;
};

export const buildPrompt = (
  normalized: NormalizedOutput,
  ui: {
    status: 'online'|'offline'|'unknown';
    pingOkRatio?: number;
  },
  options: PromptOptions = {}
) => {
  const { params } = normalized;
  const locale = options.locale || 'en';
  const sendPII = options.sendPII === true;

  // Decode error codes for better context
  const ecode = normalized.params.ecode as number | undefined;
  const ecode2 = normalized.params.ecode2 as number | undefined;
  const E = normalized.params.E as number | undefined;
  const E2 = normalized.params.E2 as number | undefined;
  const decodedErrors = decodeErrorCodes(ecode, ecode2, E, E2);

  const bitList = (n?: number) => {
    if (typeof n !== 'number' || n <= 0) return 'none';
    const bits: number[] = [];
    for (let b = 0; b < 31; b++) if ((n & (1 << b)) !== 0) bits.push(b);
    return bits.join(',');
  };

  const knownLines: string[] = [];
  const unknownLines: string[] = [];
  Object.entries(params).forEach(([k, v]) => {
    const isKnown = k in paramDictionary;
    const val = hashIfPII(k, v, sendPII);
    // Special-case: TC raw is centi-degrees; include scaled value for clarity
    const line = (k === 'TC' && typeof v === 'number')
      ? `TC = ${Number(v) / 100} (raw:${v})`
      : `${k} = ${val}`;
    (isKnown ? knownLines : unknownLines).push(line);
  });

  const instruction = `System: You are an experienced rig diagnostic expert. Analyze the provided data carefully and provide helpful insights while being conservative with destructive actions.

Rig Context:
- Locale: ${locale}
- Connection: ${ui.status}${typeof ui.pingOkRatio === 'number' ? `, network reliability ${Math.round(ui.pingOkRatio * 100)}%` : ''}

Sensor Data (normalized):
${knownLines.join('\n')}

Key derived signals:
${typeof (normalized.features as any).controllerTemperature === 'number' ? `controllerTemperature = ${(normalized.features as any).controllerTemperature}°C (from TC/100)` : 'controllerTemperature: n/a'}
Error Codes Decoded:
${decodedErrors.length > 0 ? decodedErrors.join('\n') : 'No active error codes detected'}

Raw error code bits (for transparency):
ecode bits: ${bitList(ecode)}
ecode2 bits: ${bitList(ecode2)}
E bits: ${bitList(E)}
E2 bits: ${bitList(E2)}

Analysis Guidelines:
1. Consider temperature patterns, error codes, burner performance, door status, wood levels
2. Look for correlations between different parameters
3. Consider controller status and network connectivity:
   - Controller change (original!=current): Usually normal maintenance/upgrade - low priority unless causing issues
   - Controller missing (current=Unknown/null): Critical pairing issue - high priority
4. Factor in firmware version and update status
5. Check for unusual patterns in operational counters
6. PRIORITIZE these app variables and their meanings:
   - T: combustion chamber temperature; TQUER: average temperature; TC: controller temperature (TC/100)
   - PL: window air opening %; SL: rear wall air opening %
   - O2: calculated oxygen content in combustion chamber
   - MLANG: temperature slope over 30s
   - E: error code (bitfield 2^bit); N: wood refuel status (0..7)
   - F: burn phase (0=Aus, 1=Anheizen, 2=Abbrand, 3=Nachlegen, 4=Aufheizen)
   - P: performance in %
7. If TC (controller temperature) > 38°C, consider controller overheat risk.
8. Use N (Nachlegedringlichkeit, 0..7) to assess wood refuel urgency; higher N => higher need to add wood.
9. Temperature ranges: Normal rig combustion is 450-620°C. Only flag T > 650°C as problematic overtemperature.
10. For error codes (E0, E1, etc.), state the issue directly without speculation. E0 means "Motor A hakt" - don't add "vermutlich" or guesses.
11. Check connection status: if device is offline or has poor ping, mention connectivity issues.
12. Parameter glossary (do not reinterpret): c=connection check ping flag; v=firmware update available; f=update progress (%); F=burn phase; a=article number (model variant).
13. Be concise: keep summary <= 140 characters, return at most 2 hypotheses and at most 3 actions. Keep "why" items short.

Provide diagnosis in STRICT JSON format:
{"summary": "Brief analysis summary in ${locale === 'de' ? 'German' : 'English'}", "urgency": "low|medium|high", "confidence": 0..1,
 "hypotheses": [{"issue":"specific problem description","probability":0..1,"why":["parameter evidence"]}],
 "actions": [{"action":"specific action to take","type":"self|support","eta_min":number|null}],
 "used_signals": ["list of analyzed parameters"] }
`;

  return instruction;
};



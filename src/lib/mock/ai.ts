/**
 * Mock for `firebase/ai`. Returns a stub generative model that resolves
 * with a canned response. Phase 6 will swap this for a real Gemini Flash
 * client (user has a free-tier key) — keeping the shape compatible.
 */

export interface GenerativeModel {
  generateContent: (input: string | any[]) => Promise<{
    response: {
      text: () => string;
      candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
  }>;
}

export const getAI = (_app?: any, _opts?: any): { __mock: true } => ({ __mock: true });

export const GoogleAIBackend = class GoogleAIBackendStub {
  constructor(_opts?: any) {}
};

const CANNED = [
  'Hashrate is within ±2% of nominal; share rejection rate <0.5% — operating envelope normal.',
  'Hashboard 2 temperature is creeping above the nominal envelope. Check airflow and consider derating the clock by 5–8%.',
  'Power efficiency is degraded compared to the fleet baseline. Verify firmware version and ambient intake temperature.',
];

export const getGenerativeModel = (_ai: any, _opts?: any): GenerativeModel => ({
  generateContent: async (input: string | any[]) => {
    // Pick a canned reply that loosely matches the prompt to feel less random.
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const idx = text.toLowerCase().includes('therm') || text.toLowerCase().includes('temp')
      ? 1
      : text.toLowerCase().includes('power') || text.toLowerCase().includes('efficien')
      ? 2
      : 0;
    await new Promise((r) => setTimeout(r, 400));
    return {
      response: {
        text: () => CANNED[idx],
        candidates: [{ content: { parts: [{ text: CANNED[idx] }] } }],
      },
    };
  },
});

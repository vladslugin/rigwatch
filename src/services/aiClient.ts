import { normalize, type NormalizeInput } from '../analysis/normalize';
import { runRules } from '../analysis/rules';
import { buildPrompt } from '../analysis/prompt';

export interface AIResult {
  summary: string;
  urgency: 'low'|'medium'|'high';
  confidence: number;
  hypotheses: { issue: string; probability: number; why: string[] }[];
  actions: { action: string; type: 'self'|'support'; eta_min: number | null }[];
  used_signals: string[];
  source: 'llm' | 'rules' | 'hybrid';
}

export interface AnalyzeInput extends NormalizeInput {
  deviceId: string;
}

const cache = new Map<string, { at: number; value: AIResult }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // Reduce cache time to 2 minutes

const hashKey = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
};

export const analyzeRig = async (input: AnalyzeInput, options?: { regenerate?: boolean; sendPII?: boolean }): Promise<AIResult> => {
  const normalized = normalize({ app: input.app || {}, core: input.core || {}, ui: input.ui });
  const rules = runRules(normalized.features as any, normalized.signals);

  const uiSign = JSON.stringify({
    status: input.ui.status,
    lastSeen: input.ui.lastSeen,
    originalController: input.ui.originalController,
    currentController: input.ui.currentController
  });
  // Include more context in cache key to ensure unique results
  const cacheContext = {
    params: normalized.params,
    ui: uiSign,
    timestamp: Math.floor(Date.now() / (5 * 60 * 1000)) // Change every 5 minutes
  };
  const key = hashKey(input.deviceId + JSON.stringify(cacheContext));

  if (!options?.regenerate) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
      return entry.value;
    }
  }

  const prompt = buildPrompt(normalized, {
    status: input.ui.status,
    lastSeen: input.ui.lastSeen,
    originalController: input.ui.originalController,
    currentController: input.ui.currentController,
    modelName: input.ui.modelName,
    article: input.ui.article,
    firmware: input.ui.firmware,
    sw: input.ui.sw,
    pingOkRatio: (normalized.features as any).pingOkRatio as number | undefined,
  }, { locale: input.ui.locale || 'en', sendPII: options?.sendPII });

  // Call server proxy with timeout
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error('Bad response');
    const json = await res.json();
    const result: AIResult = { ...json, source: 'llm' } as AIResult;

    // Hybrid merge: always include rule hints if LLM confidence < 0.75
    let merged: AIResult = result;
    if ((result.confidence ?? 0) < 0.75) {
      merged = {
        summary: result.summary || rules.summary,
        urgency: result.urgency || rules.urgency,
        confidence: Math.max(result.confidence || 0, rules.confidence),
        hypotheses: [...(result.hypotheses || []), ...rules.hypotheses].slice(0, 3),
        actions: [...(result.actions || []), ...rules.actions],
        used_signals: Array.from(new Set([...(result.used_signals || []), ...rules.used_signals])),
        source: 'hybrid'
      };
    }

    cache.set(key, { at: Date.now(), value: merged });
    return merged;
  } catch (e) {
    clearTimeout(t);
    const fallback: AIResult = { ...rules, source: 'rules' } as AIResult;
    cache.set(key, { at: Date.now(), value: fallback });
    return fallback;
  }
};



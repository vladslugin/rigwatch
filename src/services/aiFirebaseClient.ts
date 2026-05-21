/*
  Firebase AI Logic backend client for Gemini via firebase/ai.
  Requires:
  - Firebase console: enable AI Logic + Gemini Developer API for the project
  - SDK that includes `firebase/ai` module
*/

import app from '../lib/firebase';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
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

export const analyzeStoveWithFirebase = async (
  input: AnalyzeInput,
  options?: { regenerate?: boolean; sendPII?: boolean; model?: string; locale?: 'de' | 'en' }
): Promise<AIResult> => {
  console.log('🤖 Starting AI analysis with Firebase...');
  const normalized = normalize({ app: input.app || {}, core: input.core || {}, ui: input.ui });
  const rules = runRules(normalized.features as any, normalized.signals, normalized.params, options?.locale || 'en');

  const prompt = buildPrompt(
    normalized,
    {
      status: input.ui.status,
      lastSeen: input.ui.lastSeen,
      originalController: input.ui.originalController,
      currentController: input.ui.currentController,
      modelName: input.ui.modelName,
      article: input.ui.article,
      firmware: input.ui.firmware,
      sw: input.ui.sw,
      pingOkRatio: (normalized.features as any).pingOkRatio as number | undefined,
    },
    { locale: (options?.locale || input.ui.locale === 'de' ? 'de' : 'en') as 'de' | 'en', sendPII: options?.sendPII }
  );

  console.log('🧠 Creating AI model instance...');
  if (!app) throw new Error('Firebase app not initialized');
  const ai = getAI(app!, { backend: new GoogleAIBackend() });
  const modelName = options?.model || 'gemini-2.5-flash';
  console.log('📋 Using model:', modelName);
  const model = getGenerativeModel(ai, { model: modelName });

  // Request
  console.log('🚀 Sending prompt to AI model...');
  console.log('📝 Prompt preview:', prompt.substring(0, 200) + '...');
  
  const result = await model.generateContent(prompt);
  console.log('🤖 Received AI response:', result);
  
  const response = (result as any).response;
  const text: string = typeof response?.text === 'function' ? response.text() : (response?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join(' ').trim() || '');
  console.log('📄 Extracted text:', text.substring(0, 200) + '...');

  const extractJson = (s: string) => {
    try { return JSON.parse(s); } catch {}
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const sub = s.slice(start, end + 1);
      try { return JSON.parse(sub); } catch {}
    }
    return null;
  };

  const parsed = extractJson(text) || {};
  const base: AIResult = {
    summary: parsed.summary || rules.summary,
    urgency: parsed.urgency || rules.urgency,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.6,
    hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [],
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    used_signals: Array.isArray(parsed.used_signals) ? parsed.used_signals : [],
    source: 'llm',
    rawResponse: text  // Keep the original AI response
  } as any;

  // Merge with rules if confidence low
  if ((base.confidence ?? 0) < 0.75) {
    return {
      summary: base.summary || rules.summary,
      urgency: base.urgency || rules.urgency,
      confidence: Math.max(base.confidence || 0, rules.confidence),
      hypotheses: [...(base.hypotheses || []), ...rules.hypotheses].slice(0, 3),
      actions: [...(base.actions || []), ...rules.actions],
      used_signals: Array.from(new Set([...(base.used_signals || []), ...rules.used_signals])),
      source: 'hybrid',
      rawResponse: text  // Keep the original AI response
    } as any;
  }

  return base;
};



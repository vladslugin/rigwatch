import app from '../lib/firebase';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import {
  buildDealerPrompt,
  getDealerPromptFallback,
  DEALER_AI_MODEL,
  type DealerPromptInput,
} from '../analysis/dealerPrompt';

export interface DealerAssistantResult {
  answer: string;
  prompt: string;
  source: 'llm' | 'fallback';
}

export const askDealerAssistant = async (
  input: DealerPromptInput,
  options?: { model?: string }
): Promise<DealerAssistantResult> => {
  const prompt = buildDealerPrompt(input);

  const generationConfig: { temperature?: number; maxOutputTokens?: number } = {};
  if (input.settings) {
    generationConfig.temperature = input.settings.temperature;
    if (input.settings.maxOutputTokens > 0) {
      generationConfig.maxOutputTokens = input.settings.maxOutputTokens;
    }
  }

  try {
    if (!app) throw new Error('Firebase app not initialized');
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, {
      model: options?.model || DEALER_AI_MODEL,
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    });

    const result = await model.generateContent(prompt);
    const response = (result as any).response;
    const text =
      typeof response?.text === 'function'
        ? response.text()
        : response?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('\n').trim() || '';

    if (!text) {
      return {
        answer: getDealerPromptFallback('Leere KI-Antwort'),
        prompt,
        source: 'fallback',
      };
    }

    return {
      answer: text,
      prompt,
      source: 'llm',
    };
  } catch (error) {
    return {
      answer: getDealerPromptFallback(error instanceof Error ? error.message : 'Unbekannter Fehler'),
      prompt,
      source: 'fallback',
    };
  }
};

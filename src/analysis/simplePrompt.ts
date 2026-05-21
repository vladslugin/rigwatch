/**
 * Simple AI prompts for simplified user interface mode
 * Designed for non-technical users who need quick, understandable insights
 */

export interface SimpleAnalysisData {
  // Realtime data
  realtimeParams?: Record<string, any>;
  realtimeErrors?: string[];
  connectionStatus?: 'connected' | 'disconnected' | 'unknown';
  
  // Historical data
  historicalStats?: Record<string, any>;
  historicalPeriod?: string;
  historicalDate?: string;
  
  // Common
  locale: string;
  deviceId?: string;
}

/**
 * Generate a simplified AI prompt for both realtime and historical analysis
 * Returns human-friendly insights without technical jargon
 */
export const getSimpleAIPrompt = (data: SimpleAnalysisData): string => {
  const hasRealtime = data.realtimeParams && Object.keys(data.realtimeParams).length > 0;
  const hasHistorical = data.historicalStats && Object.keys(data.historicalStats).length > 0;
  
  return `Du bist ein Kaminofen-Experte und hilfst Nutzern dabei, ihren Kaminofen zu verstehen.
Antworte in einfacher, verständlicher Sprache ohne technische Begriffe.

WICHTIG: Antworte ausschließlich in ${data.locale === 'de' ? 'Deutsch' : 'Englisch'}.

${hasRealtime ? `
=== AKTUELLE KAMINOFEN-DATEN ===
${JSON.stringify(data.realtimeParams, null, 2)}

Verbindungsstatus: ${data.connectionStatus || 'unbekannt'}
${data.realtimeErrors?.length ? `Aktuelle Probleme: ${data.realtimeErrors.join(', ')}` : ''}
` : ''}

${hasHistorical ? `
=== VERLAUFSDATEN (${data.historicalPeriod}: ${data.historicalDate}) ===
${JSON.stringify(data.historicalStats, null, 2)}
` : ''}

Analysiere die verfügbaren Daten und gib eine einfache, verständliche Einschätzung ab:

1. KURZE ZUSAMMENFASSUNG (max. 2 Sätze):
   ${hasRealtime ? '- Aktueller Zustand: Beschreibe kurz, was gerade mit dem Kaminofen passiert.' : ''}
   ${hasHistorical ? '- Verlauf: Beschreibe kurz, wie der Kaminofen im gewählten Zeitraum funktioniert hat.' : ''}

2. HAUPTPROBLEME (falls vorhanden, max. 3 Probleme):
   - Liste nur Probleme auf, ohne Lösungen oder Ratschläge

ANTWORT-FORMAT (STRIKTES JSON):
{
  "realtime_summary": "Kurze Zusammenfassung der aktuellen Situation (leer lassen wenn keine Echtzeitdaten)",
  "historical_summary": "Kurze Zusammenfassung des Verlaufs (leer lassen wenn keine Verlaufsdaten)", 
  "main_issues": ["Beschreibung des Problems in einfachen Worten"],
  "urgency": "low|medium|high",
  "confidence": 0.7
}

Verwende keine Fachbegriffe wie "Performance", "B-Codes", "Fuzzy-Logic" etc.
Erkläre alles so, als würdest du mit jemandem sprechen, der zum ersten Mal einen Kamin benutzt.`;
};

/**
 * Default simple analysis result structure
 */
export interface SimpleAnalysisResult {
  realtime_summary: string;
  historical_summary: string;
  main_issues: string[]; // List only problems, no solutions
  urgency: 'low' | 'medium' | 'high';
  confidence: number;
  source: 'simple_ai';
  rawResponse?: string;
}

/**
 * Fallback analysis when AI is not available
 */
export const getFallbackSimpleAnalysis = (data: SimpleAnalysisData): SimpleAnalysisResult => {
  const hasRealtime = data.realtimeParams && Object.keys(data.realtimeParams).length > 0;
  const hasHistorical = data.historicalStats && Object.keys(data.historicalStats).length > 0;
  
  return {
    realtime_summary: hasRealtime ? "Kaminofen-Daten werden analysiert..." : "",
    historical_summary: hasHistorical ? "Verlaufsdaten werden ausgewertet..." : "",
    main_issues: [],
    urgency: 'low',
    confidence: 0.5,
    source: 'simple_ai'
  };
};

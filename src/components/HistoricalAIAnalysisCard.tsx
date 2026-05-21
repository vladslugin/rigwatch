import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStoveStore } from '../store/useStoveStore';
import { useAuth } from '../hooks/useAuth';
import { runHistoricalRules, type HistoricalRuleResult, type HistoricalData } from '../analysis/historicalRules.ts';
import type { AIResult } from '../services/aiClient';
import FuzzyMembershipVisualizer from './FuzzyMembershipVisualizer';
import { useFuzzyConfigs } from '../hooks/useFuzzyConfigs';

// Add CSS styles for mathematical fractions
const mathStyles = `
  .math-formula .frac {
    display: inline-block;
    vertical-align: middle;
    text-align: center;
    margin: 0 4px;
  }
  .math-formula .frac .num {
    display: block;
    border-bottom: 1px solid currentColor;
    padding-bottom: 2px;
    font-size: 0.9em;
  }
  .math-formula .frac .den {
    display: block;
    padding-top: 2px;
    font-size: 0.9em;
  }
`;

// Inject styles into head if not already present
if (typeof document !== 'undefined' && !document.getElementById('math-styles')) {
  const style = document.createElement('style');
  style.id = 'math-styles';
  style.textContent = mathStyles;
  document.head.appendChild(style);
}
// Optional KaTeX rendering if available (from window.katex). Falls back to plain LaTeX text.
const renderLatexHTML = (latex: string): string => {
  try {
    const k = (window as any).katex;
    if (k && typeof k.renderToString === 'function') {
      return k.renderToString(latex, { throwOnError: false, displayMode: true });
    }
  } catch {}
  const esc = latex.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `\\[ ${esc} \\]`;
};

interface HistoricalAIAnalysisCardProps {
  className?: string;
}

interface StatisticsData {
  anz_be?: number; // Anzahl Brennereignisse (number of burn events)
  anz_a?: number; // Anzahl Abbränder (number of burn-downs)
  anz_bt?: number; // Anzahl Brenntage (number of burning days)
  anz_s?: number; // Brenndauer in s (total burn duration, s)
  e?: number; // Erzeugte Energie in kWh × 100
  erster?: number; // Erstes Brennereignis (Unix epoch)
  h?: number; // Verbrauch Holz in kg × 100
  letzter?: number; // Letztes Brennereignis (Unix epoch)
  o?: number; // Äquivalent Heizöl in l × 100
  p?: number; // Gesamtperformance in %
  p_ph1?: number; // Performance Anheizen (ignition) in %
  p_ph2?: number; // Performance Abbrand (main burn) in %
  p_ph3?: number; // Performance Nachlegen (refueling) in %
  p_ph4?: number; // Performance Aufheizen nach dem Nachlegen (re-heating) in %
  t?: number; // Durchschnittstemperatur in °C
  z_ph1?: number; // Zeit Anheizen (ignition) in s
  z_ph2?: number; // Zeit Abbrand (main burn) in s
  z_ph3?: number; // Zeit Nachlegen (refueling action) in s
  z_ph4?: number; // Zeit Aufheizen nach dem Nachlegen in s
  wt0?: number; // Sunday burn events
  wt1?: number; // Monday burn events
  wt2?: number; // Tuesday burn events
  wt3?: number; // Wednesday burn events
  wt4?: number; // Thursday burn events
  wt5?: number; // Friday burn events
  wt6?: number; // Saturday burn events
}

const HistoricalAIAnalysisCard: React.FC<HistoricalAIAnalysisCardProps> = ({ className = '' }) => {
  const { t, i18n } = useTranslation();
  const deviceId = useStoveStore(state => state.deviceId);
  const { user } = useAuth();
  const { configs, getFunctionPoints } = useFuzzyConfigs();

  const [result, setResult] = useState<HistoricalRuleResult | AIResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [timePeriod, setTimePeriod] = useState<'daily' | 'monthly' | 'yearly'>('monthly');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [historicalData, setHistoricalData] = useState<HistoricalData | null>(null);
  const [loadingDates, setLoadingDates] = useState(false);
  const [analysisSource, setAnalysisSource] = useState<'ai' | 'rules'>('rules');
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<string>('');
  const [lastCalculations, setLastCalculations] = useState<string>('');
  const [lastPseudocode, setLastPseudocode] = useState<string>('');
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [showCalculationsModal, setShowCalculationsModal] = useState(false);
  const [showPseudocodeModal, setShowPseudocodeModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [showActionsDropdown, setShowActionsDropdown] = useState(false);
  const [showFuzzyVisualizer, setShowFuzzyVisualizer] = useState(false);
  const [visualBCodes, setVisualBCodes] = useState<Array<{ code: string; value: number }>>([]);
  const [normalizedDataState, setNormalizedDataState] = useState<any>(null);

  // KaTeX lazy loader to properly render LaTeX in visualizations
  const [katexReady, setKatexReady] = useState(false);
  useEffect(() => {
    try {
      const w: any = window as any;
      if (w.katex) {
        setKatexReady(true);
        return;
      }
      // Inject KaTeX CSS
      if (!document.getElementById('katex-css')) {
        const link = document.createElement('link');
        link.id = 'katex-css';
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
        document.head.appendChild(link);
      }
      // Inject KaTeX script
      if (!document.getElementById('katex-js')) {
        const script = document.createElement('script');
        script.id = 'katex-js';
        script.defer = true;
        script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
        script.onload = () => setKatexReady(true);
        document.body.appendChild(script);
      } else {
        setKatexReady(true);
      }
    } catch {
      // Non-fatal; fallback rendering will be used
    }
  }, []);

  // Persist/restore analysis and state across modal close/open
  const storageKey = deviceId ? `historicalAnalysis:${deviceId}` : null;
  
  const saveState = (data: { 
    result?: HistoricalRuleResult | AIResult | null;
    timePeriod: 'daily' | 'monthly' | 'yearly';
    selectedDate: string;
    lastPrompt?: string;
    lastResponse?: string;
    lastCalculations?: string;
    lastPseudocode?: string;
    analysisSource: 'ai' | 'rules';
    customPrompt?: string;
  }) => {
    try {
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {}
  };
  
  const loadState = () => {
    try {
      if (!storageKey) return null;
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  // Hydrate state on mount, then respond to timePeriod changes only after hydration
  useEffect(() => {
    if (deviceId && !hasHydrated) {
      const saved = loadState();
      if (saved) {
        setResult(saved.result || null);
        setTimePeriod(saved.timePeriod || 'monthly');
        setSelectedDate(saved.selectedDate || '');
        setLastPrompt(saved.lastPrompt || '');
        setLastResponse(saved.lastResponse || '');
        setLastCalculations(saved.lastCalculations || '');
        setLastPseudocode(saved.lastPseudocode || '');
        setAnalysisSource(saved.analysisSource || 'rules');
        setCustomPrompt(saved.customPrompt || '');
        setHasHydrated(true);
        return;
      }
      setHasHydrated(true);
    }
  }, [deviceId, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated) return;
    // If no selectedDate yet, initialize based on timePeriod
    if (!selectedDate) {
    const now = new Date();
      let newDate = '';
    if (timePeriod === 'yearly') {
        newDate = now.getFullYear().toString();
    } else if (timePeriod === 'monthly') {
        newDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    } else {
        newDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      }
      setSelectedDate(newDate);
      saveState({
        result,
        timePeriod,
        selectedDate: newDate,
        lastPrompt,
        lastResponse,
        lastCalculations,
        lastPseudocode,
        analysisSource,
        customPrompt
      });
    } else {
      // Persist changes to period/date
      saveState({
        result,
        timePeriod,
        selectedDate,
        lastPrompt,
        lastResponse,
        lastCalculations,
        lastPseudocode,
        analysisSource,
        customPrompt
      });
    }
  }, [timePeriod, selectedDate, hasHydrated]);

  // Specialized AI analysis function for historical data
  const analyzeHistoricalDataWithAI = async (prompt: string): Promise<AIResult> => {
    try {
      const firebase = await import('../lib/firebase');
      const app = firebase.default;
      if (!app) throw new Error('Firebase not initialized');
      
      const { getAI, getGenerativeModel, GoogleAIBackend } = await import('firebase/ai');
      
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      const model = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
      
      const result = await model.generateContent(prompt);
      const response = (result as any).response;
      const text: string = typeof response?.text === 'function' ? response.text() : 
        (response?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join(' ').trim() || '');
      
      // Extract JSON from response
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
      
      const aiResult: AIResult = {
        summary: parsed.summary || 'AI analysis completed',
        urgency: parsed.urgency || 'low',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
        hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        used_signals: Array.isArray(parsed.used_signals) ? parsed.used_signals : ['historical_data'],
        source: 'llm',
        rawResponse: text
      } as any;
      
      return aiResult;
      
    } catch (error) {
      console.error('[HistoricalAI] AI analysis failed:', error);
      throw error;
    }
  };

  const getDefaultHistoricalPrompt = (): string => {
    return `Du bist ein Experte für Kamintechnik und analysierst ausschließlich historische Verbrennungsdaten und Fuzzy-Rules-Ergebnisse.

WICHTIG: Du analysierst NUR historische Daten über einen vergangenen Zeitraum. Dies sind keine Echtzeitdaten und der Kamin ist möglicherweise gerade nicht in Betrieb.

=== DATENVARIABLEN DEFINITIONEN ===
anz_be: Anzahl Brennereignisse (Number of burn events)
anz_a: Anzahl Abbränder (Number of burn-downs)
anz_bt: Anzahl Brenntage (Number of burning days)
anz_s: Gesamte Brenndauer in Sekunden (Total burn duration in seconds)
e: Erzeugte Energie (Generated energy, kWh × 100)
erster: Erstes Brennereignis (First burn event, Unix epoch timestamp)
h: Holzverbrauch (Wood consumption, kg × 100)
letzter: Letztes Brennereignis (Last burn event, Unix epoch timestamp)
o: Heizöl-Äquivalent (Heating oil equivalent, liters × 100)
p: Gesamtperformance (Overall performance, %)
p_ph1: Anheiz-Performance (Ignition performance, %)
p_ph2: Hauptbrand-Performance (Main burn performance, %)
p_ph3: Nachlege-Performance (Refueling performance, %)
p_ph4: Aufheiz-Performance nach Nachlegen (Re-heating after refuel performance, %)
t: Durchschnittstemperatur (Average temperature, °C)
z_ph1: Zeit Anheizen (Ignition time, seconds) - normalized by anz_be
z_ph2: Zeit Abbrand (Main burn time, seconds) - normalized by anz_a
z_ph3: Zeit Nachlegen (Refueling action time, seconds) - normalized by anz_a
z_ph4: Zeit Aufheizen nach dem Nachlegen (Re-heating after refuel time, seconds) - normalized by (anz_a - anz_be)
wt0…wt6: Brennereignisse pro Wochentag (Burn events per weekday, 0=Sonntag…6=Samstag)

WICHTIG: Neue z_ph Normalisierung ab sofort:
- z_ph1 = original_z_ph1 / anz_be (per burn event)
- z_ph2 = original_z_ph2 / anz_a (per burn-down)
- z_ph3 = original_z_ph3 / anz_a (per burn-down)
- z_ph4 = original_z_ph4 / (anz_a - anz_be) (per refuel event)

Historische Datenanalyse:
Zeitraum: {{PERIOD}}
Datum: {{DATE}}

Statistische Daten (aggregiert über den Zeitraum):
{{STATS}}

Fuzzy-Rules-Analyseergebnisse:
{{FUZZY_RESULTS}}

Basierend auf den historischen Statistiken und Fuzzy-Rules-Analyse oben, erstelle eine umfassende Analyse in {{LOCALE}}.

Berücksichtige dabei:
1. Die Fuzzy-Rules haben bereits B-Codes und Probleme identifiziert
2. Suche nach Mustern in den statistischen Daten, die die Fuzzy-Analyse unterstützen oder widersprechen
3. Biete zusätzliche Einblicke basierend auf Brennereignissen, Leistungstrends und Betriebsmustern
4. Berücksichtige saisonale Faktoren und Nutzungsmuster für den analysierten Zeitraum
5. Empfehle sowohl sofortige Maßnahmen als auch langfristige Verbesserungen

Analysiere spezifisch:
- Brennverhalten: anz_be (Ereignisse), anz_s (Dauer), anz_bt (Brenntage)
- Leistung: p (gesamt), p_ph1 (Anheizen), p_ph2 (Hauptbrand), p_ph3 (Nachlegen), p_ph4 (Aufheizen)
- Timing: z_ph1 (Anheizzeit), z_ph2 (Brennzeit), z_ph3 (Nachlegezeit), z_ph4 (Aufheizzeit)
- Effizienz: e (Energie), h (Holzverbrauch), o (Heizöl-Äquivalent)
- Temperatur: t (Durchschnitt)
- Nutzungsmuster: wt0-6 (Wochentage), erster/letzter (Zeitspanne)

KEINE Echtzeitinformationen wie:
- Aktuelle Verbindungsstatus
- Aktuelle Sensordaten
- Fehlerflags aus dem laufenden Betrieb
- Controller-Temperatur
- Aktuelle Brennphase

Be concise: keep summary <= 140 characters.
Antworte in STRIKTEM JSON-Format:
{"summary": "Kurze Analysezusammenfassung", "urgency": "low|medium|high", "confidence": 0.0-1.0,
 "hypotheses": [{"issue":"Problembeschreibung","probability":0.0-1.0,"why":["Beweise aus historischen Daten"]}],
 "actions": [{"action":"spezifische Maßnahme","type":"self|support","eta_min":number|null}],
 "used_signals": ["Liste der analysierten historischen Datenpunkte"] }`;
  };

  // Normalize aggregated data using new z_ph formulas for fuzzy analysis
  const normalizeHistoricalData = (data: HistoricalData): HistoricalData & { originalStats?: any; normalizedForEvents?: number; burnDowns?: number; refuelEvents?: number } => {
    const { stats } = data;
    
    // Get values for normalization
    const burnEvents = stats.anz_be || 0; // Brennereignisse
    const burnDowns = (stats as any).anz_a || 0;   // Abbränder
    
    // If no burn events, no normalization needed
    if (burnEvents === 0) {
      return data;
    }
    
    const normalizedStats = { ...stats };
    
    // Parameters that need to be normalized by dividing by anz_be (unchanged)
    const paramsToNormalizeByBe: (keyof typeof stats)[] = [
      'anz_bt', 'anz_s', 'e', 'h', 'o', // Volume/energy parameters
      'wt1', 'wt2', 'wt3', 'wt4', 'wt5', 'wt6' // Weekday counters (if present)
    ];
    
    // Normalize parameters by dividing by number of burn events
    paramsToNormalizeByBe.forEach(param => {
      if (normalizedStats[param] && normalizedStats[param]! > 0) {
        normalizedStats[param] = Math.round((normalizedStats[param]! / burnEvents) * 100) / 100; // Round to 2 decimals
      }
    });

    // Apply new z_ph normalization formulas:
    // z_ph1 = z_ph1 (fb) / anz_be
    if (normalizedStats.z_ph1 && normalizedStats.z_ph1 > 0 && burnEvents > 0) {
      normalizedStats.z_ph1 = Math.round((normalizedStats.z_ph1 / burnEvents) * 100) / 100;
    }

    // z_ph2 = z_ph2 (fb) / anz_a  
    if (normalizedStats.z_ph2 && normalizedStats.z_ph2 > 0 && burnDowns > 0) {
      normalizedStats.z_ph2 = Math.round((normalizedStats.z_ph2 / burnDowns) * 100) / 100;
    }

    // z_ph3 = z_ph3 (fb) / anz_a
    if (normalizedStats.z_ph3 && normalizedStats.z_ph3 > 0 && burnDowns > 0) {
      normalizedStats.z_ph3 = Math.round((normalizedStats.z_ph3 / burnDowns) * 100) / 100;
    }

    // z_ph4 = z_ph4 (fb) / (anz_a - anz_be)
    const refuelEvents = burnDowns - burnEvents;
    if (normalizedStats.z_ph4 && normalizedStats.z_ph4 > 0 && refuelEvents > 0) {
      normalizedStats.z_ph4 = Math.round((normalizedStats.z_ph4 / refuelEvents) * 100) / 100;
    }
    
    return {
      ...data,
      stats: normalizedStats,
      originalStats: stats, // Keep original for reference
      normalizedForEvents: burnEvents,
      burnDowns: burnDowns,
      refuelEvents: refuelEvents
    };
  };

  const buildHistoricalPrompt = (data: HistoricalData, fuzzyResults: HistoricalRuleResult): string => {
    const currentPrompt = customPrompt || getDefaultHistoricalPrompt();
    
    // Add normalization info to prompt if data was normalized
    let additionalInfo = '';
    if ((data as any).normalizedForEvents && (data as any).normalizedForEvents > 1) {
      const burnEvents = (data as any).normalizedForEvents;
      const burnDowns = (data as any).burnDowns || 0;
      const refuelEvents = (data as any).refuelEvents || 0;
      additionalInfo = `\n\nNOTE: This is ${data.period} aggregated data normalized using new z_ph formulas:
- z_ph1 normalized by anz_be (${burnEvents} events)
- z_ph2 normalized by anz_a (${burnDowns} burn-downs)  
- z_ph3 normalized by anz_a (${burnDowns} burn-downs)
- z_ph4 normalized by (anz_a - anz_be) = ${refuelEvents} refuel events
- Volume/energy values normalized by anz_be (${burnEvents} events)
- Performance percentages, temperature, and timestamps remain as calculated averages.`;
    } else if (data.period !== 'daily') {
      additionalInfo = `\n\nNOTE: This is ${data.period} period data with average values representing typical behavior during the ${data.period}.`;
    }
    
    return currentPrompt
      .replace('{{PERIOD}}', data.period)
      .replace('{{DATE}}', data.date)
      .replace('{{STATS}}', JSON.stringify(data.stats, null, 2))
      .replace('{{FUZZY_RESULTS}}', JSON.stringify(fuzzyResults, null, 2))
      .replace('{{LOCALE}}', i18n.language === 'de' ? 'German' : 'English')
      + additionalInfo;
  };

  // Unified membership calculator matching rules engine (points-based)
  const calculateFromPoints = (x: number, points: number[], functionName: string): number => {
    if (!points || points.length < 2) return 0;
    // Linear with 2 points
    if (points.length === 2) {
      const [p1, p2] = points;
      if (functionName === 'good_p') {
        if (x <= p1) return 0;
        if (x >= p2) return 1;
        return (x - p1) / (p2 - p1);
      } else if (functionName === 'bad_p') {
        if (x <= p1) return 1;
        if (x >= p2) return 0;
        return (p2 - x) / (p2 - p1);
      } else if (functionName.includes('_gut')) {
        if (x <= p1) return 1;
        if (x >= p2) return 0;
        return (p2 - x) / (p2 - p1);
      } else if (functionName.includes('_schlecht')) {
        if (functionName === 'z_ph2_schlecht') {
          if (x <= p1) return 1;
          if (x >= p2) return 1;
          return 0;
        }
        if (x <= p1) return 0;
        if (x >= p2) return 1;
        return (x - p1) / (p2 - p1);
      }
      return 0;
    }
    // Triangular or inverted with 3+ points
    const sorted = [...points].sort((a, b) => a - b);
    const start = sorted[0];
    const mid = sorted[Math.floor(sorted.length / 2)];
    const end = sorted[sorted.length - 1];
    if (functionName === 'z_ph2_schlecht') {
      if (x <= start) return 1;
      if (x >= end) return 1;
      if (x === mid) return 0;
      if (x < mid) return 1 - (x - start) / (mid - start);
      return 1 - (end - x) / (end - mid);
    }
    if (x <= start || x >= end) return 0;
    if (x === mid) return 1;
    if (x < mid) return (x - start) / (mid - start);
    return (end - x) / (end - mid);
  };

  const calcMembership = (x: number, functionName: string): number => {
    try {
      const pts = getFunctionPoints(functionName);
      return calculateFromPoints(x, pts, functionName);
    } catch {
      return 0;
    }
  };

  // Special handling for z_ph3 functions that aren't in the standard config
  const calcZ_ph3_schlecht1 = (x: number): number => {
    // z_ph3_schlecht1: refueled too early (inverse of z_ph3_gut early range)
    // Assume early refuel is problematic if z_ph3 < 5s (too quick)
    const z3GutPoints = getFunctionPoints('z_ph3_gut');
    const earlyThreshold = z3GutPoints[0] ?? 0;  // Should be 0
    const goodStart = z3GutPoints[1] ?? 5;        // Should be 5
    
    if (x >= goodStart) return 0;  // Not too early
    if (x <= earlyThreshold) return 1;  // Very early
    return (goodStart - x) / (goodStart - earlyThreshold);  // Linear between
  };

  const calcZ_ph3_schlecht2 = (x: number): number => {
    // z_ph3_schlecht2: refueled too late 
    // Already implemented in calcMembership, but here for clarity
    const z3GutPoints = getFunctionPoints('z_ph3_gut');
    const goodEnd = z3GutPoints[1] ?? 5;      // Should be 5
    const lateThreshold = z3GutPoints[2] ?? 300;  // Should be 300
    
    if (x <= goodEnd) return 0;  // Not too late
    if (x >= lateThreshold) return 1;  // Very late
    return (x - goodEnd) / (lateThreshold - goodEnd);  // Linear between
  };

  // Build LaTeX blocks for key membership calculations using current config
  const buildCalculationsLatex = (data: HistoricalData): string[] => {
    const blocks: string[] = [];
    const s = data.stats as any;
    const p = s.p || 0;
    const p1 = getFunctionPoints('good_p')[0] ?? 50;
    const p2 = getFunctionPoints('good_p')[1] ?? 70;
    const pVal = p <= p1 ? 0 : p < p2 ? (p - p1) / (p2 - p1) : 1;
    if (p <= p1) {
      blocks.push(`\\mu_{\\text{good}_p}(${p}) = 0 \\quad (x \\leq ${p1})`);
    } else if (p < p2) {
      blocks.push(`\\mu_{\\text{good}_p}(${p}) = \\frac{${p}-${p1}}{${p2}-${p1}} = ${pVal.toFixed(3)}`);
    } else {
      blocks.push(`\\mu_{\\text{good}_p}(${p}) = 1 \\quad (x \\geq ${p2})`);
    }

    const z1 = s.z_ph1 || 0;
    const [z1a, z1b] = [getFunctionPoints('z_ph1_gut')[0] ?? 300, getFunctionPoints('z_ph1_gut')[1] ?? 800];
    const z1Val = z1 <= z1a ? 1 : z1 < z1b ? (z1b - z1) / (z1b - z1a) : 0;
    if (z1 <= z1a) {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph1 gut}}}(${z1}) = 1 \\quad (x \\leq ${z1a})`);
    } else if (z1 < z1b) {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph1 gut}}}(${z1}) = \\frac{${z1b}-${z1}}{${z1b}-${z1a}} = ${z1Val.toFixed(3)}`);
    } else {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph1 gut}}}(${z1}) = 0 \\quad (x \\geq ${z1b})`);
    }

    const z2 = s.z_ph2 || 0;
    const z2pts = getFunctionPoints('z_ph2_gut');
    const [z2a, z2b, z2c] = [z2pts[0] ?? 1000, z2pts[1] ?? 2400, z2pts[2] ?? 2520];
    let z2Val = 0;
    if (z2 <= z2a) {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph2 gut}}}(${z2}) = 0 \\quad (x \\leq ${z2a})`);
    } else if (z2 <= z2b) {
      z2Val = (z2 - z2a) / (z2b - z2a);
      blocks.push(`\\mu_{\\text{z}_{\\text{ph2 gut}}}(${z2}) = \\frac{${z2}-${z2a}}{${z2b}-${z2a}} = ${z2Val.toFixed(3)}`);
    } else if (z2 <= z2c) {
      z2Val = (z2c - z2) / (z2c - z2b);
      blocks.push(`\\mu_{\\text{z}_{\\text{ph2 gut}}}(${z2}) = \\frac{${z2c}-${z2}}{${z2c}-${z2b}} = ${z2Val.toFixed(3)}`);
    } else {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph2 gut}}}(${z2}) = 0 \\quad (x \\geq ${z2c})`);
    }

    const z3 = s.z_ph3 || 0;
    const z3pts = getFunctionPoints('z_ph3_gut');
    const [, z3b, z3c] = [z3pts[0] ?? 0, z3pts[1] ?? 5, z3pts[2] ?? 300];
    const z3sch2 = z3 <= z3b ? 0 : z3 <= z3c ? (z3 - z3b) / (z3c - z3b) : 1;
    if (z3 <= z3b) {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph3 schlecht}}}(${z3}) = 0 \\quad (x \\leq ${z3b})`);
    } else if (z3 <= z3c) {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph3 schlecht}}}(${z3}) = \\frac{${z3}-${z3b}}{${z3c}-${z3b}} = ${z3sch2.toFixed(3)}`);
    } else {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph3 schlecht}}}(${z3}) = 1 \\quad (x \\geq ${z3c})`);
    }

    const z4 = s.z_ph4 || 0;
    const z4pts = getFunctionPoints('z_ph4_gut');
    const [z4a, z4b] = [z4pts[0] ?? 60, z4pts[1] ?? 180];
    const z4sch = z4 <= z4a ? 0 : z4 <= z4b ? (z4 - z4a) / (z4b - z4a) : 1;
    if (z4 <= z4a) {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph4 schlecht}}}(${z4}) = 0 \\quad (x \\leq ${z4a})`);
    } else if (z4 <= z4b) {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph4 schlecht}}}(${z4}) = \\frac{${z4}-${z4a}}{${z4b}-${z4a}} = ${z4sch.toFixed(3)}`);
    } else {
      blocks.push(`\\mu_{\\text{z}_{\\text{ph4 schlecht}}}(${z4}) = 1 \\quad (x \\geq ${z4b})`);
    }

    return blocks;
  };

  // Generate B-Codes calculations breakdown
  const generateBCodesCalculations = (data: HistoricalData) => {
    const stats = data?.stats || ({} as any);
    const rules = [];

    // Extract values
    const p = stats.p || 0;
    const p_ph1 = stats.p_ph1 || 0;
    const p_ph2 = stats.p_ph2 || 0;
    const p_ph4 = stats.p_ph4 || 0;
    const z_ph1 = stats.z_ph1 || 0;
    const z_ph2 = stats.z_ph2 || 0;
    const z_ph3 = stats.z_ph3 || 0;
    const z_ph4 = stats.z_ph4 || 0;

    // Calculate membership values (using same logic as historicalRules.ts)
    const p_gut = calcMembership(p, 'good_p');
    const p_ph1_gut = calcMembership(p_ph1, 'good_p');
    const p_ph1_schlecht = calcMembership(p_ph1, 'bad_p');
    const p_ph2_gut = calcMembership(p_ph2, 'good_p');
    const p_ph2_schlecht = calcMembership(p_ph2, 'bad_p');
    const p_ph4_gut = calcMembership(p_ph4, 'good_p');
    const p_ph4_schlecht = calcMembership(p_ph4, 'bad_p');

    const z_ph1_gut = calcMembership(z_ph1, 'z_ph1_gut');
    const z_ph1_schlecht = calcMembership(z_ph1, 'z_ph1_schlecht');
    const z_ph2_schlecht1 = calcMembership(z_ph2, 'z_ph2_schlecht');
    const z_ph2_schlecht2 = calcMembership(z_ph2, 'z_ph2_schlecht');
    const z_ph3_gut = calcMembership(z_ph3, 'z_ph3_gut');
    const z_ph3_schlecht1 = calcZ_ph3_schlecht1(z_ph3);
    const z_ph3_schlecht2 = calcZ_ph3_schlecht2(z_ph3);
    const z_ph4_gut = calcMembership(z_ph4, 'z_ph4_gut');
    const z_ph4_schlecht = calcMembership(z_ph4, 'z_ph4_schlecht');

    // Helper functions
    const fuzzyAnd = (...values: number[]) => values.reduce((acc, val) => acc * val, 1);
    const fuzzyOr = (...values: number[]) => Math.max(...values);

    // Rule 1: Too little wood, wet wood, large logs, weak chimney
    const rule1_cond1 = fuzzyAnd(p_ph1_schlecht, z_ph1_schlecht);
    const rule1_cond2 = fuzzyAnd(p_ph4_schlecht, z_ph4_schlecht);
    const rule1_or = fuzzyOr(rule1_cond1, rule1_cond2);
    const rule1_condition = fuzzyAnd(rule1_or, z_ph2_schlecht1);
    
    rules.push({
      title: t('historicalAI.calculations.rules.rule1', 'Rule 1: Stove not reaching temperature'),
      condition: '((p_ph1_schlecht ∧ z_ph1_schlecht) ∨ (p_ph4_schlecht ∧ z_ph4_schlecht)) ∧ z_ph2_schlecht1',
      calculations: [
        `p_ph1_schlecht(${p_ph1}) = ${p_ph1_schlecht.toFixed(3)}`,
        `z_ph1_schlecht(${z_ph1}) = ${z_ph1_schlecht.toFixed(3)}`,
        `p_ph4_schlecht(${p_ph4}) = ${p_ph4_schlecht.toFixed(3)}`,
        `z_ph4_schlecht(${z_ph4}) = ${z_ph4_schlecht.toFixed(3)}`,
        `z_ph2_schlecht1(${z_ph2}) = ${z_ph2_schlecht1.toFixed(3)}`,
        `cond1 = fuzzyAnd(${p_ph1_schlecht.toFixed(3)}, ${z_ph1_schlecht.toFixed(3)}) = ${rule1_cond1.toFixed(3)}`,
        `cond2 = fuzzyAnd(${p_ph4_schlecht.toFixed(3)}, ${z_ph4_schlecht.toFixed(3)}) = ${rule1_cond2.toFixed(3)}`,
        `or_result = fuzzyOr(${rule1_cond1.toFixed(3)}, ${rule1_cond2.toFixed(3)}) = ${rule1_or.toFixed(3)}`,
        `final_condition = fuzzyAnd(${rule1_or.toFixed(3)}, ${z_ph2_schlecht1.toFixed(3)}) = ${rule1_condition.toFixed(3)}`
      ],
      triggered: rule1_condition > 0.1,
      bCodes: rule1_condition > 0.1 ? [
        { code: 'B0', description: t('historicalAI.calculations.bCodeDescriptions.B0', 'too little wood'), value: z_ph2_schlecht1 },
        { code: 'B2', description: t('historicalAI.calculations.bCodeDescriptions.B2', 'wood too wet'), value: z_ph2_schlecht1 },
        { code: 'B4', description: t('historicalAI.calculations.bCodeDescriptions.B4', 'logs too large'), value: z_ph2_schlecht1 },
        { code: 'B10', description: t('historicalAI.calculations.bCodeDescriptions.B10', 'chimney draft too low'), value: z_ph2_schlecht1 }
      ] : []
    });

    // Rule 2: Burns too fast after ignition
    const rule2_or = fuzzyOr(z_ph1_gut, z_ph4_gut);
    const rule2_condition = fuzzyAnd(rule2_or, z_ph2_schlecht1);
    
    rules.push({
      title: t('historicalAI.calculations.rules.rule2', 'Rule 2: Burns too fast after ignition/reheating'),
      condition: '(z_ph1_gut ∨ z_ph4_gut) ∧ z_ph2_schlecht1',
      calculations: [
        `z_ph1_gut(${z_ph1}) = ${z_ph1_gut.toFixed(3)}`,
        `z_ph4_gut(${z_ph4}) = ${z_ph4_gut.toFixed(3)}`,
        `z_ph2_schlecht1(${z_ph2}) = ${z_ph2_schlecht1.toFixed(3)}`,
        `or_result = fuzzyOr(${z_ph1_gut.toFixed(3)}, ${z_ph4_gut.toFixed(3)}) = ${rule2_or.toFixed(3)}`,
        `final_condition = fuzzyAnd(${rule2_or.toFixed(3)}, ${z_ph2_schlecht1.toFixed(3)}) = ${rule2_condition.toFixed(3)}`
      ],
      triggered: rule2_condition > 0.1,
      bCodes: rule2_condition > 0.1 ? [
        { code: 'B3', description: t('historicalAI.calculations.bCodeDescriptions.B3', 'wood too dry'), value: z_ph2_schlecht1 },
        { code: 'B5', description: t('historicalAI.calculations.bCodeDescriptions.B5', 'logs too small'), value: z_ph2_schlecht1 }
      ] : []
    });

    // Rule 3: Burns too long
    const rule3_condition = fuzzyAnd(z_ph2_schlecht2, p_ph2_gut);
    
    rules.push({
      title: t('historicalAI.calculations.rules.rule3', 'Rule 3: Stove burns too long'),
      condition: 'z_ph2_schlecht2 ∧ p_ph2_gut',
      calculations: [
        `z_ph2_schlecht2(${z_ph2}) = ${z_ph2_schlecht2.toFixed(3)}`,
        `p_ph2_gut(${p_ph2}) = ${p_ph2_gut.toFixed(3)}`,
        `final_condition = fuzzyAnd(${z_ph2_schlecht2.toFixed(3)}, ${p_ph2_gut.toFixed(3)}) = ${rule3_condition.toFixed(3)}`
      ],
      triggered: rule3_condition > 0.1,
      bCodes: rule3_condition > 0.1 ? [
        { code: 'B1', description: t('historicalAI.calculations.bCodeDescriptions.B1', 'too much wood'), value: rule3_condition }
      ] : []
    });

    // Rule 4: Burns too long and too hot
    const rule4_condition = fuzzyAnd(z_ph4_gut, z_ph2_schlecht2, p_ph2_schlecht);
    
    rules.push({
      title: t('historicalAI.calculations.rules.rule4', 'Rule 4: Burns too long and too hot'),
      condition: 'z_ph4_gut ∧ z_ph2_schlecht2 ∧ p_ph2_schlecht',
      calculations: [
        `z_ph4_gut(${z_ph4}) = ${z_ph4_gut.toFixed(3)}`,
        `z_ph2_schlecht2(${z_ph2}) = ${z_ph2_schlecht2.toFixed(3)}`,
        `p_ph2_schlecht(${p_ph2}) = ${p_ph2_schlecht.toFixed(3)}`,
        `final_condition = fuzzyAnd(${z_ph4_gut.toFixed(3)}, ${z_ph2_schlecht2.toFixed(3)}, ${p_ph2_schlecht.toFixed(3)}) = ${rule4_condition.toFixed(3)}`
      ],
      triggered: rule4_condition > 0.1,
      bCodes: rule4_condition > 0.1 ? [
        { code: 'B1', description: t('historicalAI.calculations.bCodeDescriptions.B1', 'too much wood'), value: fuzzyAnd(z_ph2_schlecht2, p_ph2_schlecht) },
        { code: 'B4', description: t('historicalAI.calculations.bCodeDescriptions.B4', 'logs too large'), value: fuzzyAnd(z_ph2_schlecht2, p_ph2_schlecht) }
      ] : []
    });

    // Rule 5: Burns too short and too hot
    const rule5_condition = fuzzyAnd(z_ph4_gut, z_ph2_schlecht1, p_ph2_schlecht);
    
    rules.push({
      title: t('historicalAI.calculations.rules.rule5', 'Rule 5: Burns too short and too hot'),
      condition: 'z_ph4_gut ∧ z_ph2_schlecht1 ∧ p_ph2_schlecht',
      calculations: [
        `z_ph4_gut(${z_ph4}) = ${z_ph4_gut.toFixed(3)}`,
        `z_ph2_schlecht1(${z_ph2}) = ${z_ph2_schlecht1.toFixed(3)}`,
        `p_ph2_schlecht(${p_ph2}) = ${p_ph2_schlecht.toFixed(3)}`,
        `final_condition = fuzzyAnd(${z_ph4_gut.toFixed(3)}, ${z_ph2_schlecht1.toFixed(3)}, ${p_ph2_schlecht.toFixed(3)}) = ${rule5_condition.toFixed(3)}`
      ],
      triggered: rule5_condition > 0.1,
      bCodes: rule5_condition > 0.1 ? [
        { code: 'B11', description: t('historicalAI.calculations.bCodeDescriptions.B11', 'chimney draft too high'), value: rule5_condition },
        { code: 'B3', description: t('historicalAI.calculations.bCodeDescriptions.B3', 'wood too dry'), value: rule5_condition }
      ] : []
    });

    // Rule 6: Refueled too early
    rules.push({
      title: t('historicalAI.calculations.rules.rule6', 'Rule 6: Refueled too early'),
      condition: 'z_ph3_schlecht1 > 0.1',
      calculations: [
        `z_ph3_schlecht1(${z_ph3}) = ${z_ph3_schlecht1.toFixed(3)}`,
        `${t('historicalAI.calculations.labels.threshold', 'threshold')} = 0.1`,
        `triggered = ${z_ph3_schlecht1.toFixed(3)} > 0.1 ? ${z_ph3_schlecht1 > 0.1}`
      ],
      triggered: z_ph3_schlecht1 > 0.1,
      bCodes: z_ph3_schlecht1 > 0.1 ? [
        { code: 'B6', description: t('historicalAI.calculations.bCodeDescriptions.B6', 'refueled too early'), value: z_ph3_schlecht1 }
      ] : []
    });

    // Rule 7: Refueled too late
    rules.push({
      title: t('historicalAI.calculations.rules.rule7', 'Rule 7: Refueled too late'),
      condition: 'z_ph3_schlecht2 > 0.1',
      calculations: [
        `z_ph3_schlecht2(${z_ph3}) = ${z_ph3_schlecht2.toFixed(3)}`,
        `${t('historicalAI.calculations.labels.threshold', 'threshold')} = 0.1`,
        `triggered = ${z_ph3_schlecht2.toFixed(3)} > 0.1 ? ${z_ph3_schlecht2 > 0.1}`
      ],
      triggered: z_ph3_schlecht2 > 0.1,
      bCodes: z_ph3_schlecht2 > 0.1 ? [
        { code: 'B7', description: t('historicalAI.calculations.bCodeDescriptions.B7', 'refueled too late'), value: z_ph3_schlecht2 }
      ] : []
    });

    // Rule 8: Correctly refueled
    rules.push({
      title: t('historicalAI.calculations.rules.rule8', 'Rule 8: Refueled correctly'),
      condition: 'z_ph3_gut > 0.1',
      calculations: [
        `z_ph3_gut(${z_ph3}) = ${z_ph3_gut.toFixed(3)}`,
        `${t('historicalAI.calculations.labels.threshold', 'threshold')} = 0.1`,
        `triggered = ${z_ph3_gut.toFixed(3)} > 0.1 ? ${z_ph3_gut > 0.1}`
      ],
      triggered: z_ph3_gut > 0.1,
      bCodes: z_ph3_gut > 0.1 ? [
        { code: 'B13', description: t('historicalAI.calculations.bCodeDescriptions.B13', 'refueled correctly'), value: z_ph3_gut }
      ] : []
    });

    // Rule 9: Fuel is appropriate
    const rule9_condition = fuzzyAnd(p_ph1_gut, p_ph2_gut, p_ph4_gut);
    
    rules.push({
      title: 'Rule 9: Fuel is appropriate',
      condition: 'p_ph1_gut ∧ p_ph2_gut ∧ p_ph4_gut',
      calculations: [
        `p_ph1_gut(${p_ph1}) = ${p_ph1_gut.toFixed(3)}`,
        `p_ph2_gut(${p_ph2}) = ${p_ph2_gut.toFixed(3)}`,
        `p_ph4_gut(${p_ph4}) = ${p_ph4_gut.toFixed(3)}`,
        `final_condition = fuzzyAnd(${p_ph1_gut.toFixed(3)}, ${p_ph2_gut.toFixed(3)}, ${p_ph4_gut.toFixed(3)}) = ${rule9_condition.toFixed(3)}`
      ],
      triggered: rule9_condition > 0.1,
      bCodes: rule9_condition > 0.1 ? [
        { code: 'B12', description: 'fuel is appropriate', value: rule9_condition }
      ] : []
    });

    // Rule 10: Generally good combustion
    rules.push({
      title: 'Rule 10: Generally good combustion',
      condition: 'p_gut > 0.1',
      calculations: [
        `p_gut(${p}) = ${p_gut.toFixed(3)}`,
        `threshold = 0.1`,
        `triggered = ${p_gut.toFixed(3)} > 0.1 ? ${p_gut > 0.1}`
      ],
      triggered: p_gut > 0.1,
      bCodes: p_gut > 0.1 ? [
        { code: 'B8', description: 'generally good combustion', value: p_gut }
      ] : []
    });

    // Rule for poor performance
    const p_bad = calcMembership(p, 'bad_p');
    rules.push({
      title: t('historicalAI.calculations.rules.poorPerformance', 'Generally poor performance'),
      condition: 'p < 50 or p_bad > 0.1',
      calculations: [
        `overall_performance(p) = ${p}%`,
        `p_bad(${p}) = ${p_bad.toFixed(3)}`,
        `low_performance = p < 50 ? ${p < 50}`,
        `triggered = ${p < 50 || p_bad > 0.1}`
      ],
      triggered: p < 50 || p_bad > 0.1,
      bCodes: (p < 50 || p_bad > 0.1) ? [
        { code: 'B9', description: t('historicalAI.calculations.bCodeDescriptions.B9', 'generally poor combustion'), value: Math.max(p_bad, p < 50 ? 0.8 : 0) }
      ] : []
    });

    return rules;
  };

  const generateCalculationsExplanation = (data: HistoricalData): string => {
    const { stats } = data;
    let explanation = `Historical Fuzzy Rules Calculations Breakdown\n`;
    explanation += `=========================================\n\n`;
    
    const goodPPoints = getFunctionPoints('good_p');
    const badPPoints = getFunctionPoints('bad_p');
    const zPh1GutPoints = getFunctionPoints('z_ph1_gut');
    const zPh2GutPoints = getFunctionPoints('z_ph2_gut');
    const zPh3GutPoints = getFunctionPoints('z_ph3_gut');
    const zPh4GutPoints = getFunctionPoints('z_ph4_gut');
    
    explanation += `User Configuration Info:\n`;
    explanation += `good_p points: [${goodPPoints.join(', ')}] (instead of default [50, 70])\n`;
    explanation += `bad_p points: [${badPPoints.join(', ')}] (instead of default [60, 80])\n`;
    explanation += `z_ph1_gut points: [${zPh1GutPoints.join(', ')}] (instead of default [300, 800])\n`;
    explanation += `z_ph2_gut points: [${zPh2GutPoints.join(', ')}] (instead of default [1000, 2400, 2520])\n`;
    explanation += `z_ph3_gut points: [${zPh3GutPoints.join(', ')}] (instead of default [0, 5, 300])\n`;
    explanation += `z_ph4_gut points: [${zPh4GutPoints.join(', ')}] (instead of default [60, 180])\n`;
    explanation += `Note: You can modify these values using the 'Diagramme' button.\n\n`;
    
    explanation += `Input Data:\n`;
    explanation += `- Period: ${data.period}\n`;
    explanation += `- Date: ${data.date}\n`;
    // Removed device info from explanation to protect privacy
    
    // Show normalization info if applicable
    if ((data as any).normalizedForEvents && (data as any).normalizedForEvents > 1) {
      const burnEvents = (data as any).normalizedForEvents;
      const burnDowns = (data as any).burnDowns || 0;
      const refuelEvents = (data as any).refuelEvents || 0;
      explanation += `\n!!!  NEW Z_PH NORMALIZATION APPLIED:\n`;
      explanation += `   Original data represents ${data.period} totals\n`;
      explanation += `   NEW z_ph formulas:\n`;
      explanation += `   - z_ph1: ÷ anz_be (${burnEvents} burn events)\n`;
      explanation += `   - z_ph2: ÷ anz_a (${burnDowns} burn-downs)\n`;
      explanation += `   - z_ph3: ÷ anz_a (${burnDowns} burn-downs)\n`;
      explanation += `   - z_ph4: ÷ (anz_a - anz_be) = ${refuelEvents} refuel events\n`;
      explanation += `   Volume/energy: ÷ anz_be (${burnEvents} events) [unchanged]\n`;
      explanation += `   Performance percentages, temperature, timestamps unchanged\n`;
      explanation += `   Example: Original z_ph1=${(data as any).originalStats?.z_ph1 || 'N/A'}s → Normalized z_ph1=${data.stats.z_ph1 || 'N/A'}s per burn event\n`;
    }
    explanation += `\n`;
    
    explanation += `Performance Values:\n`;
    explanation += `- Overall Performance (p): ${stats.p || 0}%\n`;
    explanation += `- Ignition Performance (p_ph1): ${stats.p_ph1 || 0}%\n`;
    explanation += `- Main Burn Performance (p_ph2): ${stats.p_ph2 || 0}%\n`;
    explanation += `- Refuel Performance (p_ph3): ${stats.p_ph3 || 0}%\n`;
    explanation += `- Reheating Performance (p_ph4): ${stats.p_ph4 || 0}%\n\n`;
    
    explanation += `Timing Values (NEW FORMULAS):\n`;
    const originalStats = (data as any).originalStats;
    if (originalStats && (data as any).normalizedForEvents > 1) {
      const burnEvents = (data as any).normalizedForEvents;
      const burnDowns = (data as any).burnDowns || 0;
      const refuelEvents = (data as any).refuelEvents || 0;
      explanation += `- Ignition Time (z_ph1): ${stats.z_ph1 || 0}s/burn_event (from ${originalStats.z_ph1 || 0}s total ÷ ${burnEvents} anz_be)\n`;
      explanation += `- Main Burn Time (z_ph2): ${stats.z_ph2 || 0}s/burn_down (from ${originalStats.z_ph2 || 0}s total ÷ ${burnDowns} anz_a)\n`;
      explanation += `- Refueling Action Time (z_ph3): ${stats.z_ph3 || 0}s/burn_down (from ${originalStats.z_ph3 || 0}s total ÷ ${burnDowns} anz_a)\n`;
      explanation += `- Re-heating After Refuel Time (z_ph4): ${stats.z_ph4 || 0}s/refuel_event (from ${originalStats.z_ph4 || 0}s total ÷ ${refuelEvents} (anz_a-anz_be))\n\n`;
    } else {
      explanation += `- Ignition Time (z_ph1): ${stats.z_ph1 || 0}s\n`;
      explanation += `- Main Burn Time (z_ph2): ${stats.z_ph2 || 0}s\n`;
      explanation += `- Refueling Action Time (z_ph3): ${stats.z_ph3 || 0}s\n`;
      explanation += `- Re-heating After Refuel Time (z_ph4): ${stats.z_ph4 || 0}s\n\n`;
    }
    
    explanation += `Fuzzy Membership Function Calculations:\n`;
    explanation += `=====================================\n\n`;
    
    // Example calculations for key fuzzy values
    const p = stats.p || 0;
    const z_ph1 = stats.z_ph1 || 0;
    const z_ph2 = stats.z_ph2 || 0;
    
    // Detailed step-by-step calculations with actual if-else logic
    explanation += `SCHRITT 1: Performance Bewertung\n`;
    explanation += `====================================\n`;
    explanation += `Eingabe: p = ${p}%\n\n`;
    explanation += `IF-ELSE Logik für good_p(${p}) [User Config: ${goodPPoints[0] || 50}, ${goodPPoints[1] || 70}]:\n`;
    const p1 = goodPPoints[0] || 50;
    const p2 = goodPPoints[1] || 70;
    if (p <= p1) {
      explanation += `if (p <= ${p1}) {\n`;
      explanation += `    return 0;  // Schlecht\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: good_p = 0 (schlechte Performance)\n\n`;
    } else if (p < p2) {
      const value = (p - p1) / (p2 - p1);
      explanation += `if (p <= ${p1}) {\n`;
      explanation += `    return 0;  // ÜBERSPRUNGEN\n`;
      explanation += `} else if (p < ${p2}) {\n`;
      explanation += `    return (p - ${p1}) / (${p2} - ${p1});\n`;
      explanation += `    return (${p} - ${p1}) / (${p2} - ${p1}) = ${value.toFixed(3)}\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: good_p = ${value.toFixed(3)} (mittlere Performance)\n\n`;
    } else {
      explanation += `if (p <= ${p1}) {\n`;
      explanation += `    return 0;  // ÜBERSPRUNGEN\n`;
      explanation += `} else if (p < ${p2}) {\n`;
      explanation += `    return (p - ${p1}) / (${p2} - ${p1});  // ÜBERSPRUNGEN\n`;
      explanation += `} else {\n`;
      explanation += `    return 1;  // Gut\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: good_p = 1 (gute Performance)\n\n`;
    }
    
    explanation += `SCHRITT 2: Ignition Time Bewertung\n`;
    explanation += `===================================\n`;
    explanation += `Eingabe: ignition_time (z_ph1) = ${z_ph1}s\n\n`;
    const z1a = zPh1GutPoints[0] ?? 300;
    const z1b = zPh1GutPoints[1] ?? 800;
    explanation += `IF-ELSE Logik für z_ph1_gut(${z_ph1}) [User Config: ${z1a}, ${z1b}]:\n`;
    if (z_ph1 <= z1a) {
      explanation += `if (z_ph1 <= ${z1a}) {\n`;
      explanation += `    return 1;  // Excellent\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph1_gut = 1 (schnelle Anzündung, sehr gut)\n\n`;
    } else if (z_ph1 < z1b) {
      const value = (z1b - z_ph1) / (z1b - z1a);
      explanation += `if (z_ph1 <= ${z1a}) {\n`;
      explanation += `    return 1;  // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph1 < ${z1b}) {\n`;
      explanation += `    return (${z1b} - z_ph1) / (${z1b} - ${z1a});\n`;
      explanation += `    return (${z1b} - ${z_ph1}) / (${z1b} - ${z1a}) = ${value.toFixed(3)}\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph1_gut = ${value.toFixed(3)} (akzeptable Anzündzeit)\n\n`;
    } else {
      explanation += `if (z_ph1 <= ${z1a}) {\n`;
      explanation += `    return 1;  // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph1 < ${z1b}) {\n`;
      explanation += `    return (${z1b} - z_ph1) / (${z1b} - ${z1a});  // ÜBERSPRUNGEN\n`;
      explanation += `} else {\n`;
      explanation += `    return 0;  // Schlecht\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph1_gut = 0 (langsame Anzündung, problematisch)\n\n`;
    }
    
    explanation += `SCHRITT 3: Main Burn Time Bewertung\n`;
    explanation += `======================================\n`;
    explanation += `Eingabe: main_burn_time (z_ph2) = ${z_ph2}s\n\n`;
    const z2a = zPh2GutPoints[0] ?? 1000;
    const z2b = zPh2GutPoints[1] ?? 2400;
    const z2c = zPh2GutPoints[2] ?? 2520;
    explanation += `IF-ELSE Logik für z_ph2 Bewertung [User Config: ${z2a}, ${z2b}, ${z2c}]:\n`;
    if (z_ph2 <= z2a) {
      explanation += `if (z_ph2 <= ${z2a}) {\n`;
      explanation += `    z_ph2_schlecht1 = 1;  // Zu kurz\n`;
      explanation += `    z_ph2_gut = 0;\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph2_schlecht1 = 1, z_ph2_gut = 0 (zu kurze Brennzeit)\n\n`;
    } else if (z_ph2 <= z2b) {
      const goodValue = (z_ph2 - z2a) / (z2b - z2a);
      explanation += `if (z_ph2 <= ${z2a}) {\n`;
      explanation += `    // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph2 <= ${z2b}) {\n`;
      explanation += `    z_ph2_gut = (z_ph2 - ${z2a}) / (${z2b} - ${z2a});\n`;
      explanation += `    z_ph2_gut = (${z_ph2} - ${z2a}) / (${z2b} - ${z2a}) = ${goodValue.toFixed(3)}\n`;
      explanation += `    z_ph2_schlecht1 = 0;\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph2_gut = ${goodValue.toFixed(3)} (optimale Brennzeit)\n\n`;
    } else if (z_ph2 <= z2c) {
      const goodValue = (z2c - z_ph2) / (z2c - z2b);
      explanation += `if (z_ph2 <= ${z2a}) {\n`;
      explanation += `    // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph2 <= ${z2b}) {\n`;
      explanation += `    // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph2 <= ${z2c}) {\n`;
      explanation += `    z_ph2_gut = (${z2c} - z_ph2) / (${z2c} - ${z2b});\n`;
      explanation += `    z_ph2_gut = (${z2c} - ${z_ph2}) / (${z2c} - ${z2b}) = ${goodValue.toFixed(3)}\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph2_gut = ${goodValue.toFixed(3)} (noch akzeptabel, aber lang)\n\n`;
    } else {
      explanation += `if (z_ph2 <= ${z2a}) {\n`;
      explanation += `    // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph2 <= ${z2b}) {\n`;
      explanation += `    // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph2 <= ${z2c}) {\n`;
      explanation += `    // ÜBERSPRUNGEN\n`;
      explanation += `} else {\n`;
      explanation += `    z_ph2_schlecht2 = 1;  // Zu lang\n`;
      explanation += `    z_ph2_gut = 0;\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph2_schlecht2 = 1, z_ph2_gut = 0 (zu lange Brennzeit)\n\n`;
    }
    
    explanation += `\nSCHRITT 4: Refueling Action Time Bewertung\n`;
    explanation += `============================================\n`;
    explanation += `Eingabe: refueling_action_time (z_ph3) = ${stats.z_ph3 || 0}s\n\n`;
    const z_ph3 = stats.z_ph3 || 0;
    const z3b = zPh3GutPoints[1] ?? 5;
    const z3c = zPh3GutPoints[2] ?? 300;
    explanation += `IF-ELSE Logik für z_ph3_schlecht2(${z_ph3}) [Late thresholds: ${z3b}, ${z3c}]:\n`;
    if (z_ph3 <= z3b) {
      explanation += `if (z_ph3 <= ${z3b}) {\n`;
      explanation += `    return 0;  // Gut\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph3_schlecht2 = 0 (rechtzeitig nachgelegt)\n\n`;
    } else if (z_ph3 <= z3c) {
      const value = (z_ph3 - z3b) / (z3c - z3b);
      explanation += `if (z_ph3 <= ${z3b}) {\n`;
      explanation += `    return 0;  // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph3 <= ${z3c}) {\n`;
      explanation += `    return (z_ph3 - ${z3b}) / (${z3c} - ${z3b});\n`;
      explanation += `    return (${z_ph3} - ${z3b}) / (${z3c} - ${z3b}) = ${value.toFixed(3)}\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph3_schlecht2 = ${value.toFixed(3)} (etwas zu spät)\n\n`;
    } else {
      explanation += `if (z_ph3 <= ${z3b}) {\n`;
      explanation += `    return 0;  // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph3 <= ${z3c}) {\n`;
      explanation += `    return (z_ph3 - ${z3b}) / (${z3c} - ${z3b});  // ÜBERSPRUNGEN\n`;
      explanation += `} else {\n`;
      explanation += `    return 1;  // Too late\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph3_schlecht2 = 1 (viel zu spät nachgelegt)\n\n`;
    }
    
    explanation += `SCHRITT 5: Re-heating After Refuel Time Bewertung\n`;
    explanation += `===================================================\n`;
    explanation += `Eingabe: reheating_time (z_ph4) = ${stats.z_ph4 || 0}s\n\n`;
    const z_ph4 = stats.z_ph4 || 0;
    const z4a = zPh4GutPoints[0] ?? 60;
    const z4b = zPh4GutPoints[1] ?? 180;
    explanation += `IF-ELSE Logik für z_ph4_schlecht(${z_ph4}) [User Config: ${z4a}, ${z4b}]:\n`;
    if (z_ph4 <= z4a) {
      explanation += `if (z_ph4 <= ${z4a}) {\n`;
      explanation += `    return 0;  // Gut\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph4_schlecht = 0 (schnelle Aufheizung)\n\n`;
    } else if (z_ph4 <= z4b) {
      const value = (z_ph4 - z4a) / (z4b - z4a);
      explanation += `if (z_ph4 <= ${z4a}) {\n`;
      explanation += `    return 0;  // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph4 <= ${z4b}) {\n`;
      explanation += `    return (z_ph4 - ${z4a}) / (${z4b} - ${z4a});\n`;
      explanation += `    return (${z_ph4} - ${z4a}) / (${z4b} - ${z4a}) = ${value.toFixed(3)}\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph4_schlecht = ${value.toFixed(3)} (langsame Aufheizung)\n\n`;
    } else {
      explanation += `if (z_ph4 <= ${z4a}) {\n`;
      explanation += `    return 0;  // ÜBERSPRUNGEN\n`;
      explanation += `} else if (z_ph4 <= ${z4b}) {\n`;
      explanation += `    return (z_ph4 - ${z4a}) / (${z4b} - ${z4a});  // ÜBERSPRUNGEN\n`;
      explanation += `} else {\n`;
      explanation += `    return 1;  // Sehr schlecht\n`;
      explanation += `} ✓ AUSGEFÜHRT\n`;
      explanation += `Ergebnis: z_ph4_schlecht = 1 (sehr langsame Aufheizung)\n\n`;
    }
    
    explanation += `SCHRITT 6: Performance Bewertungen\n`;
    explanation += `=====================================\n`;
    const p_ph2 = stats.p_ph2 || 0;
    explanation += `Main Burn Performance (p_ph2=${p_ph2}%):\n`;
    if (p_ph2 <= 50) {
      explanation += `p_ph2_gut = 0, p_ph2_schlecht = 1 (sehr schlecht)\n`;
    } else if (p_ph2 < 70) {
      const good = (p_ph2 - 50) / 20;
      const bad = p_ph2 <= 60 ? 1 : (80 - p_ph2) / 20;
      explanation += `p_ph2_gut = ${good.toFixed(3)}, p_ph2_schlecht = ${bad.toFixed(3)}\n`;
    } else {
      const bad = p_ph2 >= 80 ? 0 : (80 - p_ph2) / 20;
      explanation += `p_ph2_gut = 1, p_ph2_schlecht = ${bad.toFixed(3)} (sehr gut)\n`;
    }
    explanation += `\n`;
    
    explanation += `Rule Evaluation Examples:\n`;
    explanation += `========================\n`;
    explanation += `Rules are evaluated using fuzzy AND (multiplication) and OR (maximum) operations.\n`;
    explanation += `Each rule that fires (> 0.1 threshold) generates B-codes and recommendations.\n\n`;
    
    explanation += `Beispiel - Regel 7 (zu spät nachgelegt):\n`;
    const z_ph3_schlecht2_val = calcMembership(z_ph3, 'z_ph3_schlecht2');
    explanation += `refueling_action_time (z_ph3) = ${z_ph3}s\n`;
    explanation += `z_ph3_schlecht2 = ${z_ph3_schlecht2_val.toFixed(3)}\n`;
    explanation += `if (z_ph3_schlecht2 > 0.1) {\n`;
    explanation += `    // ${z_ph3_schlecht2_val > 0.1 ? '✓ REGEL AUSGELÖST' : '✗ REGEL NICHT AUSGELÖST'}\n`;
    explanation += `    addBCode("B7", "zu spät nachgelegt", ${z_ph3_schlecht2_val.toFixed(3)});\n`;
    explanation += `}\n\n`;
    
    explanation += `Beispiel - Regel 3 (zu lange Brennzeit):\n`;
    const z_ph2_schlecht2_val = calcMembership(z_ph2, 'z_ph2_schlecht');
    const p_ph2_gut_val = calcMembership(p_ph2, 'good_p');
    const rule3_val = z_ph2_schlecht2_val * p_ph2_gut_val;
    explanation += `main_burn_time (z_ph2) = ${z_ph2}s, main_burn_performance (p_ph2) = ${p_ph2}%\n`;
    explanation += `z_ph2_schlecht2 = ${z_ph2_schlecht2_val.toFixed(3)}, p_ph2_gut = ${p_ph2_gut_val.toFixed(3)}\n`;
    explanation += `rule3_condition = z_ph2_schlecht2 ∧ p_ph2_gut = ${z_ph2_schlecht2_val.toFixed(3)} × ${p_ph2_gut_val.toFixed(3)} = ${rule3_val.toFixed(3)}\n`;
    explanation += `if (rule3_condition > 0.1) {\n`;
    explanation += `    // ${rule3_val > 0.1 ? '✓ REGEL AUSGELÖST' : '✗ REGEL NICHT AUSGELÖST'}\n`;
    explanation += `    addBCode("B1", "zu viel Holz", ${rule3_val.toFixed(3)});\n`;
    explanation += `}\n\n`;
    
    explanation += `For complete rule evaluation details, see the fuzzy rules implementation in historicalRules.ts`;
    
    return explanation;
  };

  const generateFuzzyLogicPseudocode = (data: HistoricalData): string => {
    const { stats } = data;
    let pseudocode = `FUZZY LOGIC RULES ENGINE - PSEUDOCODE\n`;
    pseudocode += `==========================================\n\n`;
    
    const goodPPoints = getFunctionPoints('good_p');
    const badPPoints = getFunctionPoints('bad_p');
    const zPh1GutPoints = getFunctionPoints('z_ph1_gut');
    const zPh2GutPoints = getFunctionPoints('z_ph2_gut');
    const zPh3GutPoints = getFunctionPoints('z_ph3_gut');
    const zPh4GutPoints = getFunctionPoints('z_ph4_gut');
    
    // Show normalization info if applicable
    if ((data as any).normalizedForEvents && (data as any).normalizedForEvents > 1) {
      const burnEvents = (data as any).normalizedForEvents;
      const burnDowns = (data as any).burnDowns || 0;
      const refuelEvents = (data as any).refuelEvents || 0;
      pseudocode += `// !!!  NEW Z_PH NORMALIZATION APPLIED\n`;
      pseudocode += `// Original ${data.period} totals normalized using NEW formulas:\n`;
      pseudocode += `// z_ph1: ÷ anz_be (${burnEvents} burn events)\n`;
      pseudocode += `// z_ph2: ÷ anz_a (${burnDowns} burn-downs)\n`;
      pseudocode += `// z_ph3: ÷ anz_a (${burnDowns} burn-downs)\n`;
      pseudocode += `// z_ph4: ÷ (anz_a - anz_be) = ${refuelEvents} refuel events\n`;
      pseudocode += `// Volume: e, h, o, anz_s values ÷ anz_be [unchanged]\n`;
      pseudocode += `// Unchanged: p_*, t, erster, letzter, anz_be, anz_a\n\n`;
    }
    
    pseudocode += `// Eingabedaten extrahieren\n`;
    pseudocode += `p = stats.p || 0;           // ${stats.p || 0}%\n`;
    pseudocode += `p_ph1 = stats.p_ph1 || 0;   // ${stats.p_ph1 || 0}%\n`;
    pseudocode += `p_ph2 = stats.p_ph2 || 0;   // ${stats.p_ph2 || 0}%\n`;
    pseudocode += `p_ph4 = stats.p_ph4 || 0;   // ${stats.p_ph4 || 0}%\n`;
    const originalStats = (data as any).originalStats;
    if (originalStats && (data as any).normalizedForEvents > 1) {
      const burnEvents = (data as any).normalizedForEvents;
      const burnDowns = (data as any).burnDowns || 0;
      const refuelEvents = (data as any).refuelEvents || 0;
      pseudocode += `z_ph1 = stats.z_ph1 || 0;   // ${stats.z_ph1 || 0}s/burn_event ignition_time (${originalStats.z_ph1 || 0}s ÷ ${burnEvents} anz_be)\n`;
      pseudocode += `z_ph2 = stats.z_ph2 || 0;   // ${stats.z_ph2 || 0}s/burn_down main_burn_time (${originalStats.z_ph2 || 0}s ÷ ${burnDowns} anz_a)\n`;
      pseudocode += `z_ph3 = stats.z_ph3 || 0;   // ${stats.z_ph3 || 0}s/burn_down refueling_action_time (${originalStats.z_ph3 || 0}s ÷ ${burnDowns} anz_a)\n`;
      pseudocode += `z_ph4 = stats.z_ph4 || 0;   // ${stats.z_ph4 || 0}s/refuel_event reheating_time (${originalStats.z_ph4 || 0}s ÷ ${refuelEvents} (anz_a-anz_be))\n\n`;
    } else {
      pseudocode += `z_ph1 = stats.z_ph1 || 0;   // ${stats.z_ph1 || 0}s ignition_time\n`;
      pseudocode += `z_ph2 = stats.z_ph2 || 0;   // ${stats.z_ph2 || 0}s main_burn_time\n`;
      pseudocode += `z_ph3 = stats.z_ph3 || 0;   // ${stats.z_ph3 || 0}s refueling_action_time\n`;
      pseudocode += `z_ph4 = stats.z_ph4 || 0;   // ${stats.z_ph4 || 0}s reheating_time\n\n`;
    }
    
    pseudocode += `// Fuzzy Membership Funktionen (User Configured)\n`;
    pseudocode += `function good_p(x) {\n`;
    if (goodPPoints.length >= 2) {
      pseudocode += `    if (x <= ${goodPPoints[0]}) return 0;\n`;
      pseudocode += `    if (x < ${goodPPoints[1]}) return (x - ${goodPPoints[0]}) / (${goodPPoints[1]} - ${goodPPoints[0]});\n`;
      pseudocode += `    return 1;\n`;
    } else {
      pseudocode += `    // Using default values (user config not found)\n`;
      pseudocode += `    if (x <= 50) return 0;\n`;
      pseudocode += `    if (x < 70) return (x - 50) / (70 - 50);\n`;
      pseudocode += `    return 1;\n`;
    }
    pseudocode += `}\n\n`;
    
    pseudocode += `function bad_p(x) {\n`;
    if (badPPoints.length >= 2) {
      pseudocode += `    if (x <= ${badPPoints[0]}) return 1;\n`;
      pseudocode += `    if (x < ${badPPoints[1]}) return (${badPPoints[1]} - x) / (${badPPoints[1]} - ${badPPoints[0]});\n`;
      pseudocode += `    return 0;\n`;
    } else {
      pseudocode += `    // Using default values (user config not found)\n`;
      pseudocode += `    if (x <= 60) return 1;\n`;
      pseudocode += `    if (x < 80) return (80 - x) / (80 - 60);\n`;
      pseudocode += `    return 0;\n`;
    }
    pseudocode += `}\n\n`;
    
    pseudocode += `function z_ph1_gut(x) {\n`;
    if (zPh1GutPoints.length >= 2) {
      pseudocode += `    if (x <= ${zPh1GutPoints[0]}) return 1;\n`;
      pseudocode += `    if (x < ${zPh1GutPoints[1]}) return (${zPh1GutPoints[1]} - x) / (${zPh1GutPoints[1]} - ${zPh1GutPoints[0]});\n`;
      pseudocode += `    return 0;\n`;
    } else {
      pseudocode += `    // Using default values\n`;
      pseudocode += `    if (x <= 300) return 1;\n`;
      pseudocode += `    if (x < 800) return (800 - x) / (800 - 300);\n`;
      pseudocode += `    return 0;\n`;
    }
    pseudocode += `}\n\n`;
    
    pseudocode += `function z_ph1_schlecht(x) {\n`;
    if (zPh1GutPoints.length >= 2) {
      pseudocode += `    if (x <= ${zPh1GutPoints[0]}) return 0;\n`;
      pseudocode += `    if (x < ${zPh1GutPoints[1]}) return (x - ${zPh1GutPoints[0]}) / (${zPh1GutPoints[1]} - ${zPh1GutPoints[0]});\n`;
      pseudocode += `    return 1;\n`;
    } else {
      pseudocode += `    if (x <= 300) return 0;\n`;
      pseudocode += `    if (x < 800) return (x - 300) / (800 - 300);\n`;
      pseudocode += `    return 1;\n`;
    }
    pseudocode += `}\n\n`;
    
    pseudocode += `function z_ph2_gut(x) {\n`;
    if (zPh2GutPoints.length >= 3) {
      pseudocode += `    if (x <= ${zPh2GutPoints[0]}) return 0;\n`;
      pseudocode += `    if (x <= ${zPh2GutPoints[1]}) return (x - ${zPh2GutPoints[0]}) / (${zPh2GutPoints[1]} - ${zPh2GutPoints[0]});\n`;
      pseudocode += `    if (x <= ${zPh2GutPoints[2]}) return (${zPh2GutPoints[2]} - x) / (${zPh2GutPoints[2]} - ${zPh2GutPoints[1]});\n`;
      pseudocode += `    return 0;\n`;
    } else {
      pseudocode += `    if (x <= 1000) return 0;\n`;
      pseudocode += `    if (x <= 2400) return (x - 1000) / (2400 - 1000);\n`;
      pseudocode += `    if (x <= 2520) return (2520 - x) / (2520 - 2400);\n`;
      pseudocode += `    return 0;\n`;
    }
    pseudocode += `}\n\n`;
    
    pseudocode += `function z_ph2_schlecht1(x) { // zu kurz\n`;
    if (zPh2GutPoints.length >= 3) {
      pseudocode += `    if (x <= ${zPh2GutPoints[0]}) return 1;\n`;
      pseudocode += `    if (x < ${zPh2GutPoints[1]}) return (${zPh2GutPoints[1]} - x) / (${zPh2GutPoints[1]} - ${zPh2GutPoints[0]});\n`;
      pseudocode += `    return 0;\n`;
    } else {
      pseudocode += `    if (x <= 1000) return 1;\n`;
      pseudocode += `    if (x < 2400) return (2400 - x) / (2400 - 1000);\n`;
      pseudocode += `    return 0;\n`;
    }
    pseudocode += `}\n\n`;
    
    pseudocode += `function z_ph2_schlecht2(x) { // zu lang\n`;
    if (zPh2GutPoints.length >= 3) {
      pseudocode += `    if (x <= ${zPh2GutPoints[1]}) return 0;\n`;
      pseudocode += `    if (x <= ${zPh2GutPoints[2]}) return (x - ${zPh2GutPoints[1]}) / (${zPh2GutPoints[2]} - ${zPh2GutPoints[1]});\n`;
      pseudocode += `    return 1;\n`;
    } else {
      pseudocode += `    if (x <= 2400) return 0;\n`;
      pseudocode += `    if (x <= 2520) return (x - 2400) / (2520 - 2400);\n`;
      pseudocode += `    return 1;\n`;
    }
    pseudocode += `}\n\n`;
    
    pseudocode += `// Fuzzy AND/OR Operatoren\n`;
    pseudocode += `function fuzzyAnd(...values) {\n`;
    pseudocode += `    return values.reduce((acc, val) => acc * val, 1);\n`;
    pseudocode += `}\n\n`;
    
    pseudocode += `function fuzzyOr(...values) {\n`;
    pseudocode += `    return Math.max(...values);\n`;
    pseudocode += `}\n\n`;
    
    pseudocode += `// Membership Values berechnen (mit User-Konfiguration)\n`;
    pseudocode += `// NOTE: Function parameters have been customized by user via Diagramme editor\n`;
    pseudocode += `// good_p points: [${goodPPoints.join(', ')}], bad_p points: [${badPPoints.join(', ')}]\n`;
    pseudocode += `// z_ph1_gut points: [${zPh1GutPoints.join(', ')}], z_ph4_gut points: [${zPh4GutPoints.join(', ')}]\n\n`;
    const p = stats.p || 0;
    const p_ph1 = stats.p_ph1 || 0;
    const p_ph2 = stats.p_ph2 || 0;
    const p_ph4 = stats.p_ph4 || 0;
    const z_ph1 = stats.z_ph1 || 0;
    const z_ph2 = stats.z_ph2 || 0;
    const z_ph3 = stats.z_ph3 || 0;
    const z_ph4 = stats.z_ph4 || 0;
    
    const p_gut_val = calcMembership(p, 'good_p');
    const p_ph1_schlecht_val = calcMembership(p_ph1, 'bad_p');
    const p_ph2_schlecht_val = calcMembership(p_ph2, 'bad_p');
    const p_ph4_schlecht_val = calcMembership(p_ph4, 'bad_p');
    const z_ph1_schlecht_val = calcMembership(z_ph1, 'z_ph1_schlecht');
    const z_ph2_schlecht1_val = calcMembership(z_ph2, 'z_ph2_schlecht');
    const z_ph4_schlecht_val = calcMembership(z_ph4, 'z_ph4_schlecht');

    pseudocode += `p_gut = good_p(${p}) = ${p_gut_val.toFixed(3)};\n`;
    pseudocode += `p_ph1_schlecht = bad_p(${p_ph1}) = ${p_ph1_schlecht_val.toFixed(3)};\n`;
    pseudocode += `p_ph2_schlecht = bad_p(${p_ph2}) = ${p_ph2_schlecht_val.toFixed(3)};\n`;
    pseudocode += `p_ph4_schlecht = bad_p(${p_ph4}) = ${p_ph4_schlecht_val.toFixed(3)};\n`;
    pseudocode += `z_ph1_schlecht = z_ph1_schlecht(${z_ph1}) = ${z_ph1_schlecht_val.toFixed(3)};\n`;
    pseudocode += `z_ph2_schlecht1 = z_ph2_schlecht(${z_ph2}) = ${z_ph2_schlecht1_val.toFixed(3)};\n`;
    pseudocode += `z_ph4_schlecht = z_ph4_schlecht(${z_ph4}) = ${z_ph4_schlecht_val.toFixed(3)};\n\n`;
    
    pseudocode += `// REGEL 1: Ofen kommt nicht auf Temperatur\n`;
    pseudocode += `// ((p_ph1_schlecht ∧ z_ph1_schlecht) ∨ (p_ph4_schlecht ∧ z_ph4_schlecht)) ∧ z_ph2_schlecht1\n`;
    const cond1_1 = p_ph1_schlecht_val * z_ph1_schlecht_val;
    const cond1_2 = p_ph4_schlecht_val * z_ph4_schlecht_val;
    const cond1_or = Math.max(cond1_1, cond1_2);
    const rule1_result = cond1_or * z_ph2_schlecht1_val;
    
    pseudocode += `cond1_1 = fuzzyAnd(p_ph1_schlecht, z_ph1_schlecht) = ${cond1_1.toFixed(3)};\n`;
    pseudocode += `cond1_2 = fuzzyAnd(p_ph4_schlecht, z_ph4_schlecht) = ${cond1_2.toFixed(3)};\n`;
    pseudocode += `cond1_or = fuzzyOr(cond1_1, cond1_2) = ${cond1_or.toFixed(3)};\n`;
    pseudocode += `rule1_condition = fuzzyAnd(cond1_or, z_ph2_schlecht1) = ${rule1_result.toFixed(3)};\n`;
    pseudocode += `if (rule1_condition > 0.1) {\n`;
    pseudocode += `    // ${rule1_result > 0.1 ? '✓ REGEL AUSGELÖST' : '✗ REGEL NICHT AUSGELÖST'}\n`;
    pseudocode += `    addIssue("Ofen kommt nicht auf Temperatur");\n`;
    pseudocode += `    addBCode("B0", "zu wenig Holz", z_ph2_schlecht1);\n`;
    pseudocode += `    addBCode("B2", "Holz zu feucht", z_ph2_schlecht1);\n`;
    pseudocode += `    addBCode("B4", "Holzscheite zu groß", z_ph2_schlecht1);\n`;
    pseudocode += `    addBCode("B10", "Kaminzug zu schwach", z_ph2_schlecht1);\n`;
    pseudocode += `}\n\n`;
    
    pseudocode += `// REGEL 7: zu spät nachgelegt\n`;
    const z3b = zPh3GutPoints[1] ?? 5;
    const z3c = zPh3GutPoints[2] ?? 300;
    const z_ph3_schlecht2 = z_ph3 <= z3b ? 0 : z_ph3 <= z3c ? (z_ph3 - z3b) / (z3c - z3b) : 1;
    pseudocode += `z_ph3_schlecht2 = z_ph3_schlecht2(${z_ph3}) = ${z_ph3_schlecht2.toFixed(3)};\n`;
    pseudocode += `if (z_ph3_schlecht2 > 0.1) {\n`;
    pseudocode += `    // ${z_ph3_schlecht2 > 0.1 ? '✓ REGEL AUSGELÖST' : '✗ REGEL NICHT AUSGELÖST'}\n`;
    pseudocode += `    addIssue("zu spät nachgelegt");\n`;
    pseudocode += `    addBCode("B7", "zu spät nachgelegt", z_ph3_schlecht2);\n`;
    pseudocode += `}\n\n`;
    
    pseudocode += `// Weitere Regeln nach gleichem Muster...\n`;
    pseudocode += `// Jede Regel prüft Fuzzy-Conditions und fügt B-Codes hinzu\n\n`;
    
    pseudocode += `// Urgency Bewertung\n`;
    pseudocode += `criticalBCodes = bCodes.filter(b => \n`;
    pseudocode += `    ['B0','B1','B2','B10','B11'].includes(b.code) && b.value > 0.5\n`;
    pseudocode += `);\n`;
    pseudocode += `urgency = criticalBCodes.length > 0 ? 'high' : \n`;
    pseudocode += `          issues.some(i => i.probability > 0.7) ? 'medium' : 'low';\n\n`;
    
    pseudocode += `// Confidence basierend auf Datenvollständigkeit\n`;
    pseudocode += `confidence = 0.6; // Basis\n`;
    pseudocode += `if (hasPerformanceData) confidence += 0.15;\n`;
    pseudocode += `if (hasTimingData) confidence += 0.15;\n`;
    pseudocode += `if (hasVolumeData) confidence += 0.1;\n`;
    pseudocode += `confidence = Math.min(confidence, 0.9);\n\n`;
    
    pseudocode += `return {\n`;
    pseudocode += `    summary,\n`;
    pseudocode += `    urgency,\n`;
    pseudocode += `    confidence,\n`;
    pseudocode += `    hypotheses: issues.slice(0, 5),\n`;
    pseudocode += `    actions: actions.slice(0, 4),\n`;
    pseudocode += `    bCodes: bCodes.filter(b => b.value > 0.05),\n`;
    pseudocode += `    used_signals: ['historical_stats', 'fuzzy_rules', 'b_codes'],\n`;
    pseudocode += `    source: 'historical_rules'\n`;
    pseudocode += `};\n`;
    
    return pseudocode;
  };

  // Debug scanner to see what's actually in the database
  const debugScanDatabase = async () => {
    if (!deviceId) return;

    try {
      const firebase = await import('../lib/firebase');
      const firestoreDB = firebase.firestoreDB;
      const realtimeDB = firebase.realtimeDB;

      if (realtimeDB) {
        const { ref, get } = await import('firebase/database');
        
        try {
          const rtStatsRef = ref(realtimeDB, `statistik_monat_tage/${deviceId}`);
          await get(rtStatsRef);
        } catch (e) {}

        try {
          const rtYearRef = ref(realtimeDB, `statistik_jahr/${deviceId}`);
          await get(rtYearRef);
        } catch (e) {}

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        const currentDay = now.getDate();

        try {
          const examplePaths = [
            `statistik_monat_tage/${deviceId}/${currentYear}/${currentMonth}/${currentDay}`,
            `statistik_monat_tage/${deviceId}/${currentYear}/${currentMonth}/monat`,
            `statistik_jahr/${deviceId}/${currentYear}`
          ];

          for (const path of examplePaths) {
            try {
              const testRef = ref(realtimeDB, path);
              await get(testRef);
            } catch (e) {}
          }
        } catch (e) {}
      }

      if (firestoreDB) {
        const { collection, getDocs } = await import('firebase/firestore');
        
        try {
          const monatRef = collection(firestoreDB, 'statistik_monat_tage', deviceId, String(new Date().getFullYear()), String(new Date().getMonth() + 1), 'monat');
          await getDocs(monatRef);
        } catch (e) {}
      }

    } catch (error) {
      console.error('[HistoricalAI] 🔍 Debug scan failed:', error);
    }
  };

    // Fetch available dates for the selected time period using REALTIME DATABASE
  const fetchAvailableDates = async () => {
    if (!deviceId) return;

    setLoadingDates(true);
    
    // Run debug scan first
    await debugScanDatabase();
    
    try {
      const { ref, get } = await import('firebase/database');
      const firebase = await import('../lib/firebase');
      const realtimeDB = firebase.realtimeDB;

      if (!realtimeDB) {
        setLoadingDates(false);
        return;
      }

      let dates: string[] = [];

      if (timePeriod === 'yearly') {
        // Get available years from statistik_jahr/{deviceId}
        try {
          const yearlyRef = ref(realtimeDB, `statistik_jahr/${deviceId}`);
          const yearlySnap = await get(yearlyRef);
          if (yearlySnap.exists()) {
            const yearData = yearlySnap.val();
            dates = Object.keys(yearData)
              .filter(year => !isNaN(Number(year)) && Number(year) > 1970) // Filter out invalid years like "1969"
              .sort()
              .reverse();
            console.log('[HistoricalAI] Found yearly data:', dates);
          }
        } catch (error) {
          console.log('[HistoricalAI] Failed to fetch yearly data:', error);
        }
      } else if (timePeriod === 'monthly') {
        // Get available months from statistik_monat_tage/{deviceId}
        try {
          const monthlyRef = ref(realtimeDB, `statistik_monat_tage/${deviceId}`);
          const monthlySnap = await get(monthlyRef);
          if (monthlySnap.exists()) {
            const yearData = monthlySnap.val();
            const monthSet = new Set<string>();
            
            Object.keys(yearData).forEach(year => {
              if (!isNaN(Number(year)) && Number(year) > 1970) {
                const monthData = yearData[year];
                if (monthData && typeof monthData === 'object') {
                  Object.keys(monthData).forEach(month => {
                    if (!isNaN(Number(month)) && Number(month) >= 1 && Number(month) <= 12) {
                      // Check if month has 'monat' aggregate
                      if (monthData[month]?.monat) {
                        monthSet.add(`${year}-${String(month).padStart(2, '0')}`);
                      }
                    }
                  });
                }
              }
            });
            
            dates = Array.from(monthSet).sort().reverse();
            console.log('[HistoricalAI] Found monthly data:', dates);
          }
        } catch (error) {
          console.log('[HistoricalAI] Failed to fetch monthly data:', error);
        }
      } else {
        // Get available days from statistik_monat_tage/{deviceId}
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        // Check last 12 months for daily data
        const monthsToCheck: Array<{year: number, month: number}> = [];
        for (let i = 0; i < 12; i++) {
          const checkDate = new Date(currentYear, currentMonth - 1 - i, 1);
          monthsToCheck.push({
            year: checkDate.getFullYear(),
            month: checkDate.getMonth() + 1
          });
        }
        
        for (const { year, month } of monthsToCheck) {
          try {
            const monthRef = ref(realtimeDB, `statistik_monat_tage/${deviceId}/${year}/${month}`);
            const monthSnap = await get(monthRef);
            
            if (monthSnap.exists()) {
              const monthData = monthSnap.val();
              if (monthData && typeof monthData === 'object') {
                Object.keys(monthData).forEach(day => {
                  if (!isNaN(Number(day)) && Number(day) >= 0 && Number(day) <= 30 && day !== 'monat') {
                    // Database stores days starting from 0 (0 = 1st, 7 = 8th, etc.)
                    // Add 1 to display the actual calendar date to the user
                    const adjustedDate = new Date(year, month - 1, Number(day) + 1);
                    const adjustedYear = adjustedDate.getFullYear();
                    const adjustedMonth = String(adjustedDate.getMonth() + 1).padStart(2, '0');
                    const adjustedDay = String(adjustedDate.getDate()).padStart(2, '0');
                    dates.push(`${adjustedYear}-${adjustedMonth}-${adjustedDay}`);
                  }
                });
              }
            }
          } catch (error) {
            console.log(`[HistoricalAI] Failed to fetch daily data for ${year}/${month}:`, error);
          }
        }
        
        dates = dates.sort().reverse();
        console.log('[HistoricalAI] Found daily data:', dates);
      }

      console.log('[HistoricalAI] Final available dates for', timePeriod, ':', dates);
      setAvailableDates(dates);
      
      // Auto-select first available date if current selection is not available
      if (dates.length > 0 && !dates.includes(selectedDate)) {
        setSelectedDate(dates[0]);
        console.log('[HistoricalAI] Auto-selected date:', dates[0]);
      }
      
    } catch (error) {
      console.error('[HistoricalAI] Failed to fetch available dates:', error);
    } finally {
      setLoadingDates(false);
    }
  };

  useEffect(() => {
    fetchAvailableDates();
  }, [deviceId, timePeriod]);

  // Load saved state on component mount
  useEffect(() => {
    if (deviceId && !hasHydrated) {
      const saved = loadState();
      if (saved) {
        setResult(saved.result || null);
        setTimePeriod(saved.timePeriod || 'monthly');
        setSelectedDate(saved.selectedDate || '');
        setLastPrompt(saved.lastPrompt || '');
        setLastResponse(saved.lastResponse || '');
        setLastCalculations(saved.lastCalculations || '');
        setLastPseudocode(saved.lastPseudocode || '');
        setAnalysisSource(saved.analysisSource || 'rules');
        setCustomPrompt(saved.customPrompt || '');
      }
    }
  }, [deviceId, hasHydrated]);

  // Fetch historical data for the selected date using REALTIME DATABASE
  const fetchHistoricalData = async (): Promise<StatisticsData | null> => {
    if (!deviceId || !selectedDate) return null;

    try {
      const { ref, get } = await import('firebase/database');
      const firebase = await import('../lib/firebase');
      const realtimeDB = firebase.realtimeDB;

      if (!realtimeDB) return null;

      let dataPath: string = '';

      if (timePeriod === 'yearly') {
        // Path: statistik_jahr/{deviceId}/{year}
        dataPath = `statistik_jahr/${deviceId}/${selectedDate}`;
      } else if (timePeriod === 'monthly') {
        // Path: statistik_monat_tage/{deviceId}/{year}/{month}/monat
        const [year, month] = selectedDate.split('-');
        dataPath = `statistik_monat_tage/${deviceId}/${year}/${Number(month)}/monat`;
      } else {
        // Path: statistik_monat_tage/{deviceId}/{year}/{month}/{day}
        // Database stores days starting from 0 (0 = 1st, 7 = 8th, etc.)
        // Subtract 1 from the displayed day to get the database key
        const [year, month, day] = selectedDate.split('-');
        const dbDay = Number(day) - 1; // Convert calendar day to database key (e.g., 8th -> 7)
        dataPath = `statistik_monat_tage/${deviceId}/${year}/${Number(month)}/${dbDay}`;
      }

      console.log('[HistoricalAI] Fetching data from REALTIME DB path:', dataPath);
      
      const dataRef = ref(realtimeDB, dataPath);
      const dataSnap = await get(dataRef);
      
      if (dataSnap.exists()) {
        const data = dataSnap.val() as StatisticsData;
        console.log('[HistoricalAI] Successfully fetched data:', data);
        return data;
      } else {
        console.log('[HistoricalAI] No data found at path:', dataPath);
        return null;
      }

    } catch (error) {
      console.error('[HistoricalAI] Failed to fetch historical data:', error);
      return null;
    }
  };

  const runAnalysis = async () => {
    if (!deviceId || !selectedDate) return;

    setLoading(true);
    setError(null);

    try {
      const data = await fetchHistoricalData();
      
      if (!data) {
        const periodText = timePeriod === 'yearly' ? 'year' : timePeriod === 'monthly' ? 'month' : 'day';
        setError(`No historical data available for selected ${periodText}: ${selectedDate}`);
        return;
      }

      // Convert to HistoricalData format
      const historicalData: HistoricalData = {
        period: timePeriod,
        date: selectedDate,
        stats: data,
        deviceId
      };

      // Store original historical data for reference
      setHistoricalData(historicalData);

      // Normalize data for fuzzy analysis (convert yearly/monthly totals to daily averages)
      const normalizedData = normalizeHistoricalData(historicalData);
      setNormalizedDataState(normalizedData);

      // Always run fuzzy rules on normalized data with custom fuzzy configs
      const fuzzyResult = runHistoricalRules(normalizedData, i18n.language as 'de' | 'en', getFunctionPoints);
      setVisualBCodes((fuzzyResult as any).bCodes || []);

      // Generate calculations explanation and pseudocode using normalized data
      const calculations = generateCalculationsExplanation(normalizedData);
      const pseudocode = generateFuzzyLogicPseudocode(normalizedData);
      setLastCalculations(calculations);
      setLastPseudocode(pseudocode);

      let finalResult: HistoricalRuleResult | AIResult = fuzzyResult as any;
      let localPrompt = '';
      let localResponse = '';

      if (analysisSource === 'ai') {
        try {
          // Build and store prompt using normalized data
          const prompt = buildHistoricalPrompt(normalizedData, fuzzyResult);
          localPrompt = prompt;
          setLastPrompt(prompt);
          
          // Call our specialized AI function for historical analysis
          const aiResult = await analyzeHistoricalDataWithAI(prompt);
          
          // Store AI response
          const actualResponse = (aiResult as any).rawResponse || JSON.stringify(aiResult, null, 2);
          localResponse = actualResponse;
          setLastResponse(actualResponse);

          finalResult = aiResult;
          setResult(aiResult);
          
        } catch (aiError: any) {
          console.log('[HistoricalAI] AI analysis failed, using fuzzy rules fallback:', aiError?.message);
          finalResult = { ...fuzzyResult, source: 'rules' as any } as any;
          setResult(finalResult);
          localPrompt = `AI Analysis Failed: ${aiError?.message}\n\nFallback to fuzzy rules analysis.`;
          localResponse = `AI analysis failed: ${aiError?.message}\n\nUsing fuzzy rules analysis instead.`;
          setLastPrompt(localPrompt);
          setLastResponse(localResponse);
        }
      } else {
        // Rules-only analysis
        finalResult = fuzzyResult;
        setResult(finalResult);
        localPrompt = `Fuzzy Rules Analysis\n====================\n\nInput Data:\n${JSON.stringify(historicalData, null, 2)}`;
        localResponse = `Fuzzy Rules Results:\n${JSON.stringify(fuzzyResult, null, 2)}`;
        setLastPrompt(localPrompt);
        setLastResponse(localResponse);
      }

      // Persist using local variables to avoid stale state
      saveState({
        result: finalResult,
        timePeriod,
        selectedDate,
        lastPrompt: localPrompt || lastPrompt,
        lastResponse: localResponse || lastResponse,
        lastCalculations: calculations,
        lastPseudocode: pseudocode,
        analysisSource,
        customPrompt
      });

    } catch (error: any) {
      console.error('[HistoricalAI] Analysis failed:', error);
      setError(error?.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  // Recompute calculations and pseudocode when user changes fuzzy configs
  useEffect(() => {
    if (!historicalData) return;
    // Prefer existing normalized if available; otherwise normalize current
    const dataForCalc = normalizedDataState || normalizeHistoricalData(historicalData);
    const calculations = generateCalculationsExplanation(dataForCalc);
    const pseudocode = generateFuzzyLogicPseudocode(dataForCalc);
    setLastCalculations(calculations);
    setLastPseudocode(pseudocode);
  }, [configs, historicalData, normalizedDataState]);

  // Removed auto-run analysis - user must click Analyze button manually

  // Memoize sorted actions to prevent reordering on every render
  const sortedActions = useMemo(() => {
    if (!result?.actions) return [];
    return [...result.actions].sort((a, b) => {
      // Stable sort: first by type, then maintain original order
      if (a.type !== b.type) {
        return a.type === 'self' ? -1 : 1;
      }
      return 0;
    });
  }, [result?.actions]);



  // Structured Calculations Content with beautiful design
  const CalculationsDetails = ({ data }: { data: HistoricalData }) => {
    const stats = data?.stats || ({} as any);

    const goodPPoints = getFunctionPoints('good_p');
    const badPPoints = getFunctionPoints('bad_p');
    const zPh1GutPoints = getFunctionPoints('z_ph1_gut');
    const zPh2GutPoints = getFunctionPoints('z_ph2_gut');
    const zPh3GutPoints = getFunctionPoints('z_ph3_gut');
    const zPh4GutPoints = getFunctionPoints('z_ph4_gut');

    const originalStats: any = (data as any)?.originalStats;
    const normalizedForEvents: number | undefined = (data as any)?.normalizedForEvents;
    const burnDowns: number = (data as any)?.burnDowns || 0;
    const refuelEvents: number = (data as any)?.refuelEvents || 0;

    const latexFormulas = buildCalculationsLatex(data);

    return (
      <div className="space-y-6">

        {/* Configuration Section */}
        <div className="bg-info/10 p-4 border-l-2 border-info">
          <div className="flex items-center mb-3">
            <svg className="w-5 h-5 text-info mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h3 className="text-lg font-semibold text-foreground">Current Configuration</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { name: 'good_p', points: goodPPoints, default: '[50, 70]', desc: 'Performance threshold' },
              { name: 'bad_p', points: badPPoints, default: '[60, 80]', desc: 'Poor performance range' },
              { name: 'z_ph1_gut', points: zPh1GutPoints, default: '[300, 800]', desc: 'Ignition time (good)' },
              { name: 'z_ph2_gut', points: zPh2GutPoints, default: '[1000, 2400, 2520]', desc: 'Main burn time' },
              { name: 'z_ph3_gut', points: zPh3GutPoints, default: '[0, 5, 300]', desc: 'Refuel timing' },
              { name: 'z_ph4_gut', points: zPh4GutPoints, default: '[60, 180]', desc: 'Reheating time' }
            ].map(({ name, points, default: defaultVal, desc }) => (
              <div key={name} className="bg-card rounded-md p-3 border border-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-sm font-medium text-foreground">{name}</span>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm bg-info/20 px-2 py-1 rounded text-info">
                    [{points.join(', ')}]
                  </span>
                  <span className="text-xs text-muted-foreground">def: {defaultVal}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center text-sm text-info">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Use the 'Diagramme' button to modify these values
          </div>
        </div>

        {/* Input Data Section */}
        <div className="bg-success/10 p-4 border-l-2 border-success">
          <div className="flex items-center mb-3">
            <svg className="w-5 h-5 text-success mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-lg font-semibold text-foreground">{t('historicalAI.calculations.sections.inputData', 'Input Data')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-card rounded-md p-3 border border-border">
              <div className="text-xs text-success font-medium">{t('historicalAI.calculations.labels.period', 'Period')}</div>
              <div className="text-lg font-semibold text-foreground">{data.period}</div>
            </div>
            <div className="bg-card rounded-md p-3 border border-border">
              <div className="text-xs text-success font-medium">{t('historicalAI.calculations.labels.date', 'Date')}</div>
              <div className="text-lg font-semibold text-foreground">{data.date}</div>
            </div>
            {/* Removed device info display to protect privacy */}
          </div>
        </div>

        {/* Normalization Info */}
        {normalizedForEvents && normalizedForEvents > 1 && (
          <div className="bg-warning/10 p-4 border-l-2 border-warning">
            <div className="flex items-center mb-3">
              <svg className="w-5 h-5 text-warning mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <h3 className="text-lg font-semibold text-foreground">{t('historicalAI.calculations.sections.normalization', 'Z_PH Normalization Applied')}</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { param: 'z_ph1', divisor: `${normalizedForEvents} ${t('historicalAI.calculations.labels.burnEvents', 'burn events')}`, desc: t('historicalAI.calculations.parameters.ignitionTime', 'Ignition time per event') },
                { param: 'z_ph2', divisor: `${burnDowns} ${t('historicalAI.calculations.labels.burnDowns', 'burn-downs')}`, desc: t('historicalAI.calculations.parameters.mainBurnTime', 'Main burn time per burn-down') },
                { param: 'z_ph3', divisor: `${burnDowns} ${t('historicalAI.calculations.labels.burnDowns', 'burn-downs')}`, desc: t('historicalAI.calculations.parameters.refuelAction', 'Refuel action per burn-down') },
                { param: 'z_ph4', divisor: `${refuelEvents} ${t('historicalAI.calculations.labels.refuelEvents', 'refuel events')}`, desc: t('historicalAI.calculations.parameters.reheatingTime', 'Reheating per refuel') }
              ].map(({ param, divisor, desc }) => (
                <div key={param} className="bg-card rounded-md p-3 border border-border">
                  <div className="font-mono text-sm font-medium text-foreground">{param}</div>
                  <div className="text-xs text-warning">÷ {divisor}</div>
                  <div className="text-xs text-muted-foreground mt-1">{desc}</div>
                </div>
              ))}
            </div>
            {originalStats && (
              <div className="mt-3 p-2 bg-warning/20 rounded text-sm text-warning">
                <strong>{t('historicalAI.calculations.labels.example', 'Example')}:</strong> z_ph1 {String(originalStats?.z_ph1 ?? 'N/A')}s → {String(stats?.z_ph1 ?? 'N/A')}s per burn event
              </div>
            )}
          </div>
        )}

        {/* Performance Values */}
        <div className="bg-primary/10 p-4 border-l-2 border-primary">
          <div className="flex items-center mb-3">
            <svg className="w-5 h-5 text-primary mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3 className="text-lg font-semibold text-foreground">{t('historicalAI.calculations.sections.performanceTiming', 'Performance & Timing')}</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {[
              { label: t('historicalAI.calculations.parameters.overall', 'Overall (p)'), value: stats.p ?? 0, unit: '%' },
              { label: t('historicalAI.calculations.parameters.ignition', 'Ignition (p_ph1)'), value: stats.p_ph1 ?? 0, unit: '%' },
              { label: t('historicalAI.calculations.parameters.mainBurn', 'Main Burn (p_ph2)'), value: stats.p_ph2 ?? 0, unit: '%' },
              { label: t('historicalAI.calculations.parameters.refuel', 'Refuel (p_ph3)'), value: stats.p_ph3 ?? 0, unit: '%' },
              { label: t('historicalAI.calculations.parameters.reheat', 'Reheat (p_ph4)'), value: stats.p_ph4 ?? 0, unit: '%' }
            ].map(({ label, value, unit }) => (
              <div key={label} className="bg-card rounded-md p-3 border border-border text-center">
                <div className="text-xs text-primary font-medium mb-1">{label}</div>
                <div className="text-xl font-bold text-foreground">
                  {value}{unit}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'z_ph1', value: stats.z_ph1 ?? 0, original: originalStats?.z_ph1, norm: normalizedForEvents },
              { label: 'z_ph2', value: stats.z_ph2 ?? 0, original: originalStats?.z_ph2, norm: burnDowns },
              { label: 'z_ph3', value: stats.z_ph3 ?? 0, original: originalStats?.z_ph3, norm: burnDowns },
              { label: 'z_ph4', value: stats.z_ph4 ?? 0, original: originalStats?.z_ph4, norm: refuelEvents }
            ].map(({ label, value, original, norm }) => (
              <div key={label} className="bg-card rounded-md p-3 border border-border">
                <div className="text-xs text-primary font-medium">{label}</div>
                <div className="text-lg font-bold text-foreground">{value}s</div>
                {original && normalizedForEvents && normalizedForEvents > 1 && (
                  <div className="text-xs text-muted-foreground">
                    {t('historicalAI.calculations.labels.from', 'from')} {original}s ÷ {norm}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* B-Codes Calculations */}
        <div className="bg-success/10 p-4 border-l-2 border-success">
          <div className="flex items-center mb-4">
            <svg className="w-5 h-5 text-success mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-semibold text-foreground">{t('historicalAI.calculations.bCodesTitle', 'B-Codes Evaluation (B0-B13)')}</h3>
          </div>
          <div className="space-y-3">
            {generateBCodesCalculations(data).map((rule, i) => (
              <div key={i} className="bg-card rounded-lg p-4 border border-border">
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-foreground">{rule.title}</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${rule.triggered ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                      {rule.triggered ? `✓ ${t('historicalAI.calculations.triggered', 'Triggered')}` : `✗ ${t('historicalAI.calculations.notTriggered', 'Not triggered')}`}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mb-2">{rule.condition}</div>
                </div>
                <div className="space-y-1">
                  {rule.calculations.map((calc, j) => (
                    <div key={j} className="text-sm font-mono bg-muted p-2 rounded text-foreground">
                      {calc}
                    </div>
                  ))}
                </div>
                {rule.bCodes.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {rule.bCodes.map((bCode, k) => (
                      <div key={k} className="inline-flex items-center px-2 py-1 bg-success/20 text-success rounded text-xs">
                        <span className="font-medium">{bCode.code}</span>
                        <span className="ml-1">({bCode.value.toFixed(3)})</span>
                        <span className="ml-2 text-xs opacity-75">{bCode.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Mathematical Formulas */}
        <div className="bg-primary/10 p-4 border-l-2 border-primary">
          <div className="flex items-center mb-4">
            <svg className="w-5 h-5 text-primary mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h3 className="text-lg font-semibold text-foreground">{t('historicalAI.calculations.fuzzyTitle', 'Fuzzy Membership Functions')}</h3>
          </div>
          {latexFormulas.length > 0 ? (
            <div className="space-y-3">
              {latexFormulas.map((latex, i) => {
                // Create beautiful formatted math without KaTeX dependency
                const mathContent = latex
                  .replace(/\\mu/g, 'μ')
                  .replace(/\\text\{([^}]+)\}/g, '$1')
                  .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>')
                  .replace(/\\quad/g, ' ')
                  .replace(/\\geq/g, '≥')
                  .replace(/\\leq/g, '≤')
                  .replace(/\\_/g, '_')
                  .replace(/\{|\}/g, '');

                return (
                  <div key={i} className="bg-card rounded-lg p-4 border border-border">
                    <div
                      className="text-lg text-foreground font-serif math-formula"
                      dangerouslySetInnerHTML={{ __html: mathContent }}
                      style={{
                        fontFamily: 'Computer Modern, Times, serif',
                        lineHeight: '1.6'
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center p-8 text-muted-foreground">
              <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6 4h6m6 5H3a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v13a2 2 0 01-2 2z" />
              </svg>
              <p>{t('historicalAI.calculations.noFormulas', 'No mathematical formulas available for this dataset')}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- S5 Visualization helpers ---
  const getBValue = (code: string): number => {
    const bCodes: Array<{ code: string; value: number }> | undefined = visualBCodes.length ? visualBCodes : (result as any)?.bCodes;
    if (!Array.isArray(bCodes)) return 0;
    return bCodes.find(b => b.code === code)?.value ?? 0;
  };

  type DiagramSpec = {
    leftLabel: string;
    rightLabel: string;
    leftCode: string; // e.g. B3
    rightCode: string; // e.g. B2
    showMiddleOk: boolean; // whether to include B12 center weight
  };

  const computeXPercent = (
    leftWeight: number,
    okWeight: number | null,
    rightWeight: number
  ): number => {
    // Linear axis [0,1]; left at 0, right at 1, middle at 0.5
    const numerator = (leftWeight * 0) + (okWeight != null ? okWeight * 0.5 : 0) + (rightWeight * 1);
    const denominator = leftWeight + (okWeight != null ? okWeight : 0) + rightWeight;
    if (denominator <= 0) return 0.5; // neutral
    return numerator / denominator;
  };

  const formatNumber = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

  const urgencyColor = (u?: HistoricalRuleResult['urgency']) =>
    u === 'high' ? 'bg-destructive' : u === 'medium' ? 'bg-warning' : 'bg-success';

  // Format month option for display
  const formatMonthOption = (dateStr: string): string => {
    const [year, month] = dateStr.split('-');
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthNamesDE = [
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
    ];
    const names = i18n.language === 'de' ? monthNamesDE : monthNames;
    const monthName = names[parseInt(month) - 1] || month;
    return `${monthName} ${year}`;
  };

  // Format day option for display
  const formatDayOption = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString(i18n.language === 'de' ? 'de-DE' : 'en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const generateReport = () => {
    if (!result || !historicalData) return '';

    const timestamp = new Date().toLocaleString();
    const report = [
      `=== Historical Stove Analysis Report ===`,
      `Period: ${timePeriod} (${selectedDate})`,
      `Timestamp: ${timestamp}`,
      `Source: ${result.source || 'rules'}`,
      ``,
      `SUMMARY: ${result.summary}`,
      ...(user?.role === 'developer' ? [`PRIORITY: ${result.urgency.toUpperCase()}`] : []),
      ...(user?.role === 'developer' ? [`CONFIDENCE: ${Math.round(result.confidence * 100)}%`] : []),
      ``,
      ...(('bCodes' in result && result.bCodes?.length > 0) ? [
      `B-CODES DETECTED:`,
      ...result.bCodes.map((code: any) => 
        `${code.code}: ${code.description} (${Math.round(code.value * 100)}%)`
      ),
        ``
      ] : []),
      `ISSUES FOUND:`,
      ...result.hypotheses.map((h: any, i: number) => 
        `${i + 1}. ${h.issue} (${Math.round(h.probability * 100)}%)\n   Evidence: ${h.why?.join(', ') || 'None'}`
      ),
      ``,
      `RECOMMENDED ACTIONS:`,
      ...result.actions.map((a: any, i: number) => 
        `${i + 1}. [${a.type.toUpperCase()}] ${a.action}${a.eta_min ? ` (~${a.eta_min} min)` : ''}`
      ),
      ``,
      `STATISTICS:`,
      `Burn events: ${historicalData.stats.anz_be || 0}`,
      `Total duration: ${Math.round((historicalData.stats.anz_s || 0) / 3600)} hours`,
      `Average performance: ${historicalData.stats.p || 0}%`,
      `Average temperature: ${historicalData.stats.t || 0}°C`,
      ``,
      `Note: Historical analysis based on aggregated stove data. Results may vary from real-time diagnostics.`
    ].filter(Boolean).join('\n');

    return report;
  };

  const copyReport = () => {
    const report = generateReport();
    try {
      navigator.clipboard?.writeText(report);
    } catch (e) {
      console.error('Failed to copy report:', e);
    }
  };

  return (
    <div className={`bg-card border-2 border-border rounded-md p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <div>
            <h4 className="text-base font-semibold text-foreground">{t('historicalAI.title', 'Historische Analyse')}</h4>
            <div className="flex items-center gap-2 mt-1">
              {result && (
                <span className="text-xs px-2 py-0.5 rounded bg-background text-primary border border-border">
                  {t('ai.source', 'Source')}: {result.source || 'rules'}
                </span>
              )}
              {isCollapsed && result && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  result.urgency === 'high' ? 'bg-destructive/20 text-destructive border border-destructive/40' :
                  result.urgency === 'medium' ? 'bg-warning/20 text-warning border border-warning/40' :
                  'bg-success/20 text-success border border-success/40'
                }`}>
                  {result.urgency.toUpperCase()}{user?.role === 'developer' ? ` (${Math.round(result.confidence * 100)}%)` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Analysis source selector */}
          <div className="flex items-center gap-1 mr-2">
            <span className="text-xs text-muted-foreground">Source:</span>
            <select
              value={analysisSource}
              onChange={(e) => setAnalysisSource(e.target.value as 'ai' | 'rules')}
              className="text-xs px-2 py-1 border border-border bg-background text-foreground"
            >
              <option value="rules">Fuzzy Rules</option>
              <option value="ai">AI + Fuzzy</option>
            </select>
          </div>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2 hover:bg-primary/10"
            title={isCollapsed ? t('actions.expand', 'Expand') : t('actions.collapse', 'Collapse')}
          >
            <svg className={`w-4 h-4 text-primary transition-transform ${
              isCollapsed ? 'rotate-180' : ''
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            onClick={runAnalysis}
            disabled={loading || !deviceId || !selectedDate}
            className="inline-flex items-center px-3 py-2 text-xs bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed font-medium border-b-2 border-primary/70"
          >
            {loading ? (
              <>
                <svg className="w-3 h-3 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t('loading', 'Loading...')}
              </>
            ) : (
              <>
                <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t('actions.analyze', 'Analyze')}
              </>
            )}
          </button>

          <button
            onClick={() => setShowReportModal(true)}
            disabled={!result}
            className="inline-flex items-center px-3 py-2 text-xs rounded-sm bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {t('stoveInfo.copyReport', 'Bericht')}
          </button>

          <button
            onClick={() => setShowFuzzyVisualizer(true)}
            className="inline-flex items-center px-3 py-2 text-xs bg-primary/20 hover:bg-primary/30 text-primary font-medium border border-primary/40"
            title="Configure fuzzy membership functions"
          >
            <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Diagramme
          </button>
          
          {result && (
            <div className="relative">
              <button
                onClick={() => setShowActionsDropdown(!showActionsDropdown)}
                className="px-3 py-1.5 text-xs rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors font-medium inline-flex items-center justify-center gap-1"
                title="Show analysis actions"
              >
                Actions
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showActionsDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-card rounded-lg shadow-lg border border-border z-10 min-w-[140px]">
                  <div className="py-1">
                    <button
                      onClick={() => setShowPromptModal(true)}
                      disabled={!lastPrompt}
                      className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      title={lastPrompt ? 'View prompt data' : 'No prompt available'}
                    >
                      Prompt
                    </button>
                    <button
                      onClick={() => setShowCalculationsModal(true)}
                      disabled={!historicalData && !normalizedDataState}
                      className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      title="View fuzzy calculations breakdown"
                    >
                      Calculations
                    </button>
                    <button
                      onClick={() => setShowPseudocodeModal(true)}
                      disabled={!lastPseudocode}
                      className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      title="View fuzzy logic pseudocode"
                    >
                      Logic
                    </button>
                    {analysisSource === 'ai' && (
                      <button
                        onClick={() => setShowResponseModal(true)}
                        disabled={!lastResponse}
                        className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                        title={lastResponse ? 'View AI response' : 'No response available'}
                      >
                        Response
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Time period and date selection */}
      {!isCollapsed && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Period:</span>
            <select
              value={timePeriod}
              onChange={(e) => setTimePeriod(e.target.value as 'daily' | 'monthly' | 'yearly')}
              className="text-sm px-3 py-1.5 rounded-lg border border-border bg-background text-foreground"
            >
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Date:</span>
            <div className="relative">
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                disabled={loadingDates || availableDates.length === 0}
                className="text-sm px-3 py-1.5 pr-8 rounded-lg border border-border bg-background text-foreground disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px]"
              >
                {loadingDates ? (
                  <option value="">Loading dates...</option>
                ) : availableDates.length === 0 ? (
                  <option value="">No data available</option>
                ) : (
                  availableDates.map(date => (
                    <option key={date} value={date}>
                      {timePeriod === 'yearly' ? date : 
                       timePeriod === 'monthly' ? formatMonthOption(date) : 
                       formatDayOption(date)}
                    </option>
                  ))
                )}
              </select>
              {loadingDates && (
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                  <svg className="w-4 h-4 animate-spin text-info" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {!isCollapsed && error && (
        <div className="bg-destructive/10 border border-destructive/40 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-destructive">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium">Analysis Failed</span>
          </div>
          <p className="text-xs text-destructive mt-1">{error}</p>
          {availableDates.length > 0 && (
            <p className="text-xs text-destructive mt-2">
              Try selecting a different date from the dropdown above. Available: {availableDates.length} period(s)
            </p>
          )}
          {availableDates.length === 0 && !loadingDates && (
            <p className="text-xs text-destructive mt-2">
              No historical data found for this stove. Data may not have been collected yet or the stove is new.
            </p>
          )}
        </div>
      )}

      {!isCollapsed && !loading && !error && result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-card/70 rounded-lg p-3 border border-border/50">
            <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
          </div>

          {/* Visualization (six diagrams with weighted mean) */}
          <div className="space-y-3">
            <h5 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <svg className="w-4 h-4 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2" />
              </svg>
              Visualisierung
            </h5>
            {(() => {
              const diagrams: DiagramSpec[] = [
                { leftLabel: 'Holz zu trocken', rightLabel: 'Holz zu feucht', leftCode: 'B3', rightCode: 'B2', showMiddleOk: true },
                { leftLabel: 'zu wenig Holz', rightLabel: 'zu viel Holz', leftCode: 'B0', rightCode: 'B1', showMiddleOk: true },
                { leftLabel: 'Scheite zu klein', rightLabel: 'Scheite zu groß', leftCode: 'B5', rightCode: 'B4', showMiddleOk: true },
                { leftLabel: 'Zu früh nachgelegt', rightLabel: 'Zu spät nachgelegt', leftCode: 'B6', rightCode: 'B7', showMiddleOk: true },
                { leftLabel: 'Zug zu gering', rightLabel: 'Zug zu hoch', leftCode: 'B10', rightCode: 'B11', showMiddleOk: true },
                { leftLabel: 'Generell schlecht', rightLabel: 'Generell gut', leftCode: 'B9', rightCode: 'B8', showMiddleOk: false },
              ];
              const okWeight = getBValue('B12');
              return (
                <div className="space-y-3">
                  {diagrams.map((d, idx) => {
                    const l = getBValue(d.leftCode);
                    const r = getBValue(d.rightCode);
                    const denominator = l + (d.showMiddleOk ? okWeight : 0) + r;
                    const x = computeXPercent(l, d.showMiddleOk ? okWeight : null, r);
                    const percent = Math.round(x * 100);
                    const latex = denominator > 0
                      ? (d.showMiddleOk
                        ? `x = \\frac{${d.leftCode}\\cdot 0 + B12\\cdot \\tfrac{1}{2} + ${d.rightCode}\\cdot 1}{${d.leftCode} + B12 + ${d.rightCode}} = \\frac{${formatNumber(l)}\\cdot 0 + ${formatNumber(okWeight)}\\cdot \\tfrac{1}{2} + ${formatNumber(r)}\\cdot 1}{${formatNumber(l)} + ${formatNumber(okWeight)} + ${formatNumber(r)}} = ${formatNumber(x)}`
                        : `x = \\frac{${d.leftCode}\\cdot 0 + ${d.rightCode}\\cdot 1}{${d.leftCode} + ${d.rightCode}} = \\frac{${formatNumber(l)}\\cdot 0 + ${formatNumber(r)}\\cdot 1}{${formatNumber(l)} + ${formatNumber(r)}} = ${formatNumber(x)}`)
                      : `x = \\text{undefiniert}\\ (\\text{alle Gewichte}=0) \\Rightarrow 0.50`;
                    return (
                      <div key={idx} className="grid grid-cols-1 gap-1">
                        {/* Top numeric chips */}
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-card/70 border border-border text-[10px]">{d.leftCode}: {formatNumber(l)}</span>
                          <span className="ml-auto px-1.5 py-0.5 rounded bg-card/70 border border-border text-[10px]">{d.rightCode}: {formatNumber(r)}</span>
                        </div>
                        <div className="relative h-6 rounded-md overflow-hidden border border-border" style={{ background: 'linear-gradient(90deg, var(--destructive) 0%, var(--success) 50%, var(--destructive) 100%)' }}>
                          {/* Left/Right boundaries */}
                          <div className="absolute left-0 top-0 h-full w-px bg-white/60" />
                          <div className="absolute right-0 top-0 h-full w-px bg-white/60" />
                          {/* Center OK marker (dashed) */}
                          {d.showMiddleOk && (
                            <div className="absolute left-1/2 top-0 h-full" style={{ borderLeft: '1px dashed rgba(255,255,255,0.5)' }} />
                          )}
                          {/* Dynamic result marker (vertical line) with borders */}
                          <div
                            className="absolute top-0 bottom-0 w-[3px] bg-info"
                            style={{
                              left: `calc(${percent}% - 1.5px)`,
                              zIndex: 10,
                              boxShadow: '0 0 0 1px #333333'
                            }}
                          />
                          {/* Tiny label over x position */}
                          <div className="absolute -top-3 text-[10px] font-semibold text-info" style={{ left: `calc(${percent}% - 4px)`, zIndex: 20 }}>x</div>
                          {/* Indicator triangle */}
                          <div className="absolute -top-2" style={{ left: `calc(${percent}% - 6px)` }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" className="text-info">
                              <path fill="currentColor" d="M12 4l6 10H6z" />
                            </svg>
                          </div>
                          {/* Axis labels */}
                          <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] font-medium text-white/90">
                            <span>{d.leftCode}</span>
                            {d.showMiddleOk && <span>ok</span>}
                            <span>{d.rightCode}</span>
                          </div>
                        </div>
                        {/* Bottom labels */}
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="font-medium">{d.leftLabel}</span>
                          <span className="font-medium">{d.rightLabel}</span>
                        </div>
                        <div
                          className="text-[11px] text-muted-foreground mt-0.5"
                          dangerouslySetInnerHTML={{ __html: renderLatexHTML(latex + (katexReady ? '' : '')) }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Status Indicators */}
          <div className="flex items-center gap-3">
            {user?.role === 'developer' && (
            <div className="flex items-center gap-2">
              <span className={`text-xs text-white px-3 py-1 font-medium ${urgencyColor(result.urgency)}`}>
                {result.urgency.toUpperCase()} PRIORITY
              </span>
            </div>
            )}
            {user?.role === 'developer' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">Confidence:</span>
              <div className="w-20 h-2 bg-muted">
                <div
                  className="h-2 bg-primary"
                  style={{ width: `${Math.round(result.confidence * 100)}%` }}
                />
              </div>
              <span className="font-semibold">{Math.round(result.confidence * 100)}%</span>
            </div>
            )}
          </div>

          {/* Diagnostic Codes (hidden by default). Remove 'false &&' to show. */}
          {false && (result as any)?.bCodes && (result as any).bCodes.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h4a1 1 0 011 1v2h4a1 1 0 110 2h-1v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6H3a1 1 0 110-2h4zM6 6v12h8V6H6zm3 3a1 1 0 112 0v6a1 1 0 11-2 0V9z" />
                </svg>
                {t('historicalAI.bCodes', 'Diagnostic Codes')}
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(result as any).bCodes.map((bCode: any, i: number) => (
                  <div key={i} className="bg-card/50 rounded-lg p-3 border border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground">{bCode.code}</span>
                      <span className="text-xs font-semibold text-primary">
                        {Math.round(bCode.value * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{bCode.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hypotheses */}
          {result.hypotheses && result.hypotheses.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                {t('ai.possibleIssues', 'Possible Issues')}
              </h5>
              <div className="space-y-2">
                {result.hypotheses.slice(0, 3).map((h: any, i: number) => (
                  <div key={i} className="bg-card/50 rounded-lg p-3 border border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground">{h.issue}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-muted">
                          <div
                            className="h-2 bg-warning"
                            style={{ width: `${Math.round(h.probability * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">
                          {Math.round(h.probability * 100)}%
                        </span>
                      </div>
                    </div>
                    {h.why && h.why.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Evidence:</span> {h.why.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {result.actions && result.actions.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Recommended Actions
              </h5>
              <div className="space-y-2">
                {sortedActions.map((a, i) => (
                  <div key={`${a.type}-${a.action.substring(0, 20)}-${i}`} className="bg-card/50 rounded-lg p-3 border border-border/50">
                    <div className="flex items-start gap-3">
                      <span className={`text-xs px-2 py-1 font-medium ${
                        a.type === 'self'
                          ? 'bg-success/20 text-success'
                          : 'bg-warning/20 text-warning'
                      }`}>
                        {a.type === 'self' ? 'Self-Service' : 'Contact Support'}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm text-foreground">{a.action}</p>
                        {typeof a.eta_min === 'number' && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Estimated time: ~{a.eta_min} minutes
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Statistics summary */}
          {historicalData && (
            <div className="bg-card/50 rounded-lg p-3 border border-border/50">
              <h5 className="text-sm font-semibold text-foreground mb-2">Data Summary</h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Burn Events:</span>
                  <div className="font-medium text-foreground">{historicalData.stats.anz_be || 0}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Hours:</span>
                  <div className="font-medium text-foreground">{Math.round((historicalData.stats.anz_s || 0) / 3600)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg Performance:</span>
                  <div className="font-medium text-foreground">{historicalData.stats.p || 0}%</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg Temp:</span>
                  <div className="font-medium text-foreground">{historicalData.stats.t || 0}°C</div>
                </div>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="bg-warning/10 border border-warning/40 rounded-lg p-3">
            <div className="flex items-center gap-2 text-warning">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs font-medium">Important:</span>
            </div>
            <p className="text-xs text-warning mt-1">
              Historical analysis based on aggregated data over the selected time period. Results complement real-time diagnostics but may not reflect current stove status.
            </p>
          </div>
        </div>
      )}
      
      {/* Modal Windows */}
      {/* Prompt Modal */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowPromptModal(false)}>
          <div className="bg-card rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-section-header text-section-header-foreground p-3 border-b-2 border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <h3 className="text-lg font-semibold">{analysisSource === 'ai' ? 'AI Prompt' : 'Fuzzy Rules Input Data'}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {analysisSource === 'ai' && (
                    <button
                      onClick={() => setEditingPrompt(!editingPrompt)}
                      className="px-3 py-1 text-xs bg-white/20 hover:bg-white/30 text-section-header-foreground rounded-md transition-all"
                    >
                      {editingPrompt ? 'Save' : 'Edit'}
                    </button>
                  )}
                  <button
                    onClick={() => setShowPromptModal(false)}
                    className="p-1.5 text-section-header-foreground hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              <div className="p-4">
                <div className="bg-muted rounded-lg p-3">
                  {editingPrompt && analysisSource === 'ai' ? (
                    <textarea
                      value={customPrompt || getDefaultHistoricalPrompt()}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      className="w-full h-[60vh] text-xs text-foreground bg-background border border-border rounded p-2 font-mono leading-relaxed resize-none"
                      placeholder="Enter your custom prompt here..."
                    />
                  ) : (
                    <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{lastPrompt}</pre>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-muted border-t border-border p-3 flex items-center justify-end gap-2">
              {editingPrompt && (
                <button
                  onClick={() => {
                    setCustomPrompt('');
                    setEditingPrompt(false);
                  }}
                  className="px-3 py-1 text-xs bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
                >
                  Reset to Default
                </button>
              )}
              <button
                onClick={() => navigator.clipboard?.writeText(lastPrompt)}
                className="px-3 py-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-md transition-colors"
              >
                Copy
              </button>
              <button
                onClick={() => setShowPromptModal(false)}
                className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-sm text-sm border-b-2 border-primary/70"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Calculations Modal */}
      {showCalculationsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowCalculationsModal(false)}>
          <div className="bg-card rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-border bg-primary/10">
              <div className="flex items-center">
                <svg className="w-6 h-6 text-primary mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <h3 className="text-xl font-bold text-foreground">Fuzzy Rules Calculations</h3>
              </div>
              <button
                onClick={() => setShowCalculationsModal(false)}
                className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(90vh-80px)] p-6">
              <CalculationsDetails data={(normalizedDataState || historicalData || { period: 'daily', date: '', deviceId: '', stats: {} }) as HistoricalData} />
            </div>
          </div>
        </div>
      )}
      
      {/* Pseudocode Modal */}
      {showPseudocodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowPseudocodeModal(false)}>
          <div className="bg-card rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-section-header text-section-header-foreground p-3 border-b-2 border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  <h3 className="text-lg font-semibold">Fuzzy Logic Pseudocode</h3>
                </div>

                <button
                  onClick={() => setShowPseudocodeModal(false)}
                  className="p-1.5 text-section-header-foreground hover:bg-white/20 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              <div className="p-4">
                {/* Code Display */}
                <div className="bg-muted rounded-md border border-border overflow-hidden">
                  <div className="bg-muted px-3 py-2 border-b border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 bg-destructive"></div>
                          <div className="w-3 h-3 bg-warning"></div>
                          <div className="w-3 h-3 bg-success"></div>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                          fuzzy_logic_algorithm.pseudo
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const textarea = document.createElement('textarea');
                            textarea.value = lastPseudocode;
                            document.body.appendChild(textarea);
                            textarea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textarea);
                          }}
                          className="text-xs bg-muted hover:bg-muted/80 text-foreground px-2 py-0.5 rounded transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 max-h-[70vh] overflow-auto">
                    <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed tracking-wide">
                      {lastPseudocode}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-muted border-t border-border p-3 flex justify-end">
              <button
                onClick={() => setShowPseudocodeModal(false)}
                className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-sm text-sm border-b-2 border-primary/70"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Response Modal */}
      {showResponseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowResponseModal(false)}>
          <div className="bg-card rounded-lg p-6 max-w-4xl max-h-[80vh] overflow-auto m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">AI Response</h3>
              <button onClick={() => setShowResponseModal(false)} className="text-muted-foreground hover:text-foreground">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="bg-muted rounded-lg p-4">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{lastResponse}</pre>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => navigator.clipboard?.writeText(lastResponse)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Copy Response
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Report Modal */}
      {showReportModal && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md" onClick={() => setShowReportModal(false)}>
          <div className="bg-card rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-section-header text-section-header-foreground p-3 border-b-2 border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <h3 className="text-lg font-semibold">Historical Analysis Report</h3>
                </div>
                <button onClick={() => setShowReportModal(false)} className="p-1.5 text-section-header-foreground hover:bg-white/20 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              <div className="p-4">
                <div className="bg-muted rounded-md border border-border overflow-hidden">
                  <div className="bg-muted px-3 py-2 border-b border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 bg-destructive"></div>
                          <div className="w-3 h-3 bg-warning"></div>
                          <div className="w-3 h-3 bg-success"></div>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">historical_analysis_report.txt</span>
                      </div>
                      <button
                        onClick={() => copyReport()}
                        className="text-xs bg-muted hover:bg-muted/80 text-foreground px-2 py-0.5 rounded transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="p-4 max-h-[70vh] overflow-auto">
                    <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed tracking-wide">
{generateReport()}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-muted border-t border-border p-3 flex justify-end">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md transition-all duration-200 text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fuzzy Membership Visualizer */}
      <FuzzyMembershipVisualizer
        isOpen={showFuzzyVisualizer}
        onClose={() => setShowFuzzyVisualizer(false)}
      />
    </div>
  );
};

export default HistoricalAIAnalysisCard;
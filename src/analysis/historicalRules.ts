// Historical analysis using fuzzy membership functions and B-code diagnostics
// Based on Firestore statistics: /statistik_monat_tage/<deviceId>/<jahr>/<monat>/<tag>/

export interface HistoricalData {
  period: 'daily' | 'monthly' | 'yearly';
  date: string;
  deviceId: string;
  stats: {
    anz_be?: number; // Anzahl Brennereignisse (number of burn events)
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
  };
}

export interface BCode {
  code: string;
  description: string;
  value: number; // 0-1 membership value
}

export interface HistoricalRuleIssue {
  issue: string;
  probability: number;
  why: string[];
}

export interface HistoricalRuleAction {
  action: string;
  type: 'self' | 'support';
  eta_min: number | null;
}

export interface HistoricalRuleResult {
  summary: string;
  urgency: 'low' | 'medium' | 'high';
  confidence: number;
  hypotheses: HistoricalRuleIssue[];
  actions: HistoricalRuleAction[];
  bCodes: BCode[];
  used_signals: string[];
  source: 'historical_rules';
}

// Fuzzy membership functions (piecewise linear)
class FuzzyMembership {
  // Performance functions (for p, p_ph1..p_ph4, in %)
  static good_p(x: number): number {
    if (x <= 50) return 0;
    if (x < 70) return (x - 50) / (70 - 50);
    return 1;
  }

  static bad_p(x: number): number {
    if (x <= 60) return 1;
    if (x < 80) return (80 - x) / (80 - 60);
    return 0;
  }

  // Ignition time z_ph1
  static z_ph1_gut(x: number): number {
    if (x <= 300) return 1;
    if (x < 800) return (800 - x) / (800 - 300);
    return 0;
  }

  static z_ph1_schlecht(x: number): number {
    if (x <= 300) return 0;
    if (x < 800) return (x - 300) / (800 - 300);
    return 1;
  }

  // Main-burn time z_ph2
  static z_ph2_gut(x: number): number {
    if (x <= 1000) return 0;
    if (x <= 2400) return (x - 1000) / (2400 - 1000);
    if (x <= 2520) return (2520 - x) / (2520 - 2400);
    return 0;
  }

  static z_ph2_schlecht1(x: number): number { // too short
    if (x <= 1000) return 1;
    if (x < 2400) return (2400 - x) / (2400 - 1000);
    return 0;
  }

  static z_ph2_schlecht2(x: number): number { // too long
    if (x <= 2400) return 0;
    if (x <= 2520) return (x - 2400) / (2520 - 2400);
    return 1;
  }

  // Refuel action time z_ph3
  static z_ph3_gut(x: number): number {
    if (x <= 0) return 0;
    if (x <= 5) return (x - 0) / (5 - 0);
    if (x <= 300) return (300 - x) / (300 - 5);
    return 0;
  }

  static z_ph3_schlecht1(x: number): number { // too early/too short
    if (x <= 0) return 1;
    if (x <= 5) return (5 - x) / (5 - 0);
    return 0;
  }

  static z_ph3_schlecht2(x: number): number { // too late/too long
    if (x <= 5) return 0;
    if (x <= 300) return (x - 5) / (300 - 5);
    return 1;
  }

  // Re-heating time z_ph4
  static z_ph4_gut(x: number): number {
    if (x <= 60) return 1;
    if (x <= 180) return (180 - x) / (180 - 60);
    return 0;
  }

  static z_ph4_schlecht(x: number): number {
    if (x <= 60) return 0;
    if (x <= 180) return (x - 60) / (180 - 60);
    return 1;
  }
}

// Helper functions for fuzzy logic
const fuzzyAnd = (...values: number[]): number => {
  return values.reduce((acc, val) => acc * val, 1);
};

const fuzzyOr = (...values: number[]): number => {
  return Math.max(...values);
};

// B-code descriptions in multiple languages
const B_CODE_DESCRIPTIONS = {
  de: {
    'B0': 'zu wenig Holz',
    'B1': 'zu viel Holz',
    'B2': 'Holz zu feucht',
    'B3': 'Holz zu trocken',
    'B4': 'Holzscheite zu groß',
    'B5': 'Holzscheite zu klein',
    'B6': 'zu früh nachgelegt',
    'B7': 'zu spät nachgelegt',
    'B8': 'generell gute Feuerung',
    'B9': 'generell schlechte Feuerung',
    'B10': 'Rigzug zu schwach',
    'B11': 'Rigzug zu stark',
    'B12': 'Brennstoff ist geeignet',
    'B13': 'richtig nachgelegt'
  },
  en: {
    'B0': 'too little wood',
    'B1': 'too much wood',
    'B2': 'wood too wet',
    'B3': 'wood too dry',
    'B4': 'logs too large',
    'B5': 'logs too small',
    'B6': 'refueled too early',
    'B7': 'refueled too late',
    'B8': 'generally good combustion',
    'B9': 'generally poor combustion',
    'B10': 'chimney draft too low',
    'B11': 'chimney draft too high',
    'B12': 'fuel is appropriate',
    'B13': 'refueled correctly'
  }
};

// Calculate membership using same logic as visualizer (for multi-point functions)
const calculateVisualizerMembership = (x: number, points: number[], functionName: string): number => {
  if (points.length < 2) return 0;
  
  // Linear function (2 points)
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
      // Special handling for z_ph2_schlecht (combined schlecht1 + schlecht2)
      if (functionName === 'z_ph2_schlecht') {
        // z_ph2_schlecht: high at both ends (too short OR too long)
        if (x <= p1) return 1; // too short
        if (x >= p2) return 1; // too long
        return 0; // good range
      }
      // Normal schlecht: 0 at start, 1 at end
      if (x <= p1) return 0;
      if (x >= p2) return 1;
      return (x - p1) / (p2 - p1);
    }
  }
  
  // Triangular/inverted-triangular function (3+ points)
  if (points.length >= 3) {
    const sortedPoints = [...points].sort((a, b) => a - b);
    const start = sortedPoints[0];
    const peakOrValley = sortedPoints[Math.floor(sortedPoints.length / 2)];
    const end = sortedPoints[sortedPoints.length - 1];

    // Special case: z_ph2_schlecht should be inverted triangular (high at both ends)
    if (functionName === 'z_ph2_schlecht') {
      if (x <= start) return 1;
      if (x >= end) return 1;
      if (x === peakOrValley) return 0;
      if (x < peakOrValley) return 1 - (x - start) / (peakOrValley - start);
      return 1 - (end - x) / (end - peakOrValley);
    }

    // Default triangular (peak at middle = 1)
    if (x <= start || x >= end) return 0;
    if (x === peakOrValley) return 1;
    if (x < peakOrValley) return (x - start) / (peakOrValley - start);
    return (end - x) / (end - peakOrValley);
  }
  
  return 0;
};

// Dynamic fuzzy membership calculation using custom config
const calculateCustomMembership = (x: number, functionName: string, customFuzzyConfig?: any): number => {
  if (!customFuzzyConfig) {
    // Fallback to static functions if no custom config
    const staticFunction = (FuzzyMembership as any)[functionName];
    if (typeof staticFunction === 'function') {
      return staticFunction(x);
    }
    return 0;
  }
  
  try {
    const points = customFuzzyConfig(functionName);
    if (!points || points.length < 2) {
      // Fallback to static if no valid custom points
      const staticFunction = (FuzzyMembership as any)[functionName];
      if (typeof staticFunction === 'function') {
        return staticFunction(x);
      }
      return 0;
    }
    
    // Use unified calculation for all point configurations
    return calculateVisualizerMembership(x, points, functionName);
  } catch (error) {
    console.warn('Error calculating custom membership for', functionName, error);
    const staticFunction = (FuzzyMembership as any)[functionName];
    if (typeof staticFunction === 'function') {
      return staticFunction(x);
    }
    return 0;
  }
};

export const runHistoricalRules = (data: HistoricalData, locale: 'de' | 'en' = 'en', customFuzzyConfig?: any): HistoricalRuleResult => {
  const issues: HistoricalRuleIssue[] = [];
  const actions: HistoricalRuleAction[] = [];
  const bCodes: BCode[] = [];
  const used: string[] = [];

  const stats = data.stats;

  // Extract fuzzy values for each parameter
  const p = stats.p || 0;
  const p_ph1 = stats.p_ph1 || 0;
  const p_ph2 = stats.p_ph2 || 0;
  const p_ph3 = stats.p_ph3 || 0;
  const p_ph4 = stats.p_ph4 || 0;

  const z_ph1 = stats.z_ph1 || 0;
  const z_ph2 = stats.z_ph2 || 0;
  const z_ph3 = stats.z_ph3 || 0;
  const z_ph4 = stats.z_ph4 || 0;

  // Calculate membership values for performance using custom or static functions
  const p_gut = calculateCustomMembership(p, 'good_p', customFuzzyConfig);
  const p_ph1_gut = calculateCustomMembership(p_ph1, 'good_p', customFuzzyConfig);
  const p_ph1_schlecht = calculateCustomMembership(p_ph1, 'bad_p', customFuzzyConfig);
  const p_ph2_gut = calculateCustomMembership(p_ph2, 'good_p', customFuzzyConfig);
  const p_ph2_schlecht = calculateCustomMembership(p_ph2, 'bad_p', customFuzzyConfig);
  const p_ph4_gut = calculateCustomMembership(p_ph4, 'good_p', customFuzzyConfig);
  const p_ph4_schlecht = calculateCustomMembership(p_ph4, 'bad_p', customFuzzyConfig);

  // Calculate membership values for times using custom or static functions
  const z_ph1_gut = calculateCustomMembership(z_ph1, 'z_ph1_gut', customFuzzyConfig);
  const z_ph1_schlecht = calculateCustomMembership(z_ph1, 'z_ph1_schlecht', customFuzzyConfig);
  // const z_ph2_gut = calculateCustomMembership(z_ph2, 'z_ph2_gut', customFuzzyConfig); // can be enabled for extended rule sets
  const z_ph2_schlecht1 = calculateCustomMembership(z_ph2, 'z_ph2_schlecht', customFuzzyConfig); // Combined z_ph2_schlecht
  const z_ph2_schlecht2 = calculateCustomMembership(z_ph2, 'z_ph2_schlecht', customFuzzyConfig); // Same function for both
  const z_ph3_gut = calculateCustomMembership(z_ph3, 'z_ph3_gut', customFuzzyConfig);
  // Correctly distinguish early (schlecht1) vs late (schlecht2) refueling
  const z_ph3_schlecht1 = calculateCustomMembership(z_ph3, 'z_ph3_schlecht1', customFuzzyConfig);
  const z_ph3_schlecht2 = calculateCustomMembership(z_ph3, 'z_ph3_schlecht2', customFuzzyConfig);
  const z_ph4_gut = calculateCustomMembership(z_ph4, 'z_ph4_gut', customFuzzyConfig);
  const z_ph4_schlecht = calculateCustomMembership(z_ph4, 'z_ph4_schlecht', customFuzzyConfig);

  // Rule base implementation following the exact specification
  
  // Rule 1: ((p_ph1_schlecht ∧ z_ph1_schlecht) ∨ (p_ph4_schlecht ∧ z_ph4_schlecht)) ∧ z_ph2_schlecht1
  // → "Rig kommt nicht auf Temperatur" → B0, B2, B4, B10
  const rule1_condition = fuzzyAnd(
    fuzzyOr(
      fuzzyAnd(p_ph1_schlecht, z_ph1_schlecht),
      fuzzyAnd(p_ph4_schlecht, z_ph4_schlecht)
    ),
    z_ph2_schlecht1
  );

  if (rule1_condition > 0.1) {
    const desc = locale === 'de' ? 'Rig kommt nicht auf Temperatur' : 'Rig not reaching temperature';
    issues.push({
      issue: desc,
      probability: rule1_condition,
      why: [
        `ignition_perf (p_ph1)=${p_ph1.toFixed(1)}%`,
        `ignition_time (z_ph1)=${z_ph1}s`,
        `reheating_perf (p_ph4)=${p_ph4.toFixed(1)}%`,
        `reheating_time (z_ph4)=${z_ph4}s`,
        `burn_time (z_ph2)=${z_ph2}s`
      ]
    });

    bCodes.push(
      { code: 'B0', description: B_CODE_DESCRIPTIONS[locale]['B0'], value: z_ph2_schlecht1 },
      { code: 'B2', description: B_CODE_DESCRIPTIONS[locale]['B2'], value: z_ph2_schlecht1 },
      { code: 'B4', description: B_CODE_DESCRIPTIONS[locale]['B4'], value: z_ph2_schlecht1 },
      { code: 'B10', description: B_CODE_DESCRIPTIONS[locale]['B10'], value: z_ph2_schlecht1 }
    );

    actions.push({
      action: locale === 'de' ? 'Holzmenge und -qualität prüfen, Rigzug überprüfen' : 'Check wood quantity and quality, verify chimney draft',
      type: 'self',
      eta_min: 15
    });
  }

  // Rule 2: (z_ph1_gut ∨ z_ph4_gut) ∧ z_ph2_schlecht1
  // → "Rig brennt nach An- oder Aufheizen zu schnell" → B3, B5
  const rule2_condition = fuzzyAnd(
    fuzzyOr(z_ph1_gut, z_ph4_gut),
    z_ph2_schlecht1
  );

  if (rule2_condition > 0.1) {
    const desc = locale === 'de' ? 'Rig brennt nach An- oder Aufheizen zu schnell' : 'Rig burns too fast after ignition or reheating';
    issues.push({
      issue: desc,
      probability: rule2_condition,
      why: [
        `ignition_time (z_ph1)=${z_ph1}s`,
        `reheating_time (z_ph4)=${z_ph4}s`,
        `burn_time (z_ph2)=${z_ph2}s`
      ]
    });

    bCodes.push(
      { code: 'B3', description: B_CODE_DESCRIPTIONS[locale]['B3'], value: z_ph2_schlecht1 },
      { code: 'B5', description: B_CODE_DESCRIPTIONS[locale]['B5'], value: z_ph2_schlecht1 }
    );

    actions.push({
      action: locale === 'de' ? 'Trockenheitsgrad des Holzes prüfen, kleinere Scheite verwenden' : 'Check wood dryness, use smaller logs',
      type: 'self',
      eta_min: 10
    });
  }

  // Rule 3: z_ph2_schlecht2 ∧ p_ph2_gut
  // → "Rig brennt zu lange" → B1
  const rule3_condition = fuzzyAnd(z_ph2_schlecht2, p_ph2_gut);

  if (rule3_condition > 0.1) {
    const desc = locale === 'de' ? 'Rig brennt zu lange' : 'Rig burns too long';
    issues.push({
      issue: desc,
      probability: rule3_condition,
      why: [
        `burn_time (z_ph2)=${z_ph2}s`,
        `burn_performance (p_ph2)=${p_ph2.toFixed(1)}%`
      ]
    });

    bCodes.push({
      code: 'B1',
      description: B_CODE_DESCRIPTIONS[locale]['B1'],
      value: fuzzyAnd(z_ph2_schlecht2, p_ph2_gut)
    });

    actions.push({
      action: locale === 'de' ? 'Holzmenge reduzieren' : 'Reduce wood quantity',
      type: 'self',
      eta_min: 5
    });
  }

  // Rule 4: z_ph4_gut ∧ z_ph2_schlecht2 ∧ p_ph2_schlecht
  // → "Rig brennt wahrscheinlich zu lange und zu heiß" → B1, B4
  const rule4_condition = fuzzyAnd(z_ph4_gut, z_ph2_schlecht2, p_ph2_schlecht);

  if (rule4_condition > 0.1) {
    const desc = locale === 'de' ? 'Rig brennt wahrscheinlich zu lange und zu heiß' : 'Rig probably burns too long and too hot';
    issues.push({
      issue: desc,
      probability: rule4_condition,
      why: [
        `reheating_time (z_ph4)=${z_ph4}s`,
        `burn_time (z_ph2)=${z_ph2}s`,
        `burn_performance (p_ph2)=${p_ph2.toFixed(1)}%`
      ]
    });

    const b_value = fuzzyAnd(z_ph2_schlecht2, p_ph2_schlecht);
    bCodes.push(
      { code: 'B1', description: B_CODE_DESCRIPTIONS[locale]['B1'], value: b_value },
      { code: 'B4', description: B_CODE_DESCRIPTIONS[locale]['B4'], value: b_value }
    );

    actions.push({
      action: locale === 'de' ? 'Holzmenge und Scheitgröße reduzieren' : 'Reduce wood quantity and log size',
      type: 'self',
      eta_min: 10
    });
  }

  // Rule 5: z_ph4_gut ∧ z_ph2_schlecht1 ∧ p_ph2_schlecht
  // → "Rig brennt wahrscheinlich zu kurz und zu heiß" → B11, B3
  const rule5_condition = fuzzyAnd(z_ph4_gut, z_ph2_schlecht1, p_ph2_schlecht);

  if (rule5_condition > 0.1) {
    const desc = locale === 'de' ? 'Rig brennt wahrscheinlich zu kurz und zu heiß' : 'Rig probably burns too short and too hot';
    issues.push({
      issue: desc,
      probability: rule5_condition,
      why: [
        `reheating_time (z_ph4)=${z_ph4}s`,
        `burn_time (z_ph2)=${z_ph2}s`,
        `burn_performance (p_ph2)=${p_ph2.toFixed(1)}%`
      ]
    });

    const b_value = fuzzyAnd(z_ph4_gut, z_ph2_schlecht1, p_ph2_schlecht);
    bCodes.push(
      { code: 'B11', description: B_CODE_DESCRIPTIONS[locale]['B11'], value: b_value },
      { code: 'B3', description: B_CODE_DESCRIPTIONS[locale]['B3'], value: b_value }
    );

    actions.push({
      action: locale === 'de' ? 'Rigzug reduzieren, feuchteres Holz verwenden' : 'Reduce chimney draft, use less dry wood',
      type: 'self',
      eta_min: 10
    });
  }

  // Rule 6: z_ph3_schlecht1 → "zu früh nachgelegt" → B6
  if (z_ph3_schlecht1 > 0.1) {
    const desc = locale === 'de' ? 'zu früh nachgelegt' : 'refueled too early';
    issues.push({
      issue: desc,
      probability: z_ph3_schlecht1,
      why: [`refuel_time (z_ph3)=${z_ph3}s`]
    });

    bCodes.push({
      code: 'B6',
      description: B_CODE_DESCRIPTIONS[locale]['B6'],
      value: z_ph3_schlecht1
    });

    actions.push({
      action: locale === 'de' ? 'Längere Brennphasen abwarten vor dem Nachlegen' : 'Wait for longer burn phases before refueling',
      type: 'self',
      eta_min: null
    });
  }

  // Rule 7: z_ph3_schlecht2 → "zu spät nachgelegt" → B7
  if (z_ph3_schlecht2 > 0.1) {
    const desc = locale === 'de' ? 'zu spät nachgelegt' : 'refueled too late';
    issues.push({
      issue: desc,
      probability: z_ph3_schlecht2,
      why: [`refuel_time (z_ph3)=${z_ph3}s`]
    });

    bCodes.push({
      code: 'B7',
      description: B_CODE_DESCRIPTIONS[locale]['B7'],
      value: z_ph3_schlecht2
    });

    actions.push({
      action: locale === 'de' ? 'Rechtzeitiger nachlegen bei niedrigerer Flamme' : 'Refuel earlier when flames are lower',
      type: 'self',
      eta_min: null
    });
  }

  // Rule 8: z_ph3_gut → "richtig nachgelegt" → B13
  if (z_ph3_gut > 0.1) {
    bCodes.push({
      code: 'B13',
      description: B_CODE_DESCRIPTIONS[locale]['B13'],
      value: z_ph3_gut
    });
  }

  // Rule 9: p_ph1_gut ∧ p_ph2_gut ∧ p_ph4_gut → "Rig brennt richtig" → B12
  const rule9_condition = fuzzyAnd(p_ph1_gut, p_ph2_gut, p_ph4_gut);
  if (rule9_condition > 0.1) {
    bCodes.push({
      code: 'B12',
      description: B_CODE_DESCRIPTIONS[locale]['B12'],
      value: rule9_condition
    });
  }

  // Rule 10: p_gut → "generell gute Feuerung" → B8
  if (p_gut > 0.1) {
    bCodes.push({
      code: 'B8',
      description: B_CODE_DESCRIPTIONS[locale]['B8'],
      value: p_gut
    });
  }

  // Add general performance assessment
  if (p < 50) {
    const desc = locale === 'de' ? 'Generell niedrige Performance' : 'Generally low performance';
    issues.push({
      issue: desc,
      probability: 0.8,
      why: [`overall_performance (p)=${p.toFixed(1)}%`]
    });

    bCodes.push({
      code: 'B9',
      description: B_CODE_DESCRIPTIONS[locale]['B9'],
      value: FuzzyMembership.bad_p(p)
    });

    actions.push({
      action: locale === 'de' ? 'Gesamtsystem überprüfen: Holzqualität, Luftzufuhr, Reinigung' : 'Check overall system: wood quality, air supply, cleaning',
      type: 'self',
      eta_min: 30
    });
  }

  // Additional statistics-based insights
  const totalBurnEvents = stats.anz_be || 0;
  // const totalBurnHours = (stats.anz_s || 0) / 3600; // not used currently
  const avgTemp = stats.t || 0;

  if (totalBurnEvents === 0) {
    const desc = locale === 'de' ? 'Keine Brennereignisse im gewählten Zeitraum' : 'No burn events in selected period';
    issues.push({
      issue: desc,
      probability: 1.0,
      why: ['burn_events (anz_be)=0']
    });
  }

  if (avgTemp > 0 && avgTemp < 200) {
    const desc = locale === 'de' ? 'Durchschnittstemperatur niedrig' : 'Average temperature low';
    issues.push({
      issue: desc,
      probability: 0.6,
      why: [`avg_temp (t)=${avgTemp.toFixed(1)}°C`]
    });

    // actions.push({
    //   action: locale === 'de' ? 'Brenntechnik und Holzqualität optimieren' : 'Optimize burning technique and wood quality',
    //   type: 'self',
    //   eta_min: 20
    // });
  }

  // Calculate urgency based on critical B-codes
  const criticalBCodes = bCodes.filter(b => ['B0', 'B1', 'B2', 'B10', 'B11'].includes(b.code) && b.value > 0.5);
  const urgency: HistoricalRuleResult['urgency'] = 
    criticalBCodes.length > 0 ? 'high' : 
    issues.some(i => i.probability > 0.7) ? 'medium' : 
    'low';

  // Generate summary
  const summary = locale === 'de' ? 
    (criticalBCodes.length > 0 ? 
      `${criticalBCodes.length} kritische Brennstoff-/Betriebsprobleme erkannt` :
      issues.length > 0 ? 
        `${issues.length} Verbesserungsmöglichkeiten gefunden` :
        `Betrieb im gewählten Zeitraum größtenteils normal`) :
    (criticalBCodes.length > 0 ? 
      `${criticalBCodes.length} critical fuel/operation issues detected` :
      issues.length > 0 ? 
        `${issues.length} improvement opportunities found` :
        `Operation mostly normal in selected period`);

  // Calculate confidence based on data completeness
  let confidence = 0.6; // Base confidence for historical analysis
  
  const hasPerformanceData = [p_ph1, p_ph2, p_ph3, p_ph4].some(x => x > 0);
  const hasTimingData = [z_ph1, z_ph2, z_ph3, z_ph4].some(x => x > 0);
  const hasVolumeData = totalBurnEvents > 0;

  if (hasPerformanceData) confidence += 0.15;
  if (hasTimingData) confidence += 0.15;
  if (hasVolumeData) confidence += 0.1;

  confidence = Math.min(confidence, 0.9);

  used.push('historical_stats', 'fuzzy_rules', 'b_codes');

  return {
    summary,
    urgency,
    confidence,
    hypotheses: issues.slice(0, 5), // Limit to 5 top issues
    actions: actions.slice(0, 4), // Limit to 4 top actions
    bCodes: bCodes.filter(b => b.value > 0.05).sort((a, b) => b.value - a.value), // Only significant B-codes
    used_signals: used,
    source: 'historical_rules'
  };
};

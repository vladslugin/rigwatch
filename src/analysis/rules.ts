import type { Signal } from './normalize';

// Error code definitions for detailed error description
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

  // Prefer bitfields E/E2 when available (2^bit encoding)
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

// Count number of set bits (Hamming weight)
const countBits = (n: number): number => {
  let v = (n >>> 0);
  let c = 0;
  while (v) {
    v &= (v - 1);
    c++;
  }
  return c;
};

export interface RuleIssue {
  issue: string;
  probability: number;
  why: string[];
}

export interface RuleAction {
  action: string;
  type: 'self' | 'support';
  eta_min: number | null;
}

export interface RuleResult {
  summary: string;
  urgency: 'low' | 'medium' | 'high';
  confidence: number;
  hypotheses: RuleIssue[];
  actions: RuleAction[];
  used_signals: string[];
  source: 'rules';
}

export interface FeatureBag {
  [k: string]: any;
}

export const runRules = (features: FeatureBag, _signals: Signal[], params: any = {}, locale: 'de' | 'en' = 'en'): RuleResult => {
  const issues: RuleIssue[] = [];
  const actions: RuleAction[] = [];
  const used: string[] = [];

  const push = (issue: RuleIssue, signalKeys: string[]) => {
    issues.push(issue);
    used.push(...signalKeys);
  };

  // Device offline - improved detection with ping test
  const pingTestFailed = features.pingResult === false;
  const longOffline = typeof features.offlineForMinutes === 'number' && features.offlineForMinutes > 1440;
  const shortOffline = typeof features.offlineForMinutes === 'number' && features.offlineForMinutes > 30;
  
  if (pingTestFailed && longOffline) {
    const issue = locale === 'de' ? 'Gerät offline - keine Antwort auf Ping-Test' : 'Device offline - no response to ping test';
    const action = locale === 'de' ? 'Stromversorgung und Netzwerkverbindung prüfen' : 'Check device power and network connection';
    push({ issue, probability: 0.9, why: ['ping_failed=true', 'offlineForMinutes>' + features.offlineForMinutes] }, ['pingResult', 'offlineForMinutes']);
    actions.push({ action, type: 'self', eta_min: 10 });
  } else if (pingTestFailed && shortOffline) {
    const issue = locale === 'de' ? 'Gerät antwortet nicht auf Ping' : 'Device not responding to ping';
    const action = locale === 'de' ? 'Geräteverbindung prüfen und bei Bedarf neu starten' : 'Check device connection and restart if needed';
    push({ issue, probability: 0.8, why: ['ping_failed=true', 'offlineForMinutes>' + features.offlineForMinutes] }, ['pingResult', 'offlineForMinutes']);
    actions.push({ action, type: 'self', eta_min: 5 });
  } else if (pingTestFailed) {
    const issue = locale === 'de' ? 'Gerät antwortet nicht auf Ping' : 'Device not responding to ping';
    const action = locale === 'de' ? 'Geräteverbindung prüfen und bei Bedarf neu starten' : 'Check device connection and restart if needed';
    push({ issue, probability: 0.7, why: ['ping_failed=true'] }, ['pingResult']);
    actions.push({ action, type: 'self', eta_min: 5 });
  } else if (longOffline) {
    const offlineIssue = locale === 'de' ? 'Gerät längere Zeit offline' : 'Device offline for extended period';
    const offlineAction = locale === 'de' ? 'Letzte Connection prüfen und Netzwerk überprüfen' : 'Check when device last connected and verify network';
    push({ issue: offlineIssue, probability: 0.6, why: ['offlineForMinutes>' + features.offlineForMinutes] }, ['offlineForMinutes']);
    actions.push({ action: offlineAction, type: 'self', eta_min: 5 });
  }

  // Removed controller analysis to avoid privacy issues

  // Error codes present - decode specific error codes
  const ecodeVal = typeof params.ecode === 'number' ? params.ecode : 0;
  const ecode2Val = typeof params.ecode2 === 'number' ? params.ecode2 : 0;
  const EVal = typeof params.E === 'number' ? params.E : 0;
  const E2Val = typeof params.E2 === 'number' ? params.E2 : 0;
  const anyErrorVal = (ecodeVal > 0) || (ecode2Val > 0) || (EVal > 0) || (E2Val > 0);
  if (anyErrorVal) {
    const errorDescriptions = decodeErrorCodes(ecodeVal, ecode2Val, EVal, E2Val);
    if (errorDescriptions.length > 0) {
      errorDescriptions.forEach(errorDesc => {
        push({ issue: errorDesc, probability: 0.8, why: [`error_code=${errorDesc}`] }, ['hasErrorCodes', 'ecode', 'ecode2', 'E', 'E2']);
      });
      const checkAction = locale === 'de' ? 'Fehlercodes prüfen und bei Bedarf neu starten' : 'Check error codes and restart if needed';
      const addressAction = locale === 'de' 
        ? `Spezifische Fehlercodes beheben: ${errorDescriptions.join(', ')}` 
        : `Address specific error codes: ${errorDescriptions.join(', ')}`;
      actions.push({ action: checkAction, type: 'self', eta_min: 5 });
      actions.push({ action: addressAction, type: 'support', eta_min: 15 });
    } else {
      push({ issue: 'Hardware/operation error', probability: 0.5, why: ['ecode/ecode2 or E/E2 present'] }, ['hasErrorCodes', 'ecode', 'ecode2', 'E', 'E2']);
    }
  }

  // Network unstable
  if (typeof features.pingOkRatio === 'number' && features.pingOkRatio < 0.3) {
    push({ issue: 'Network unstable', probability: 0.6, why: ['pingOkRatio<' + features.pingOkRatio] }, ['pingOkRatio']);
    actions.push({ action: 'Check local router/Internet, verify WiFi/Ethernet signal', type: 'self', eta_min: 10 });
  }

  // Error occurred (parameter 'e') - only add if not redundant with known error codes
  if (features.errorOccurred === true) {
    const ecode = params.ecode as number | undefined;
    const ecode2 = params.ecode2 as number | undefined;
    const decoded = decodeErrorCodes(ecode, ecode2);

    // Detect unknown error bits not mapped in ERROR_DEFINITIONS
    const knownBitsE = ERROR_DEFINITIONS.E.map(d => d.bit);
    const knownBitsE2 = ERROR_DEFINITIONS.E2.map(d => d.bit);
    const unknownInE = typeof ecode === 'number' && ecode > 0
      ? (countBits(ecode) > knownBitsE.reduce((acc, b) => acc + (((ecode & (1 << b)) !== 0) ? 1 : 0), 0))
      : false;
    const unknownInE2 = typeof ecode2 === 'number' && ecode2 > 0
      ? (countBits(ecode2) > knownBitsE2.reduce((acc, b) => acc + (((ecode2 & (1 << b)) !== 0) ? 1 : 0), 0))
      : false;
    const hasUnknownBit = unknownInE || unknownInE2;

    // If specific error codes are decoded, suppress the generic system error to avoid duplication
    // Otherwise, show it if unknown bits are present, or if no error codes at all
    if (decoded.length === 0 || hasUnknownBit || !features.hasErrorCodes) {
      const systemErrorIssue = locale === 'de' ? 'Systemfehler erkannt' : 'System error detected';
      const why: string[] = ['error_flag=true'];
      if (hasUnknownBit) why.push('unknown_error_bit=true');
      push({ issue: systemErrorIssue, probability: 0.9, why }, ['errorOccurred']);
    }
    // No extra actions - error code actions handled above when present
  }

  // Temperature analysis (phase-aware)
  if (typeof features.temperature === 'number' && features.notIgnited !== true) {
    // Normal rig temperatures can reach 450-620°C during combustion
    // Only flag as problematic if exceeding typical combustion range significantly
    if (features.temperature > 650) {
      push({ issue: 'Very high temperature detected', probability: 0.7, why: ['T=' + features.temperature + '°C'] }, ['temperature']);
      actions.push({ action: 'Check ventilation and reduce air flow', type: 'self', eta_min: 5 });
    } else if (features.temperature < 50 && features.burnDuration && features.burnDuration > 30) {
      push({ issue: 'Low temperature during burn', probability: 0.6, why: ['T=' + features.temperature + '°C', 'DAUER_ABBRAND=' + features.burnDuration + 'min'] }, ['temperature', 'burnDuration']);
      actions.push({ action: 'Check wood quality and air supply', type: 'self', eta_min: 10 });
    }
  }

  // Temperature rise analysis
  if (typeof features.temperatureRise === 'number' && features.notIgnited !== true) {
    if (features.temperatureRise > 10) {
      push({ issue: 'Rapid temperature increase', probability: 0.7, why: ['MLANG=' + features.temperatureRise + '°C/30s'] }, ['temperatureRise']);
      actions.push({ action: 'Monitor carefully, reduce air if necessary', type: 'self', eta_min: 2 });
    } else if (features.temperatureRise < -5) {
      push({ issue: 'Temperature dropping rapidly', probability: 0.6, why: ['MLANG=' + features.temperatureRise + '°C/30s'] }, ['temperatureRise']);
      actions.push({ action: 'Check wood feed and air supply', type: 'self', eta_min: 5 });
    }
  }

  // Oxygen content analysis
  if (typeof features.oxygenContent === 'number' && features.notIgnited !== true) {
    if (features.oxygenContent < 15) {
      push({ issue: 'Low oxygen content - poor combustion', probability: 0.8, why: ['O2=' + features.oxygenContent + '%'] }, ['oxygenContent']);
      actions.push({ action: 'Increase air supply, check air intake', type: 'self', eta_min: 5 });
    } else if (features.oxygenContent > 19) {
      push({ issue: 'High oxygen content - excess air', probability: 0.6, why: ['O2=' + features.oxygenContent + '%'] }, ['oxygenContent']);
      actions.push({ action: 'Reduce air supply for better efficiency', type: 'self', eta_min: 3 });
    }
  }

  // Performance analysis
  if (typeof features.performance === 'number' && features.notIgnited !== true) {
    if (features.performance < 30) {
      push({ issue: 'Low performance detected', probability: 0.7, why: ['P=' + features.performance + '%'] }, ['performance']);
      actions.push({ action: 'Check wood quality and clean burner', type: 'self', eta_min: 15 });
    }
  }

  // Refuel urgency (N/n)
  if (typeof features.refuelUrgency === 'number') {
    if (features.refuelUrgency >= 4) {
      const msg = locale === 'de' ? 'Holznachlegebedarf hoch' : 'High refuel urgency';
      push({ issue: msg, probability: 0.7, why: ['N=' + features.refuelUrgency] }, ['refuelUrgency']);
      actions.push({ action: locale === 'de' ? 'Holz nachlegen' : 'Add wood', type: 'self', eta_min: 2 });
    } else if (features.refuelUrgency >= 2) {
      const msg = locale === 'de' ? 'Holznachlegebedarf' : 'Refuel needed soon';
      push({ issue: msg, probability: 0.5, why: ['N=' + features.refuelUrgency] }, ['refuelUrgency']);
      actions.push({ action: locale === 'de' ? 'Holz zeitnah nachlegen' : 'Plan to add wood soon', type: 'self', eta_min: null });
    }
  }

  // Controller temperature
  if (features.controllerOverheat === true) {
    const issue = locale === 'de' ? 'Controller-Temperatur hoch' : 'Controller temperature high';
    push({ issue, probability: 0.7, why: ['TC>' + 38 + '°C'] }, ['controllerOverheat']);
    actions.push({ action: locale === 'de' ? 'Lüftung/Einbau prüfen, Umgebungstemperatur reduzieren' : 'Check ventilation/enclosure, reduce ambient temperature', type: 'self', eta_min: null });
  }

  // Not ignited detection
  if (features.notIgnited === true) {
    const issue = locale === 'de' ? 'Rig nicht entzündet' : 'Rig not ignited';
    const why: string[] = [];
    if (typeof features.temperature === 'number') why.push('T=' + features.temperature + '°C');
    if (typeof features.temperatureRise === 'number') why.push('MLANG=' + features.temperatureRise + '°C/30s');
    if (typeof features.performance === 'number') why.push('P=' + features.performance + '%');
    if (typeof features.oxygenContent === 'number') why.push('O2=' + features.oxygenContent + '%');
    push({ issue, probability: 0.8, why }, ['notIgnited']);
    actions.push({ action: locale === 'de' ? 'Zündung prüfen und Rig gemäß Anleitung starten' : 'Check ignition and start rig per manual', type: 'self', eta_min: 5 });
  }

  // Booster analysis
  if (features.boosterActive === true && features.boosterAvailable === false) {
    push({ issue: 'Booster active but not available', probability: 0.5, why: ['ba=true', 'bv=false'] }, ['boosterActive', 'boosterAvailable']);
    actions.push({ action: 'Check booster system settings', type: 'support', eta_min: null });
  }

  // Firmware update available
  if (features.firmwareUpdateAvailable === true) {
    const updateIssue = locale === 'de' ? 'Firmware-Update verfügbar' : 'Firmware update available';
    const updateAction = locale === 'de' ? 'Firmware-Update bei Gelegenheit installieren' : 'Install firmware update when convenient';
    push({ issue: updateIssue, probability: 0.3, why: ['v=true'] }, ['firmwareUpdateAvailable']);
    actions.push({ action: updateAction, type: 'self', eta_min: 30 });
  }

  const criticalIssues = issues.filter(i => i.probability > 0.7);
  const urgency: RuleResult['urgency'] = criticalIssues.length > 0 ? 'high' : issues.some(i => i.issue.includes('offline') || i.issue.includes('ping')) ? 'medium' : issues.length > 0 ? 'low' : 'low';
  // Localized summary
  const summary = locale === 'de' 
    ? (criticalIssues.length > 0 
        ? `${criticalIssues.length} kritische${criticalIssues.length === 1 ? '' : ''} Problem${criticalIssues.length === 1 ? '' : 'e'} erkannt` 
        : issues.length > 0 
          ? `${issues.length} mögliche${issues.length === 1 ? '' : ''} Problem${issues.length === 1 ? '' : 'e'} gefunden`
          : 'System scheint normal zu funktionieren')
    : (criticalIssues.length > 0 
        ? `${criticalIssues.length} critical issue(s) detected` 
        : issues.length > 0 
          ? `${issues.length} potential issue(s) found` 
          : 'System appears to be operating normally');
  
  // Calculate confidence based on available data and issue certainty
  let confidence = 0.4; // Base confidence for rules-based analysis
  
  // Increase confidence based on available signals
  if (used.length > 5) confidence += 0.2; // More data available
  if (used.includes('pingResult')) confidence += 0.1; // Real-time ping test
  if (used.includes('temperature') || used.includes('oxygenContent')) confidence += 0.1; // Key sensor data
  if (used.includes('errorOccurred') && features.errorOccurred) confidence += 0.2; // Clear error state
  
  // High confidence for specific error codes
  if (used.includes('ecode') || used.includes('ecode2')) confidence += 0.2; // Hardware error codes
  if (criticalIssues.length > 0) confidence += 0.1; // Critical issues detected
  
  // Cap confidence at reasonable levels for rule-based analysis
  confidence = Math.min(confidence, 0.85);

  return {
    summary,
    urgency,
    confidence,
    hypotheses: issues.slice(0, 3),
    actions,
    used_signals: Array.from(new Set(used)),
    source: 'rules'
  };
};


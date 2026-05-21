import paramDictionary from './paramDictionary.json';

export type NormalizedValue = string | number | boolean | null;

export interface Signal {
  key: string;
  value: NormalizedValue;
  meaning?: string;
  weight: number;
}

export interface UIContext {
  status: 'online'|'offline'|'unknown';
  lastSeen?: string;
  pingHistory?: { at: string; ok: boolean; rttMs?: number }[];
  locale?: 'de'|'en'|'ru';
  pingResult?: boolean;
  pingRtt?: number;
  connectionTest?: string;
}

export interface NormalizeInput {
  app: Record<string, unknown>;
  core: Record<string, unknown>;
  ui: UIContext;
}

export interface NormalizedOutput {
  params: Record<string, NormalizedValue>;
  signals: Signal[];
  features: Record<string, NormalizedValue>;
}

const coerce = (value: unknown, type?: string): NormalizedValue => {
  if (value === undefined || value === null) return null;
  switch (type) {
    case 'int':
      return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null;
    case 'number':
      return Number.isFinite(Number(value)) ? Number(value) : null;
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') return /^(1|true|yes|on)$/i.test(value.trim());
      return null;
    case 'string':
    default:
      return String(value);
  }
};

const trimValue = (value: NormalizedValue): NormalizedValue => {
  if (typeof value === 'string') {
    const v = value.trim();
    if (v.length > 24) return v.slice(0, 12) + '…' + v.slice(-8);
    return v;
  }
  return value;
};

export const normalize = (input: NormalizeInput): NormalizedOutput => {
  const params: Record<string, NormalizedValue> = {};
  const signals: Signal[] = [];

  const addParam = (key: string, raw: unknown) => {
    const meta: any = (paramDictionary as any)[key] || {};
    const typed = coerce(raw, meta.type);
    const cleaned = trimValue(typed);
    params[key] = cleaned;
    signals.push({
      key,
      value: cleaned,
      meaning: meta.desc,
      weight: typeof meta.weight === 'number' ? meta.weight : 0.2,
    });
  };

  Object.entries(input.app || {}).forEach(([k, v]) => addParam(k, v));
  Object.entries(input.core || {}).forEach(([k, v]) => addParam(k, v));

  // Features
  const features: Record<string, NormalizedValue> = {};

  // offlineForMinutes
  if (input.ui.lastSeen) {
    const ms = Date.now() - Date.parse(input.ui.lastSeen);
    const minutes = Math.max(0, Math.round(ms / 60000));
    features.offlineForMinutes = minutes;
    signals.push({ key: 'offlineForMinutes', value: minutes, weight: minutes > 60 ? 0.7 : 0.3 });
  }

  // Removed controller analysis to avoid privacy issues

  // hasErrorCodes
  const primaryCode = (params as any).ecode;
  const secondaryCode = (params as any).ecode2;
  const E = (params as any).E;
  const E2 = (params as any).E2;
  const pVal = typeof primaryCode === 'number' ? primaryCode : 0;
  const sVal = typeof secondaryCode === 'number' ? secondaryCode : 0;
  const EVal = typeof E === 'number' ? E : 0;
  const E2Val = typeof E2 === 'number' ? E2 : 0;
  const hasErrorCodes = (pVal > 0) || (sVal > 0) || (EVal > 0) || (E2Val > 0);
  features.hasErrorCodes = hasErrorCodes;
  if (hasErrorCodes) {
    signals.push({ key: 'hasErrorCodes', value: true, weight: 0.8 });
    if (EVal > 0) signals.push({ key: 'E', value: EVal, weight: 0.8 });
    if (E2Val > 0) signals.push({ key: 'E2', value: E2Val, weight: 0.7 });
    if (pVal > 0) signals.push({ key: 'ecode', value: pVal, weight: 0.6 });
    if (sVal > 0) signals.push({ key: 'ecode2', value: sVal, weight: 0.5 });
  }

  // Removed firmware analysis to avoid privacy issues

  // pingOkRatio
  if (Array.isArray(input.ui.pingHistory) && input.ui.pingHistory.length > 0) {
    const ok = input.ui.pingHistory.filter(p => p.ok).length;
    const total = input.ui.pingHistory.length;
    const ratio = total ? ok / total : 0;
    features.pingOkRatio = Number(ratio.toFixed(2));
    signals.push({ key: 'pingOkRatio', value: features.pingOkRatio, weight: 0.5 });
  }

  // Current ping test result
  if (typeof input.ui.pingResult === 'boolean') {
    features.pingResult = input.ui.pingResult;
    signals.push({ key: 'pingResult', value: input.ui.pingResult, weight: 0.7 });
  }

  // simPresent
  if (params.sim != null) {
    const simPresent = coerce(params.sim, 'boolean');
    features.simPresent = simPresent as boolean;
  }

  // lastCmd
  if (params.cmd != null) {
    features.lastCmd = params.cmd;
  }

  // Booster analysis (from konstant_app)
  if (params.ba != null) {
    const boosterActive = coerce(params.ba, 'boolean');
    features.boosterActive = boosterActive;
    if (boosterActive) signals.push({ key: 'boosterActive', value: true, weight: 0.6 });
  }

  if (params.bv != null) {
    const boosterAvailable = coerce(params.bv, 'boolean');
    features.boosterAvailable = boosterAvailable;
    signals.push({ key: 'boosterAvailable', value: boosterAvailable, weight: 0.4 });
  }

  // Error occurred flag
  if (params.e != null) {
    const errorOccurred = coerce(params.e, 'boolean');
    features.errorOccurred = errorOccurred;
    if (errorOccurred) signals.push({ key: 'errorOccurred', value: true, weight: 0.9 });
  }

  // Firmware update available
  if (params.v != null) {
    const firmwareUpdateAvailable = coerce(params.v, 'boolean');
    features.firmwareUpdateAvailable = firmwareUpdateAvailable;
    if (firmwareUpdateAvailable) signals.push({ key: 'firmwareUpdateAvailable', value: true, weight: 0.4 });
  }

  // Temperature analysis (from temporaer)
  if (params.T != null && typeof params.T === 'number') {
    features.temperature = params.T;
    signals.push({ key: 'temperature', value: params.T, weight: 0.9 });
  }

  // Temperature rise over 30s
  if (params.MLANG != null && typeof params.MLANG === 'number') {
    features.temperatureRise = params.MLANG;
    signals.push({ key: 'temperatureRise', value: params.MLANG, weight: 0.8 });
  }

  // Oxygen content
  if (params.O2 != null && typeof params.O2 === 'number') {
    features.oxygenContent = params.O2;
    signals.push({ key: 'oxygenContent', value: params.O2, weight: 0.8 });
  }

  // CO2 measured
  if (params['CO2 gemessen'] != null && typeof params['CO2 gemessen'] === 'number') {
    features.co2Measured = params['CO2 gemessen'];
    signals.push({ key: 'co2Measured', value: params['CO2 gemessen'], weight: 0.6 });
  }

  // Performance
  if (params.P != null && typeof params.P === 'number') {
    features.performance = params.P;
    signals.push({ key: 'performance', value: params.P, weight: 0.7 });
  }

  // Burn duration
  if (params.DAUER_ABBRAND != null && typeof params.DAUER_ABBRAND === 'number') {
    features.burnDuration = params.DAUER_ABBRAND;
    signals.push({ key: 'burnDuration', value: params.DAUER_ABBRAND, weight: 0.7 });
  }

  // Temperature average
  if (params.TQUER != null && typeof params.TQUER === 'number') {
    features.temperatureAverage = params.TQUER;
    signals.push({ key: 'temperatureAverage', value: params.TQUER, weight: 0.7 });
  }

  // Controller temperature (value scaled by 100 → e.g., 2705 → 27.05°C)
  if (params.TC != null && typeof params.TC === 'number') {
    const tcValue = Number(params.TC) / 100;
    features.controllerTemperature = Number(tcValue.toFixed(2));
    signals.push({ key: 'controllerTemperature', value: features.controllerTemperature, weight: 0.6 });
    if (tcValue > 38) {
      features.controllerOverheat = true;
      signals.push({ key: 'controllerOverheat', value: true, weight: 0.7 });
    }
  }

  // Window air and rear wall air (calculated target values)
  if (params.PL != null && typeof params.PL === 'number') {
    features.windowAir = params.PL;
    signals.push({ key: 'windowAir', value: params.PL, weight: 0.6 });
  }

  if (params.SL != null && typeof params.SL === 'number') {
    features.rearWallAir = params.SL;
    signals.push({ key: 'rearWallAir', value: params.SL, weight: 0.6 });
  }

  // Actual percentages and angles
  if (params['PL_PROZENT'] != null && typeof params['PL_PROZENT'] === 'number') {
    features.windowAirPercent = params['PL_PROZENT'];
    signals.push({ key: 'windowAirPercent', value: params['PL_PROZENT'], weight: 0.6 });
  }
  if (params['SL_PROZENT'] != null && typeof params['SL_PROZENT'] === 'number') {
    features.rearWallAirPercent = params['SL_PROZENT'];
    signals.push({ key: 'rearWallAirPercent', value: params['SL_PROZENT'], weight: 0.6 });
  }
  if (params['rl_prozent'] != null && typeof params['rl_prozent'] === 'number') {
    features.rostLuftPercent = params['rl_prozent'];
    signals.push({ key: 'rostLuftPercent', value: params['rl_prozent'], weight: 0.5 });
  }
  if (params['PL_WINKEL'] != null && typeof params['PL_WINKEL'] === 'number') {
    features.windowAirAngle = params['PL_WINKEL'];
    signals.push({ key: 'windowAirAngle', value: params['PL_WINKEL'], weight: 0.5 });
  }
  if (params['PL_MOTOR_WINKEL'] != null && typeof params['PL_MOTOR_WINKEL'] === 'number') {
    features.windowAirMotorAngle = params['PL_MOTOR_WINKEL'];
    signals.push({ key: 'windowAirMotorAngle', value: params['PL_MOTOR_WINKEL'], weight: 0.5 });
  }
  if (params['SL_WINKEL'] != null && typeof params['SL_WINKEL'] === 'number') {
    features.rearWallAirAngle = params['SL_WINKEL'];
    signals.push({ key: 'rearWallAirAngle', value: params['SL_WINKEL'], weight: 0.5 });
  }
  if (params['SL_MOTOR_WINKEL'] != null && typeof params['SL_MOTOR_WINKEL'] === 'number') {
    features.rearWallAirMotorAngle = params['SL_MOTOR_WINKEL'];
    signals.push({ key: 'rearWallAirMotorAngle', value: params['SL_MOTOR_WINKEL'], weight: 0.5 });
  }
  if (params['RL_WINKEL'] != null && typeof params['RL_WINKEL'] === 'number') {
    features.rostLuftAngle = params['RL_WINKEL'];
    signals.push({ key: 'rostLuftAngle', value: params['RL_WINKEL'], weight: 0.5 });
  }

  // Burn phase
  if (params.F != null && typeof params.F === 'number') {
    features.burnPhase = params.F;
    signals.push({ key: 'burnPhase', value: params.F, weight: 0.7 });
  }

  // Refuel urgency (both lowercase n and uppercase N variants)
  const refuelUrgency = ((): number | null => {
    if (typeof params.N === 'number') return params.N as number;
    if (typeof params.n === 'number') return params.n as number;
    return null;
  })();
  if (refuelUrgency !== null) {
    features.refuelUrgency = refuelUrgency;
    signals.push({ key: 'refuelUrgency', value: refuelUrgency, weight: 0.6 });
  }

  // O2 targets and thresholds
  if (params['SAUERSTOFF_SOLL'] != null && typeof params['SAUERSTOFF_SOLL'] === 'number') {
    features.oxygenTarget = params['SAUERSTOFF_SOLL'];
  }
  if (params['SAUERSTOFF_SOLL_ABKUEHLEN'] != null && typeof params['SAUERSTOFF_SOLL_ABKUEHLEN'] === 'number') {
    features.oxygenTargetCooling = params['SAUERSTOFF_SOLL_ABKUEHLEN'];
  }
  if (params['SAUERSTOFF_MIN'] != null && typeof params['SAUERSTOFF_MIN'] === 'number') {
    features.oxygenMinimum = params['SAUERSTOFF_MIN'];
  }
  if (params['M_FUER_SAUERSTOFF_SOLL'] != null && typeof params['M_FUER_SAUERSTOFF_SOLL'] === 'number') {
    features.oxygenTargetSlope = params['M_FUER_SAUERSTOFF_SOLL'];
  }
  if (params['M_FUER_SAUERSTOFF_SOLL_ABKUEHLEN'] != null && typeof params['M_FUER_SAUERSTOFF_SOLL_ABKUEHLEN'] === 'number') {
    features.oxygenTargetCoolingSlope = params['M_FUER_SAUERSTOFF_SOLL_ABKUEHLEN'];
  }

  // TMAX and Ausbrand policy
  if (params['TMAX'] != null && typeof params['TMAX'] === 'number') {
    features.temperatureMax = params['TMAX'];
  }
  if (params['AUSBRAND POSITION'] != null && typeof params['AUSBRAND POSITION'] === 'number') {
    features.ausbrandPlPosition = params['AUSBRAND POSITION'];
  }
  if (params['KEINE_RL_IM_AUSBRAND'] != null) {
    features.noRostLuftInAusbrand = coerce(params['KEINE_RL_IM_AUSBRAND'], 'boolean');
  }

  // Not ignited detection (no flame / not burning)
  // Heuristics: low temperature (e.g. < 40°C), small or negative slope, low performance, O2 high (~ambient), burn phase not in 2..4
  const temp = typeof features.temperature === 'number' ? features.temperature : null;
  const slope = typeof features.temperatureRise === 'number' ? features.temperatureRise : null;
  const perf = typeof features.performance === 'number' ? features.performance : null;
  const o2 = typeof features.oxygenContent === 'number' ? features.oxygenContent : null;
  const phase = typeof features.burnPhase === 'number' ? features.burnPhase : null;

  const lowTemp = temp !== null && temp < 40;
  const noRise = slope !== null && slope < 1;
  const lowPerf = perf !== null && perf < 10;
  const ambientO2 = o2 !== null && o2 > 19; // ambient air
  const notBurnPhase = phase !== null && (phase < 2 || phase > 4);

  const notIgnitedScore = [lowTemp, noRise, lowPerf, ambientO2, notBurnPhase].filter(Boolean).length;
  if (notIgnitedScore >= 3) {
    features.notIgnited = true;
    signals.push({ key: 'notIgnited', value: true, weight: 0.8 });
  }

  // Removed article number analysis to avoid privacy issues

  return { params, signals, features };
};

export type { UIContext as AnalysisUIContext };


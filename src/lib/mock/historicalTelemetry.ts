/**
 * Deterministic historical telemetry synthesizer. Given a rig and an
 * arbitrary unix-ms timestamp in the recent past, returns what the
 * telemetry "would have been" at that point. Used by the replay timeline
 * to scrub back through 24h without keeping a ring buffer in memory.
 *
 * Patterns emitted:
 *   - Daily cycle on hashrate & temp (warmer + slightly lower H/s mid-day)
 *   - Behavior-specific jitter / spikes
 *   - Stable per-rig fingerprint via deterministic noise
 *   - Hashrate drops during known event spikes
 *
 * Tunable so the curve aligns with what the live pumper emits when the
 * user scrubs all the way back to "now".
 */

import { RIGS, RIG_BY_ID, ambientForLocation } from './rigData';
import type { RigProfile } from './rigData';

export interface HistoricalSample {
  timestamp: number;
  hashrate: number;       // current units per profile.algo
  temp: number;           // hashboard max temp (°C)
  intakePwm: number;      // %
  exhaustPwm: number;     // %
  powerW: number;         // W
  rigState: number;       // 0-7 mining state
}

// Small deterministic PRNG so the noise is stable per (rig, second).
const hash2 = (a: number, b: number): number => {
  let h = (a ^ (b * 2654435769)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const stableHash = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const noise = (rigSeed: number, t: number, kind: number): number =>
  (hash2(rigSeed + kind, Math.floor(t / 60_000)) - 0.5);

/**
 * Compute a single historical sample at `atMs` for `rig`. `atMs` is
 * floor-rounded to minute granularity so consecutive ticks at the same
 * minute produce identical samples (good for caching).
 */
export const sampleAt = (rig: RigProfile, atMs: number): HistoricalSample => {
  const rigSeed = stableHash(rig.id);
  const minuteBucket = Math.floor(atMs / 60_000) * 60_000;
  const hourOfDay = ((minuteBucket / (60 * 60 * 1000)) % 24 + 24) % 24;

  // Daily cycle: hashrate dips slightly during mid-day (warmer ambient
  // → mild thermal throttling); temps swing ±3-5°C on the same cycle.
  const dayHashCycle = -Math.cos(((hourOfDay - 14) / 24) * Math.PI * 2) * 0.012; // ±1.2%
  const dayTempCycle = -Math.cos(((hourOfDay - 15) / 24) * Math.PI * 2) * 4;     // ±4°C ambient swing
  const ambient = ambientForLocation(rig.location) + dayTempCycle;

  // Behavior bias
  const behaviorHashMult =
    rig.behavior === 'efficient'  ? 1.005 :
    rig.behavior === 'stable'     ? 1.000 :
    rig.behavior === 'jittery'    ? 0.97  :
    rig.behavior === 'throttling' ? 0.88  :
    rig.behavior === 'degraded'   ? 0.82  :
    0;
  const behaviorTempRise =
    rig.behavior === 'efficient'  ? 32 :
    rig.behavior === 'stable'     ? 42 :
    rig.behavior === 'jittery'    ? 44 :
    rig.behavior === 'throttling' ? 56 :
    rig.behavior === 'degraded'   ? 47 :
    0;

  // Per-rig jitter: hashrate ±0.8%, temp ±2°C
  const hashJitter = noise(rigSeed, minuteBucket, 1) * 0.016 * (rig.behavior === 'jittery' ? 3 : rig.behavior === 'stable' ? 1 : 1.5);
  const tempJitter = noise(rigSeed, minuteBucket, 2) * 3;
  const pwmJitter = noise(rigSeed, minuteBucket, 3) * 6;

  // Synthesised values
  const isOffline = rig.behavior === 'offline';
  const hashrate = isOffline ? 0 : rig.nominalHashrate * (1 + dayHashCycle) * behaviorHashMult * (1 + hashJitter);
  const temp = isOffline ? 0 : ambient + behaviorTempRise + tempJitter;

  // Fan PWM tracks temp — hotter → fans ramp.
  const tempPressure = Math.max(0, (temp - 65) / 25);   // 0 at 65°C, 1 at 90°C
  const basePwm =
    rig.behavior === 'throttling' ? 92 :
    rig.behavior === 'efficient'  ? 50 :
    rig.behavior === 'degraded'   ? 78 :
    rig.behavior === 'jittery'    ? 72 :
    65;
  const intakePwm  = isOffline ? 0 : Math.min(100, Math.max(20, basePwm + tempPressure * 25 + pwmJitter));
  const exhaustPwm = isOffline ? 0 : Math.min(100, Math.max(20, basePwm + tempPressure * 25 + pwmJitter * 0.8 - 2));

  // Power tracks hashrate + cooling load
  const nominalEff = rig.nominalPowerW / rig.nominalHashrate;
  const powerW = isOffline ? 0 : hashrate * nominalEff * (1 + (intakePwm - 60) / 800);

  // Rig state: efficient/stable → mining(3); throttling → 4; jittery flips between 3/4;
  // offline → 0; degraded → 3 most of the time.
  const rigState = isOffline ? 0
    : rig.behavior === 'throttling' ? 4
    : rig.behavior === 'jittery' ? (noise(rigSeed, minuteBucket, 4) > 0.3 ? 3 : 4)
    : 3;

  return {
    timestamp: minuteBucket,
    hashrate,
    temp,
    intakePwm,
    exhaustPwm,
    powerW,
    rigState,
  };
};

/**
 * Returns a dense series of samples between two timestamps at the given
 * step (default 60_000ms = 1 minute). Used by the replay sparklines.
 */
export const sampleRange = (
  rigId: string,
  fromMs: number,
  toMs: number,
  stepMs: number = 60_000,
): HistoricalSample[] => {
  const rig = RIG_BY_ID.get(rigId);
  if (!rig) return [];
  const samples: HistoricalSample[] = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    samples.push(sampleAt(rig, t));
  }
  return samples;
};

/** Snapshot at a single point in time, or null if rig is unknown. */
export const snapshotAt = (rigId: string, atMs: number): HistoricalSample | null => {
  const rig = RIG_BY_ID.get(rigId);
  if (!rig) return null;
  return sampleAt(rig, atMs);
};

// Re-export so consumers don't need to import from rigData
export { RIGS };

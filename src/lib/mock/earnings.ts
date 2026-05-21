/**
 * Synthetic payout / earnings data. Generated per rig once at module load
 * so each rig has a stable 30-day history that doesn't reshuffle on
 * re-render. Daily granularity; bumps every payout cycle (~6h).
 *
 * Real implementations would query the pool API or scan the wallet's
 * payout transactions. This module exists so the UI can showcase the
 * "rig owner sees their earnings" UX in the portfolio.
 */

import { RIGS } from './rigData';
import type { RigProfile } from './rigData';

export interface PayoutTx {
  /** Synthetic tx hash that looks like a Bitcoin txid. */
  hash: string;
  /** Unix ms. */
  timestamp: number;
  /** BTC paid in this tx (8-decimal precision). */
  btc: number;
  /** USD equivalent at the time of payout (frozen). */
  usd: number;
  rigId: string;
  rigName: string;
  poolName: string;
  status: 'confirmed' | 'pending';
  /** Number of confirmations (capped at 6 in mock). */
  confirmations: number;
}

const PAYOUT_CYCLE_HOURS = 6;
const DAYS = 30;

// Frozen BTC price for the mock universe; real fetcher lives elsewhere.
const FROZEN_BTC_USD = 97_400;

// Each model's nominal $/day per TH/s at current difficulty + electricity
// is a rough order-of-magnitude. Calibrated so a healthy S21 nets ~$10/day.
const DAILY_USD_PER_TH = 0.045;
const DAILY_USD_PER_GH_KAS = 8.0;
const DAILY_USD_PER_MH_SCRYPT = 0.0012;

const dailyEstimateUsd = (rig: RigProfile): number => {
  switch (rig.algo) {
    case 'SHA-256':    return rig.nominalHashrate * DAILY_USD_PER_TH;
    case 'kHeavyHash': return rig.nominalHashrate * DAILY_USD_PER_GH_KAS;
    case 'Scrypt':     return rig.nominalHashrate * DAILY_USD_PER_MH_SCRYPT;
  }
};

const behaviorMultiplier = (b: RigProfile['behavior']): number => {
  switch (b) {
    case 'efficient':  return 1.05;
    case 'stable':     return 1.00;
    case 'jittery':    return 0.92;
    case 'throttling': return 0.85;
    case 'degraded':   return 0.78;
    case 'offline':    return 0;
  }
};

// Deterministic PRNG so the histories don't shuffle on each render.
const mulberry32 = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
};

const hashString = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
};

/** 64-char hex tx hash. Deterministic per rig + cycle index. */
const synthTxHash = (rigId: string, idx: number): string => {
  const rand = mulberry32(hashString(rigId + ':' + idx));
  let out = '';
  for (let i = 0; i < 64; i++) {
    out += Math.floor(rand() * 16).toString(16);
  }
  return out;
};

const generateHistoryForRig = (rig: RigProfile): PayoutTx[] => {
  if (rig.behavior === 'offline') return [];
  const dailyUsd = dailyEstimateUsd(rig) * behaviorMultiplier(rig.behavior);
  const cyclesPerDay = 24 / PAYOUT_CYCLE_HOURS;
  const usdPerCycle = dailyUsd / cyclesPerDay;
  const rand = mulberry32(hashString(rig.id));

  const txs: PayoutTx[] = [];
  const now = Date.now();
  const oldest = now - DAYS * 24 * 60 * 60 * 1000;

  let cycleIndex = 0;
  for (
    let ts = oldest;
    ts <= now;
    ts += PAYOUT_CYCLE_HOURS * 60 * 60 * 1000
  ) {
    // Wobble payout amount ±15% so the bars don't look identical.
    const wobble = 0.85 + rand() * 0.3;
    const usd = usdPerCycle * wobble;
    const btc = usd / FROZEN_BTC_USD;
    const ageMs = now - ts;
    const isPending = ageMs < PAYOUT_CYCLE_HOURS * 60 * 60 * 1000 * 0.4;
    txs.push({
      hash: synthTxHash(rig.id, cycleIndex++),
      timestamp: ts,
      btc,
      usd,
      rigId: rig.id,
      rigName: rig.name,
      poolName: rig.poolName,
      status: isPending ? 'pending' : 'confirmed',
      confirmations: isPending ? Math.floor(rand() * 3) : 6,
    });
  }
  return txs.sort((a, b) => b.timestamp - a.timestamp);
};

// Generate once at module load — these are deterministic and don't change.
const RIG_HISTORY = new Map<string, PayoutTx[]>(
  RIGS.map((r) => [r.id, generateHistoryForRig(r)]),
);

export const earningsForRig = (rigId: string): PayoutTx[] =>
  RIG_HISTORY.get(rigId) ?? [];

export const earningsForRigs = (rigIds: readonly string[]): PayoutTx[] => {
  const all: PayoutTx[] = [];
  for (const id of rigIds) {
    const txs = RIG_HISTORY.get(id);
    if (txs) all.push(...txs);
  }
  return all.sort((a, b) => b.timestamp - a.timestamp);
};

/** All payouts across the fleet — used by the global earnings sheet. */
export const allEarnings = (): PayoutTx[] => {
  const all: PayoutTx[] = [];
  for (const [, txs] of RIG_HISTORY) all.push(...txs);
  return all.sort((a, b) => b.timestamp - a.timestamp);
};

/** Daily totals for the chart, aggregated across the provided rig set. */
export interface DailyBucket {
  /** Day start in ms (00:00 UTC). */
  day: number;
  btc: number;
  usd: number;
  txCount: number;
}

export const dailyBuckets = (rigIds: readonly string[]): DailyBucket[] => {
  const txs = earningsForRigs(rigIds);
  const map = new Map<number, DailyBucket>();
  for (const tx of txs) {
    const day = Math.floor(tx.timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
    const cur = map.get(day) ?? { day, btc: 0, usd: 0, txCount: 0 };
    cur.btc += tx.btc;
    cur.usd += tx.usd;
    cur.txCount += 1;
    map.set(day, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.day - b.day);
};

export const aggregateUsd = (rigIds: readonly string[], sinceMs?: number): number => {
  const cutoff = sinceMs ?? 0;
  return earningsForRigs(rigIds)
    .filter((t) => t.timestamp >= cutoff)
    .reduce((acc, t) => acc + t.usd, 0);
};

export const aggregateBtc = (rigIds: readonly string[], sinceMs?: number): number => {
  const cutoff = sinceMs ?? 0;
  return earningsForRigs(rigIds)
    .filter((t) => t.timestamp >= cutoff)
    .reduce((acc, t) => acc + t.btc, 0);
};

export const currentBtcUsd = (): number => FROZEN_BTC_USD;

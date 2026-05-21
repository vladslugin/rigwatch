/**
 * Synthetic event log per rig. Each rig gets a deterministic 30+ event
 * stream covering the kinds of things a mining controller actually emits:
 * firmware updates, pool switches, thermal alerts, hashrate dips, etc.
 *
 * The generator pulls characteristics off the RigProfile so a `degraded`
 * rig sees more recovery cycles, a `throttling` rig sees more thermal
 * alerts, and an `efficient` rig is mostly clean.
 */

import { RIGS } from './rigData';
import type { RigProfile } from './rigData';

export type EventType =
  | 'firmware_update'
  | 'restart'
  | 'pool_switch'
  | 'thermal_alert'
  | 'share_reject_spike'
  | 'hashboard_drop'
  | 'hashboard_recover'
  | 'auto_tune'
  | 'connection_loss'
  | 'connection_restored'
  | 'block_found'
  | 'ownership_transfer';

export type EventSeverity = 'info' | 'success' | 'warn' | 'error';

export interface RigEvent {
  id: string;
  rigId: string;
  type: EventType;
  severity: EventSeverity;
  timestamp: number;
  title: string;
  details: string;
}

const EVENT_META: Record<EventType, {
  severity: EventSeverity;
  weight: number; // higher = more likely to appear
  titleTpl: (rig: RigProfile, ctx: any) => string;
  detailsTpl: (rig: RigProfile, ctx: any) => string;
}> = {
  firmware_update: {
    severity: 'success',
    weight: 1,
    titleTpl: (rig) => `Firmware updated to ${rig.firmware}`,
    detailsTpl: (rig) => `Updated from BMOS 1.3.7 → ${rig.firmware} · 11.3 MB · 4m 22s downtime`,
  },
  restart: {
    severity: 'info',
    weight: 3,
    titleTpl: () => 'Controller restarted',
    detailsTpl: () => 'Cold boot after manual reset · 23.4s to first share',
  },
  pool_switch: {
    severity: 'info',
    weight: 2,
    titleTpl: (rig, ctx) => `Switched pool to ${ctx.toPool}`,
    detailsTpl: (rig, ctx) =>
      `From ${ctx.fromPool} (${ctx.fromPing}ms) → ${ctx.toPool} (${ctx.toPing}ms) · failover`,
  },
  thermal_alert: {
    severity: 'warn',
    weight: 4,
    titleTpl: (_rig, ctx) => `Hashboard ${ctx.board} exceeded ${ctx.threshold}°C`,
    detailsTpl: (_rig, ctx) =>
      `Peak ${ctx.peak.toFixed(1)}°C · fans escalated to 100% PWM · clock derated to ${ctx.clock} MHz`,
  },
  share_reject_spike: {
    severity: 'warn',
    weight: 3,
    titleTpl: (_rig, ctx) => `Share rejection rate spiked to ${ctx.rate.toFixed(1)}%`,
    detailsTpl: (_rig, ctx) =>
      `Window: 5 min · ${ctx.rejected} rejected / ${ctx.accepted} accepted · likely pool latency`,
  },
  hashboard_drop: {
    severity: 'error',
    weight: 2,
    titleTpl: (_rig, ctx) => `Hashboard ${ctx.board} went offline`,
    detailsTpl: () =>
      `Auto-recovery initiated · re-enumerated chip count · 1m 14s impact`,
  },
  hashboard_recover: {
    severity: 'success',
    weight: 2,
    titleTpl: (_rig, ctx) => `Hashboard ${ctx.board} recovered`,
    detailsTpl: () => 'Chip count matches expected · hashrate restored to nominal',
  },
  auto_tune: {
    severity: 'info',
    weight: 2,
    titleTpl: (_rig, ctx) => `ASIC clock auto-tuned to ${ctx.clock} MHz`,
    detailsTpl: (_rig, ctx) =>
      `Voltage held at ${ctx.voltage}mV · projected gain +${ctx.gain.toFixed(1)}% J/TH`,
  },
  connection_loss: {
    severity: 'warn',
    weight: 2,
    titleTpl: (rig) => `Lost connection to ${rig.poolName}`,
    detailsTpl: (_rig, ctx) =>
      `Stratum socket closed by peer · reconnect attempted (${ctx.attempts}× before backoff)`,
  },
  connection_restored: {
    severity: 'success',
    weight: 2,
    titleTpl: (rig) => `Reconnected to ${rig.poolName}`,
    detailsTpl: (_rig, ctx) => `Resumed mining · ${ctx.downtime}s downtime · no orphan shares`,
  },
  block_found: {
    severity: 'success',
    weight: 0.4,
    titleTpl: (_rig, ctx) => `Block found · #${ctx.height}`,
    detailsTpl: (_rig, ctx) =>
      `Pool round closed · est. reward ${ctx.reward.toFixed(6)} BTC · ${ctx.shareCount} shares contributed`,
  },
  ownership_transfer: {
    severity: 'info',
    weight: 0.2,
    titleTpl: () => 'Ownership transferred',
    detailsTpl: (_rig, ctx) => `From ${ctx.from} → ${ctx.to} · signed via wallet`,
  },
};

// Behavior multipliers — how likely each type of event is for this rig.
const BEHAVIOR_BIAS: Record<RigProfile['behavior'], Partial<Record<EventType, number>>> = {
  efficient: {
    thermal_alert: 0.1,
    share_reject_spike: 0.2,
    hashboard_drop: 0.05,
    block_found: 1.3,
  },
  stable: {},
  jittery: {
    share_reject_spike: 4,
    connection_loss: 3,
    auto_tune: 2,
  },
  throttling: {
    thermal_alert: 5,
    auto_tune: 2,
    hashboard_drop: 0.3,
  },
  degraded: {
    hashboard_drop: 4,
    hashboard_recover: 4,
    thermal_alert: 1.5,
    auto_tune: 1.5,
  },
  offline: {},
};

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

const pickWeighted = <T>(
  rand: () => number,
  items: T[],
  weight: (item: T) => number,
): T => {
  const totalWeight = items.reduce((sum, it) => sum + weight(it), 0);
  let r = rand() * totalWeight;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
};

const ROTATING_POOLS = ['Foundry USA', 'F2Pool', 'AntPool', 'Luxor', 'ViaBTC'];

const generateEventContext = (
  rig: RigProfile,
  type: EventType,
  rand: () => number,
): any => {
  switch (type) {
    case 'pool_switch': {
      const others = ROTATING_POOLS.filter((p) => p !== rig.poolName);
      const toPool = others[Math.floor(rand() * others.length)];
      return {
        fromPool: rig.poolName,
        toPool,
        fromPing: 60 + Math.floor(rand() * 80),
        toPing: 15 + Math.floor(rand() * 30),
      };
    }
    case 'thermal_alert':
      return {
        board: 1 + Math.floor(rand() * 3),
        threshold: 80 + Math.floor(rand() * 6),
        peak: 82 + rand() * 8,
        clock: 600 + Math.floor(rand() * 100),
      };
    case 'share_reject_spike':
      return {
        rate: 2 + rand() * 4,
        accepted: 1200 + Math.floor(rand() * 400),
        rejected: 30 + Math.floor(rand() * 60),
      };
    case 'hashboard_drop':
    case 'hashboard_recover':
      return { board: 1 + Math.floor(rand() * 3) };
    case 'auto_tune':
      return {
        clock: 650 + Math.floor(rand() * 100),
        voltage: 1180 + Math.floor(rand() * 80),
        gain: 0.5 + rand() * 2,
      };
    case 'connection_loss':
      return { attempts: 2 + Math.floor(rand() * 4) };
    case 'connection_restored':
      return { downtime: 12 + Math.floor(rand() * 90) };
    case 'block_found':
      return {
        height: 870_000 + Math.floor(rand() * 5000),
        reward: 0.05 + rand() * 0.25,
        shareCount: 8000 + Math.floor(rand() * 4000),
      };
    case 'ownership_transfer':
      return {
        from: '0xa4f1…0bee',
        to: rig.ownerWallet.slice(0, 6) + '…' + rig.ownerWallet.slice(-4),
      };
    default:
      return {};
  }
};

const generateEventsForRig = (rig: RigProfile): RigEvent[] => {
  const rand = mulberry32(hashString(rig.id + ':events'));
  const events: RigEvent[] = [];
  const types = Object.keys(EVENT_META) as EventType[];
  const bias = BEHAVIOR_BIAS[rig.behavior];

  // 32 events over the last 14 days (so roughly 2-3 per day).
  const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  const TARGET_COUNT = 32;

  if (rig.behavior === 'offline') {
    // Offline rigs get a single "went dark" event and that's it.
    events.push({
      id: `${rig.id}_offline`,
      rigId: rig.id,
      type: 'hashboard_drop',
      severity: 'error',
      timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000,
      title: 'Rig powered down',
      details: 'All hashboards offline · awaiting field service · 6d ago',
    });
    return events;
  }

  for (let i = 0; i < TARGET_COUNT; i++) {
    const type = pickWeighted(rand, types, (t) => {
      const base = EVENT_META[t].weight;
      const mult = bias[t] ?? 1;
      return base * mult;
    });
    const meta = EVENT_META[type];
    const ts = Date.now() - rand() * WINDOW_MS;
    const ctx = generateEventContext(rig, type, rand);
    events.push({
      id: `${rig.id}_${i}_${type}`,
      rigId: rig.id,
      type,
      severity: meta.severity,
      timestamp: ts,
      title: meta.titleTpl(rig, ctx),
      details: meta.detailsTpl(rig, ctx),
    });
  }

  // Always include the most recent firmware update at the very top.
  events.push({
    id: `${rig.id}_fw_recent`,
    rigId: rig.id,
    type: 'firmware_update',
    severity: 'success',
    timestamp: Date.now() - (3 * 60 + Math.floor(rand() * 120)) * 60 * 1000,
    title: `Firmware ${rig.firmware} installed`,
    details: `Auto-rollout from manufacturer channel · verified signature ${rig.firmware.replace(/\s/g, '_')}`,
  });

  return events.sort((a, b) => b.timestamp - a.timestamp);
};

const RIG_EVENTS = new Map<string, RigEvent[]>(
  RIGS.map((r) => [r.id, generateEventsForRig(r)]),
);

export const eventsForRig = (rigId: string): RigEvent[] =>
  RIG_EVENTS.get(rigId) ?? [];

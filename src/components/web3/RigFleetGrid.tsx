import { useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { realtimeDB } from '../../lib/firebase';
import { RIGS } from '../../lib/mock/rigData';
import type { RigProfile } from '../../lib/mock/rigData';
import { Cpu, MapPin, Activity, ChevronRight } from 'lucide-react';

/**
 * Pre-connect fleet browser. Renders 24 rigs as glass cards with live
 * telemetry pulled from the mock RTDB. Clicking a card fills the
 * connection input with the rig's ID and connects.
 *
 * Kept self-contained on purpose — it owns one big onValue listener for
 * the entire `temporaer` tree and derives all card state from that single
 * snapshot. No per-card listeners; no re-fetching on hover.
 */

type Telemetry = Partial<Record<string, number>>;

interface RigCardData extends RigProfile {
  hashrate: number;        // P field, TH/s (or unit per algo)
  temp: number;            // T field, °C
  powerW: number;          // CO2 field, W
  fanFront: number;        // PL field, %
  fanRear: number;         // SL field, %
  rigState: number;        // N field, 0..7
}

const STATE_LABEL: Record<number, { label: string; tone: 'online' | 'warn' | 'offline' | 'info' }> = {
  0: { label: 'Offline',     tone: 'offline' },
  1: { label: 'Booting',     tone: 'info' },
  2: { label: 'Syncing',     tone: 'info' },
  3: { label: 'Mining',      tone: 'online' },
  4: { label: 'Throttling',  tone: 'warn' },
  5: { label: 'Error',       tone: 'offline' },
  6: { label: 'Updating',    tone: 'info' },
  7: { label: 'Idle',        tone: 'warn' },
};

/**
 * NFT-style rarity tier — applies a glow + border treatment to each card.
 * Derived from the rig's static behavior profile so the visual is stable
 * across telemetry ticks (a rig doesn't go from Legendary to Common just
 * because its temperature rose by 1°C).
 */
type Rarity = 'legendary' | 'epic' | 'rare' | 'common' | 'offline';

const rarityOf = (rig: RigProfile): Rarity => {
  if (rig.behavior === 'offline') return 'offline';
  if (rig.behavior === 'efficient') return 'legendary';
  if (rig.behavior === 'stable') return 'epic';
  if (rig.behavior === 'jittery' || rig.behavior === 'throttling') return 'rare';
  return 'common'; // degraded
};

const RARITY_META: Record<Rarity, {
  label: string;
  textTone: string;
  hoverHalo: string;   // background for the absolute halo on hover
  topGlow: string;     // always-on subtle inner top glow
}> = {
  legendary: {
    label: 'Legendary',
    textTone: 'text-warning',
    hoverHalo: 'radial-gradient(ellipse 90% 70% at 50% 0%, rgba(251, 191, 36, 0.22), transparent 60%)',
    topGlow: 'radial-gradient(ellipse 100% 60% at 50% -10%, rgba(251, 191, 36, 0.10), transparent 70%)',
  },
  epic: {
    label: 'Epic',
    textTone: 'text-primary',
    hoverHalo: 'radial-gradient(ellipse 90% 70% at 50% 0%, rgba(168, 85, 247, 0.22), transparent 60%)',
    topGlow: 'radial-gradient(ellipse 100% 60% at 50% -10%, rgba(168, 85, 247, 0.10), transparent 70%)',
  },
  rare: {
    label: 'Rare',
    textTone: 'text-info',
    hoverHalo: 'radial-gradient(ellipse 90% 70% at 50% 0%, rgba(34, 211, 238, 0.18), transparent 60%)',
    topGlow: 'radial-gradient(ellipse 100% 60% at 50% -10%, rgba(34, 211, 238, 0.07), transparent 70%)',
  },
  common: {
    label: 'Common',
    textTone: 'text-muted-foreground',
    hoverHalo: 'radial-gradient(ellipse 90% 70% at 50% 0%, rgba(148, 163, 184, 0.08), transparent 60%)',
    topGlow: 'none',
  },
  offline: {
    label: 'Inactive',
    textTone: 'text-muted-foreground',
    hoverHalo: 'radial-gradient(ellipse 90% 70% at 50% 0%, rgba(148, 163, 184, 0.06), transparent 60%)',
    topGlow: 'none',
  },
};

const formatHashrate = (value: number, algo: RigProfile['algo']): string => {
  if (algo === 'SHA-256') return `${value.toFixed(1)} TH/s`;
  if (algo === 'kHeavyHash') return `${value.toFixed(2)} GH/s`;
  return `${value.toFixed(0)} MH/s`;
};

const formatLocation = (loc: string): string => {
  // "Reykjavík-DC1" → "Reykjavík"; "Austin-DC2" → "Austin"
  return loc.split('-')[0];
};

const formatUptime = (ms: number): string => {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d`;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(ms / (1000 * 60));
  return `${minutes}m`;
};

const shortAddr = (addr: string): string =>
  addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

interface Props {
  onConnect: (rigId: string) => void;
}

export const RigFleetGrid: React.FC<Props> = ({ onConnect }) => {
  const [telemetry, setTelemetry] = useState<Record<string, Telemetry>>({});

  // Single listener for the whole temporaer tree.
  useEffect(() => {
    if (!realtimeDB) return;
    const tempRef = ref(realtimeDB, 'temporaer');
    return onValue(tempRef, (snap) => {
      setTelemetry((snap.val() as Record<string, Telemetry>) ?? {});
    });
  }, []);

  const cards = useMemo<RigCardData[]>(() => {
    const now = Date.now();
    return RIGS.map((rig) => {
      const t = telemetry[rig.id] ?? {};
      return {
        ...rig,
        hashrate: typeof t.P === 'number' ? t.P : 0,
        temp: typeof t.T === 'number' ? t.T : 0,
        powerW: typeof t.CO2 === 'number' ? t.CO2 : 0,
        fanFront: typeof t.PL === 'number' ? t.PL : 0,
        fanRear: typeof t.SL === 'number' ? t.SL : 0,
        rigState: typeof t.N === 'number' ? t.N : 0,
      };
    });
  }, [telemetry]);

  // Aggregate stats for the header strip.
  const totals = useMemo(() => {
    const online = cards.filter((c) => c.rigState >= 2 && c.rigState <= 4 && c.behavior !== 'offline');
    const offline = cards.filter((c) => c.behavior === 'offline' || c.rigState === 0);
    const totalHashTH = cards
      .filter((c) => c.algo === 'SHA-256' && c.behavior !== 'offline')
      .reduce((acc, c) => acc + c.hashrate, 0);
    const totalPowerW = cards.reduce((acc, c) => acc + c.powerW, 0);
    return {
      onlineCount: online.length,
      offlineCount: offline.length,
      totalCount: cards.length,
      totalHashTH,
      totalPowerKW: totalPowerW / 1000,
    };
  }, [cards]);

  return (
    <section className="mt-10 w-full max-w-7xl mx-auto px-4 pb-12">
      {/* Header strip — fleet summary */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5 flex items-center gap-2">
            <span className="dot dot-online" />
            <span>Fleet · live</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Available <span className="text-gradient">rigs</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tap a card to connect. Telemetry updates every two seconds.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 md:gap-4 min-w-[280px]">
          <FleetStat label="Online"     value={`${totals.onlineCount}/${totals.totalCount}`} tone="online" />
          <FleetStat label="Hashrate"   value={`${totals.totalHashTH.toFixed(0)} TH/s`}      tone="info" />
          <FleetStat label="Power"      value={`${totals.totalPowerKW.toFixed(1)} kW`}      tone="warn" />
        </div>
      </div>

      {/* Card grid */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => (
          <RigCard key={c.id} card={c} onConnect={() => onConnect(c.id)} />
        ))}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FleetStat — compact metric tile in the header strip
// ─────────────────────────────────────────────────────────────────────────────

const FleetStat: React.FC<{
  label: string;
  value: string;
  tone: 'online' | 'info' | 'warn';
}> = ({ label, value, tone }) => (
  <div className="rounded-xl border border-border bg-card/50 backdrop-blur-md px-3.5 py-2.5">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
      <span className={`dot dot-${tone}`} />
      <span>{label}</span>
    </div>
    <div className="text-base font-semibold text-foreground mt-1 font-mono">{value}</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// RigCard — the headline card for an individual rig
// ─────────────────────────────────────────────────────────────────────────────

const RigCard: React.FC<{ card: RigCardData; onConnect: () => void }> = ({ card, onConnect }) => {
  const state = STATE_LABEL[card.rigState] ?? STATE_LABEL[0];
  const isOffline = card.behavior === 'offline' || card.rigState === 0;
  const isThrottling = card.behavior === 'throttling' || card.rigState === 4;
  const isHot = card.temp >= 75;

  const rarity = rarityOf(card);
  const rarityMeta = RARITY_META[rarity];

  // Legendary cards get an animated conic-gradient border; others get the
  // static gradient hairline. The wrapper class chains determine which.
  const borderClass = rarity === 'legendary'
    ? 'gradient-border-rotating'
    : rarity === 'epic' || rarity === 'rare'
    ? 'gradient-border'
    : '';

  return (
    <button
      type="button"
      onClick={onConnect}
      className={`group relative text-left rounded-2xl bg-card border border-border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 overflow-hidden ${borderClass}`}
      style={{
        boxShadow: isOffline ? 'none' : '0 1px 0 rgba(255,255,255,0.04) inset',
      }}
    >
      {/* Always-on top glow — picks up the rarity tone without animation. */}
      {rarityMeta.topGlow !== 'none' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{ background: rarityMeta.topGlow, zIndex: 0 }}
        />
      )}

      {/* Hover halo — sits behind everything via z-index, picks up the
          rarity-colored glow on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: rarityMeta.hoverHalo, zIndex: 0 }}
      />

      {/* Rarity stamp — top-right corner, very small */}
      <span
        className={`pointer-events-none absolute top-2 right-2 z-20 text-[8px] uppercase tracking-[0.18em] font-medium ${rarityMeta.textTone}`}
      >
        {rarityMeta.label}
      </span>

      {/* Header row — name + status pill */}
      <div className="relative z-10 flex items-start justify-between gap-3 pr-16">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {card.algo}
          </div>
          <div className="text-base font-semibold text-foreground mt-0.5 truncate">{card.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <Cpu className="h-3 w-3 opacity-70" />
            <span className="truncate">{card.model}</span>
          </div>
        </div>
        <span className={`pill pill-${state.tone} shrink-0 self-start mt-4`}>{state.label}</span>
      </div>

      {/* Headline metric */}
      <div className="relative z-10 mt-4 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tracking-tight font-mono ${isOffline ? 'text-muted-foreground' : 'text-gradient'}`}>
          {isOffline ? '—' : (
            card.algo === 'SHA-256'
              ? card.hashrate.toFixed(1)
              : card.algo === 'kHeavyHash'
              ? card.hashrate.toFixed(2)
              : card.hashrate.toFixed(0)
          )}
        </span>
        <span className="text-xs text-muted-foreground font-mono">
          {card.algo === 'SHA-256' ? 'TH/s' : card.algo === 'kHeavyHash' ? 'GH/s' : 'MH/s'}
        </span>
      </div>

      {/* Sub-metrics: temp, power, fans, location */}
      <div className="relative z-10 mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <MicroStat label="Temp"  value={isOffline ? '—' : `${card.temp.toFixed(1)}°C`} highlight={isHot ? 'warn' : undefined} />
        <MicroStat label="Power" value={isOffline ? '—' : `${(card.powerW / 1000).toFixed(2)} kW`} />
        <MicroStat label="Fans"  value={isOffline ? '—' : `${Math.round((card.fanFront + card.fanRear) / 2)}%`} highlight={isThrottling ? 'warn' : undefined} />
        <MicroStat label="Uptime" value={formatUptime(Date.now() - card.startedAt)} />
      </div>

      {/* Footer — location + owner addr + chevron */}
      <div className="relative z-10 mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
          <MapPin className="h-3 w-3 opacity-70 shrink-0" />
          <span className="truncate">{formatLocation(card.location)}</span>
          <span className="opacity-40">·</span>
          <span className="font-mono truncate" title={card.ownerWallet}>{shortAddr(card.ownerWallet)}</span>
        </div>
        <span className="flex items-center gap-1 text-[10px] font-medium text-primary/80 group-hover:text-primary transition-colors">
          <Activity className="h-3 w-3" />
          <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </button>
  );
};

const MicroStat: React.FC<{
  label: string;
  value: string;
  highlight?: 'warn' | 'info';
}> = ({ label, value, highlight }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground uppercase tracking-wider text-[9px]">{label}</span>
    <span
      className={`font-mono ${
        highlight === 'warn' ? 'text-warning' : highlight === 'info' ? 'text-info' : 'text-foreground/90'
      }`}
    >
      {value}
    </span>
  </div>
);

export default RigFleetGrid;

import { useMemo } from 'react';
import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { Cpu, TrendingUp, ChevronRight } from 'lucide-react';
import { realtimeDB } from '../../lib/firebase';
import { RIGS, RIG_MODELS } from '../../lib/mock/rigData';

/**
 * Fleet inventory — breaks down the 24-rig fleet by model. Each tile
 * shows count, contributed hashrate, average J/TH efficiency, and a
 * health distribution mini-bar (legendary / epic / rare / common /
 * inactive).
 *
 * Sits under the hero card on the pre-connect screen so an operator
 * sees the shape of the fleet before drilling into individual rigs.
 */

type Telemetry = Partial<Record<string, number>>;

interface ModelStats {
  article_number: string;
  name: string;
  vendor: string;
  cooling: string;
  algo: string;
  count: number;
  totalHashrate: number;        // sum of live hashrates (TH/s for SHA, scaled units otherwise)
  totalPowerW: number;
  avgEfficiency: number;        // J/TH (SHA only — others ignored)
  /** Rarity counts in the order: legendary, epic, rare, common, offline. */
  rarityCounts: [number, number, number, number, number];
}

const rarityIdx = (behavior: string): 0 | 1 | 2 | 3 | 4 => {
  if (behavior === 'efficient') return 0;
  if (behavior === 'stable')    return 1;
  if (behavior === 'jittery' || behavior === 'throttling') return 2;
  if (behavior === 'degraded')  return 3;
  return 4;
};

const formatHashrate = (value: number, algo: string): string => {
  if (algo === 'SHA-256')    return `${value.toFixed(0)} TH/s`;
  if (algo === 'kHeavyHash') return `${value.toFixed(0)} GH/s`;
  return `${value.toFixed(0)} MH/s`;
};

export const FleetInventoryPanel: React.FC<{ onSelectRig?: (rigId: string) => void }> = ({ onSelectRig }) => {
  const [telemetry, setTelemetry] = useState<Record<string, Telemetry>>({});

  useEffect(() => {
    if (!realtimeDB) return;
    const tempRef = ref(realtimeDB, 'temporaer');
    return onValue(tempRef, (snap) => {
      setTelemetry((snap.val() as Record<string, Telemetry>) ?? {});
    });
  }, []);

  const stats = useMemo<ModelStats[]>(() => {
    const byModel = new Map<string, ModelStats>();

    for (const modelMeta of RIG_MODELS) {
      byModel.set(modelMeta.name, {
        article_number: modelMeta.article_number,
        name: modelMeta.name,
        vendor: modelMeta.vendor,
        cooling: modelMeta.cooling,
        algo: modelMeta.algo,
        count: 0,
        totalHashrate: 0,
        totalPowerW: 0,
        avgEfficiency: 0,
        rarityCounts: [0, 0, 0, 0, 0],
      });
    }

    const effSums: Record<string, { sum: number; n: number }> = {};

    for (const rig of RIGS) {
      const entry = byModel.get(rig.model);
      if (!entry) continue;
      const t = telemetry[rig.id] ?? {};
      const hashrate = typeof t.P === 'number' ? t.P : 0;
      const powerW   = typeof t.CO2 === 'number' ? t.CO2 : 0;
      entry.count += 1;
      entry.totalHashrate += hashrate;
      entry.totalPowerW += powerW;
      entry.rarityCounts[rarityIdx(rig.behavior)] += 1;

      if (entry.algo === 'SHA-256' && hashrate > 0) {
        const eff = powerW / hashrate;
        const cur = effSums[rig.model] ?? { sum: 0, n: 0 };
        cur.sum += eff;
        cur.n += 1;
        effSums[rig.model] = cur;
      }
    }

    // Compute averages, drop models with 0 rigs in the fleet
    return Array.from(byModel.values())
      .filter((m) => m.count > 0)
      .map((m) => {
        const eff = effSums[m.name];
        m.avgEfficiency = eff ? eff.sum / eff.n : 0;
        return m;
      })
      .sort((a, b) => b.totalHashrate - a.totalHashrate);
  }, [telemetry]);

  // Find the highest hashrate rig of a given model — used as the "pick one"
  // shortcut when the user clicks the inventory tile.
  const pickRigOfModel = (modelName: string): string | null => {
    const candidates = RIGS.filter((r) => r.model === modelName && r.behavior !== 'offline');
    if (!candidates.length) return null;
    return candidates[0].id;
  };

  return (
    <section className="mt-10 w-full max-w-7xl mx-auto px-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-5">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5 flex items-center gap-2">
            <Cpu className="h-3 w-3 text-info" />
            <span>Fleet · Inventory</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            By <span className="text-gradient">model</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.length} active hardware lines · {stats.reduce((s, m) => s + m.count, 0)} rigs total
          </p>
        </div>
      </div>

      {/* Tiles */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((m) => (
          <ModelTile
            key={m.name}
            stats={m}
            onClick={() => {
              const id = pickRigOfModel(m.name);
              if (id && onSelectRig) onSelectRig(id);
            }}
          />
        ))}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const RARITY_COLORS = [
  'rgba(251, 191, 36, 0.85)',   // legendary
  'rgba(168, 85, 247, 0.85)',   // epic
  'rgba(34, 211, 238, 0.75)',   // rare
  'rgba(148, 163, 184, 0.55)',  // common
  'rgba(148, 163, 184, 0.18)',  // offline
];

const RARITY_LABELS = ['Legendary', 'Epic', 'Rare', 'Common', 'Inactive'];

const ModelTile: React.FC<{ stats: ModelStats; onClick: () => void }> = ({ stats, onClick }) => {
  const totalRarity = stats.rarityCounts.reduce((s, n) => s + n, 0);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative text-left rounded-2xl bg-card border border-border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 overflow-hidden"
    >
      {/* Subtle gradient halo on the right */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-50 group-hover:opacity-100 transition-opacity"
        style={{ background: 'radial-gradient(ellipse 60% 80% at 100% 50%, rgba(168, 85, 247, 0.08), transparent 60%)' }}
      />

      {/* Header row */}
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            {stats.vendor} · {stats.cooling} · {stats.algo}
          </div>
          <div className="text-base font-semibold text-foreground mt-0.5 truncate">{stats.name}</div>
        </div>
        <span className="pill pill-neutral shrink-0 self-start mt-1 font-mono">
          ×{stats.count}
        </span>
      </div>

      {/* Main metric */}
      <div className="relative z-10 mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight font-mono text-gradient">
          {formatHashrate(stats.totalHashrate, stats.algo)}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          aggregate
        </span>
      </div>

      {/* Sub-metrics */}
      <div className="relative z-10 mt-2 grid grid-cols-2 gap-2 text-[10px]">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <TrendingUp className="h-3 w-3 opacity-70" />
          <span>Avg eff.</span>
          <span className="font-mono text-foreground/90">
            {stats.algo === 'SHA-256' && stats.avgEfficiency > 0
              ? `${stats.avgEfficiency.toFixed(1)} J/TH`
              : '—'}
          </span>
        </div>
        <div className="text-muted-foreground text-right font-mono">
          {(stats.totalPowerW / 1000).toFixed(1)} kW
        </div>
      </div>

      {/* Rarity distribution bar */}
      {totalRarity > 0 && (
        <div className="relative z-10 mt-3">
          <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-muted/40">
            {stats.rarityCounts.map((n, i) => {
              if (n === 0) return null;
              const width = (n / totalRarity) * 100;
              return (
                <div
                  key={i}
                  style={{ width: `${width}%`, background: RARITY_COLORS[i] }}
                  title={`${RARITY_LABELS[i]}: ${n}`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground">
            {stats.rarityCounts.map((n, i) =>
              n > 0 ? (
                <span key={i} className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-sm" style={{ background: RARITY_COLORS[i] }} />
                  {RARITY_LABELS[i]} <span className="font-mono opacity-70">{n}</span>
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* CTA hint */}
      <div className="relative z-10 mt-3 pt-3 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Tap to inspect a rig of this model</span>
        <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
      </div>
    </button>
  );
};

export default FleetInventoryPanel;

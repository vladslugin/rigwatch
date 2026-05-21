import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, ChevronDown, ChevronRight, Thermometer } from 'lucide-react';
import { useRigStore } from '../../store/useRigStore';
import { RIG_BY_ID } from '../../lib/mock/rigData';
import { eventsForRig } from '../../lib/mock/events';

/**
 * Mining health surface. Three collapsible sub-panels that surface the
 * three things a NOC engineer cares about when triaging a rig:
 *
 *   1. Hashboard temp heatmap (3 boards × 24 hourly buckets) — patterns
 *      jump out visually when a board is consistently hotter.
 *   2. Share rejection bar chart (24 hourly bars, accepted vs. rejected)
 *      — operator can spot a pool incident without parsing logs.
 *   3. Critical events list (errors + warnings from the event stream).
 *
 * Data is synthesized deterministically off the rig profile + behaviour,
 * so the same rig always shows the same patterns.
 */

const HOURS = 24;
const BOARDS = 3;

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

// 4-stop colour ramp — matches the airflow visualizer so the heatmap
// and the cooling diagram speak the same colour language. Stops chosen
// so hardware-operator-relevant bands (cool / warm / hot / critical) are
// visually distinct rather than smooth gradients of one tone.
const tempToColor = (c: number): string => {
  if (c < 50)  return 'hsl(152, 70%, 50%)';
  if (c < 65)  return `hsl(${(152 - (c - 50) * 4).toFixed(0)}, 72%, 50%)`;
  if (c < 75)  return `hsl(${(92 - (c - 65) * 3.2).toFixed(0)}, 80%, 52%)`;
  if (c < 82)  return `hsl(${(60 - (c - 75) * 5).toFixed(0)}, 84%, 54%)`;
  if (c < 88)  return `hsl(${(25 - (c - 82) * 3).toFixed(0)}, 88%, 52%)`;
  return `hsl(${Math.max(348, 7 - (c - 88) * 1).toFixed(0)}, 88%, 50%)`;
};

const tempToBg = (c: number): string => {
  const alpha = c < 55 ? 0.32 : c < 70 ? 0.45 : c < 80 ? 0.6 : c < 88 ? 0.75 : 0.85;
  return tempToColor(c).replace('hsl(', 'hsla(').replace(')', `, ${alpha.toFixed(2)})`);
};

export const MiningHealthPanel: React.FC = () => {
  const deviceId = useRigStore((s) => s.deviceId);
  const profile = deviceId ? RIG_BY_ID.get(deviceId) : undefined;

  const [openHeatmap, setOpenHeatmap] = useState(true);
  const [openBars, setOpenBars] = useState(true);
  const [openEvents, setOpenEvents] = useState(true);

  const data = useMemo(() => {
    if (!profile) return null;
    const rand = mulberry32(hashString(profile.id + ':health'));

    // Generate 3×24 hashboard temp grid. Each board carries a base
    // temperature (middle board hotter — typical airflow access pattern),
    // a behaviour bias, a strong daily cycle (DC ambient drifts up
    // during the day), and per-rig spike events.
    const heatmap: number[][] = [];
    const baseTemps = [64, 71, 66]; // middle board hotter
    const behaviorBias =
      profile.behavior === 'throttling' ? 14 :
      profile.behavior === 'degraded'   ? 7 :
      profile.behavior === 'efficient'  ? -9 :
      profile.behavior === 'jittery'    ? 3 :
      0;
    // Pre-pick which 2-3 hourly buckets get a thermal spike — shared
    // across all boards so spikes look like a real "the room got hot
    // around 13:00" event rather than independent randoms.
    const spikeHours = new Set<number>();
    const numSpikes = profile.behavior === 'throttling' ? 4 : profile.behavior === 'jittery' ? 3 : 1;
    for (let i = 0; i < numSpikes; i++) {
      spikeHours.add(Math.floor(rand() * HOURS));
    }
    for (let b = 0; b < BOARDS; b++) {
      const row: number[] = [];
      const baseline = baseTemps[b];
      for (let h = 0; h < HOURS; h++) {
        // Daily cycle: ±6°C swing. Hottest around hour 14-16 (afternoon
        // load + warm DC ambient), coolest around hour 4-6 (night).
        const dayPhase = -Math.cos(((h - 15) / 24) * Math.PI * 2) * 6;
        // Per-board, per-hour stochastic noise.
        const noise = (rand() - 0.5) * 3;
        // Thermal spike — sharper on the middle board.
        const spike = spikeHours.has(h) ? 6 + rand() * (b === 1 ? 6 : 3) : 0;
        row.push(baseline + behaviorBias + dayPhase + noise + spike);
      }
      heatmap.push(row);
    }

    // Share rejection bars — 24 hourly buckets of accepted/rejected
    const bars: { accepted: number; rejected: number; hour: number }[] = [];
    const rejectRate =
      profile.behavior === 'jittery' ? 0.038 :
      profile.behavior === 'throttling' ? 0.025 :
      profile.behavior === 'degraded' ? 0.022 :
      0.008;
    for (let h = 0; h < HOURS; h++) {
      const acceptedBase = 1300 + Math.floor(rand() * 250);
      const spike = rand() < 0.1 ? 2 : 1;
      const rejected = Math.floor(acceptedBase * rejectRate * spike * (0.5 + rand()));
      bars.push({
        hour: h,
        accepted: acceptedBase - rejected,
        rejected,
      });
    }

    return { heatmap, bars };
  }, [profile]);

  const criticalEvents = useMemo(
    () => (deviceId ? eventsForRig(deviceId).filter((e) => e.severity === 'warn' || e.severity === 'error').slice(0, 6) : []),
    [deviceId],
  );

  if (!profile || !data) {
    return (
      <div className="rounded-2xl bg-card border border-border p-8 text-center text-sm text-muted-foreground">
        Connect a rig to view health diagnostics.
      </div>
    );
  }

  const hottestBoard = data.heatmap.reduce<{ idx: number; temp: number }>(
    (acc, row, idx) => {
      const peak = Math.max(...row);
      return peak > acc.temp ? { idx, temp: peak } : acc;
    },
    { idx: 0, temp: 0 },
  );

  const totalRejected = data.bars.reduce((acc, b) => acc + b.rejected, 0);
  const totalAccepted = data.bars.reduce((acc, b) => acc + b.accepted, 0);
  const rejectPct = (totalRejected / (totalRejected + totalAccepted)) * 100;

  return (
    <div className="space-y-3">
      {/* Hashboard temperature heatmap */}
      <Section
        open={openHeatmap}
        onToggle={() => setOpenHeatmap((v) => !v)}
        icon={Thermometer}
        title="Hashboard temp · 24h"
        sub={`Peak HB${hottestBoard.idx + 1} ${hottestBoard.temp.toFixed(1)}°C`}
        tone={hottestBoard.temp >= 80 ? 'warn' : 'ok'}
      >
        <div className="space-y-1.5">
          {data.heatmap.map((row, b) => (
            <div key={b} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[10px] font-mono text-muted-foreground">HB{b + 1}</span>
              <div className="flex-1 flex gap-[2px]">
                {row.map((temp, h) => (
                  <div
                    key={h}
                    className="flex-1 h-5 rounded-[3px] border border-transparent hover:border-primary/40 transition-colors"
                    style={{ backgroundColor: tempToBg(temp) }}
                    title={`${(HOURS - h)}h ago — ${temp.toFixed(1)}°C`}
                  />
                ))}
              </div>
              <span className="w-12 shrink-0 text-[10px] font-mono text-right" style={{ color: tempToColor(Math.max(...row)) }}>
                {Math.max(...row).toFixed(0)}°C
              </span>
            </div>
          ))}
          <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-2 pl-10">
            <span>24h ago</span>
            <span>12h ago</span>
            <span>now</span>
          </div>
        </div>
      </Section>

      {/* Share rejection bar chart */}
      <Section
        open={openBars}
        onToggle={() => setOpenBars((v) => !v)}
        icon={BarChart3}
        title="Share rejection · 24h"
        sub={`${rejectPct.toFixed(2)}% rejected · ${totalAccepted.toLocaleString()} accepted`}
        tone={rejectPct >= 2 ? 'warn' : 'ok'}
      >
        <ShareBars bars={data.bars} />
      </Section>

      {/* Critical events */}
      <Section
        open={openEvents}
        onToggle={() => setOpenEvents((v) => !v)}
        icon={AlertTriangle}
        title="Critical events · 14d"
        sub={`${criticalEvents.length} unresolved · most recent ${formatRelative(criticalEvents[0]?.timestamp ?? 0)}`}
        tone={criticalEvents.length > 4 ? 'warn' : 'ok'}
      >
        <div className="space-y-1.5">
          {criticalEvents.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-3">
              No warnings or errors in the last 14 days.
            </div>
          ) : (
            criticalEvents.map((e) => (
              <div
                key={e.id}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${
                  e.severity === 'error' ? 'border-destructive/25 bg-destructive/5' : 'border-warning/25 bg-warning/5'
                }`}
              >
                <AlertTriangle className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${e.severity === 'error' ? 'text-destructive' : 'text-warning'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-medium text-foreground">{e.title}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{formatRelative(e.timestamp)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{e.details}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
};

const formatRelative = (ts: number): string => {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

const Section: React.FC<{
  open: boolean;
  onToggle: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  tone: 'ok' | 'warn';
  children: React.ReactNode;
}> = ({ open, onToggle, icon: Icon, title, sub, tone, children }) => (
  <div className="rounded-2xl bg-card border border-border overflow-hidden">
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        <span className={`inline-flex h-7 w-7 rounded-md items-center justify-center ${
          tone === 'warn' ? 'bg-warning/15' : 'bg-info/15'
        }`}>
          <Icon className={`h-3.5 w-3.5 ${tone === 'warn' ? 'text-warning' : 'text-info'}`} />
        </span>
        <div className="text-left">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-[11px] text-muted-foreground">{sub}</div>
        </div>
      </div>
      {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
    {open && <div className="px-4 pb-4">{children}</div>}
  </div>
);

const ShareBars: React.FC<{ bars: { accepted: number; rejected: number; hour: number }[] }> = ({ bars }) => {
  const maxTotal = Math.max(...bars.map((b) => b.accepted + b.rejected));
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-[3px] h-24">
        {bars.map((b, i) => {
          const total = b.accepted + b.rejected;
          const accHeight = total > 0 ? (b.accepted / maxTotal) * 100 : 0;
          const rejHeight = total > 0 ? (b.rejected / maxTotal) * 100 : 0;
          const rejRate = total > 0 ? (b.rejected / total) * 100 : 0;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col-reverse justify-end gap-[1px] group relative"
              title={`${24 - i}h ago — ${b.accepted} ok / ${b.rejected} rejected (${rejRate.toFixed(2)}%)`}
            >
              <div
                className="bg-success/60 rounded-t-sm group-hover:bg-success transition-colors"
                style={{ height: `${accHeight}%`, minHeight: '1px' }}
              />
              {rejHeight > 0 && (
                <div
                  className="bg-destructive/80 group-hover:bg-destructive transition-colors"
                  style={{ height: `${rejHeight}%`, minHeight: '1px' }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
        <span>24h ago</span>
        <span>12h ago</span>
        <span>now</span>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground mt-1">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-success/60" /> Accepted
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-destructive/80" /> Rejected
        </span>
      </div>
    </div>
  );
};

export default MiningHealthPanel;

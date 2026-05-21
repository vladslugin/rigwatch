import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Rewind, FastForward, X, History, Activity } from 'lucide-react';
import { useRigStore } from '../../store/useRigStore';
import { useReplayStore } from '../../store/useReplayStore';
import { sampleRange, snapshotAt } from '../../lib/mock/historicalTelemetry';
import { RIG_BY_ID } from '../../lib/mock/rigData';

/**
 * Replay timeline — lets the operator scrub through the last 24 hours of
 * telemetry. A horizontal track at the top sets the position; four
 * sparklines below show how each key metric trended around that point;
 * a play/pause control + speed selector animates playback so the
 * dashboard can be put in "rewind" mode.
 *
 * Synthetic backend — historical samples are computed on demand via
 * `sampleAt`, so the panel works even right after a fresh page load with
 * no telemetry history accumulated yet.
 */

const SPEEDS: { value: 1 | 4 | 16 | 60 | 240; label: string }[] = [
  { value: 1,   label: '1×' },
  { value: 4,   label: '4×' },
  { value: 16,  label: '16×' },
  { value: 60,  label: '60×' },
  { value: 240, label: '240×' },
];

const formatClock = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatRelative = (ms: number): string => {
  const diff = Date.now() - ms;
  if (Math.abs(diff) < 60_000) return 'live';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}h ${mm}m ago` : `${h}h ago`;
};

export const ReplayPanel: React.FC = () => {
  const deviceId = useRigStore((s) => s.deviceId);
  const {
    mode, positionMs, playing, speed,
    windowStartMs, windowEndMs,
    enterReplay, exitReplay, setPosition, toggle, setSpeed,
  } = useReplayStore();

  // Lazy expand control. Collapsed by default to keep the dashboard tidy;
  // operator clicks to expand → panel reveals + replay mode engages.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && mode === 'live') enterReplay();
    if (!expanded && mode === 'replay') exitReplay();
  }, [expanded, mode, enterReplay, exitReplay]);

  const profile = deviceId ? RIG_BY_ID.get(deviceId) : undefined;

  // Pull 144 samples across the 24h window (10-min step) for the sparklines.
  const series = useMemo(() => {
    if (!deviceId) return null;
    const samples = sampleRange(deviceId, windowStartMs, windowEndMs, 10 * 60 * 1000);
    if (samples.length === 0) return null;
    return {
      samples,
      hashMin: Math.min(...samples.map((s) => s.hashrate)),
      hashMax: Math.max(...samples.map((s) => s.hashrate)),
      tempMin: Math.min(...samples.map((s) => s.temp)),
      tempMax: Math.max(...samples.map((s) => s.temp)),
      powerMin: Math.min(...samples.map((s) => s.powerW)),
      powerMax: Math.max(...samples.map((s) => s.powerW)),
      fanMin: Math.min(...samples.map((s) => Math.max(s.intakePwm, s.exhaustPwm))),
      fanMax: Math.max(...samples.map((s) => Math.max(s.intakePwm, s.exhaustPwm))),
    };
  }, [deviceId, windowStartMs, windowEndMs]);

  // Current scrubbed sample
  const currentSnap = useMemo(
    () => (deviceId ? snapshotAt(deviceId, positionMs) : null),
    [deviceId, positionMs],
  );

  // Drag handling for the timeline track
  const trackRef = useRef<HTMLDivElement>(null);
  const onTrackPointer = (e: React.PointerEvent) => {
    if (!trackRef.current) return;
    const r = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setPosition(windowStartMs + ratio * (windowEndMs - windowStartMs));
  };

  if (!deviceId || !profile) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="group w-full rounded-2xl bg-card/40 border border-border hover:border-primary/40 hover:bg-card transition-all px-4 py-3 flex items-center gap-3 text-left"
      >
        <span className="inline-flex h-8 w-8 rounded-md bg-primary/15 items-center justify-center">
          <History className="h-4 w-4 text-primary" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">Replay timeline</div>
          <div className="text-[11px] text-muted-foreground">
            Scrub through the last 24 hours of telemetry · expand to enter rewind mode
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-primary/80 group-hover:text-primary transition-colors">
          Open →
        </span>
      </button>
    );
  }

  const ratio = (positionMs - windowStartMs) / (windowEndMs - windowStartMs);
  const isAtLive = positionMs >= windowEndMs - 30_000;

  return (
    <div className="relative rounded-2xl bg-card border border-primary/30 overflow-hidden">
      {/* Active-state banner — strong colour so it's obvious the dashboard
          is NOT showing live data while this is open. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(168, 85, 247, 0.16), transparent 60%)',
        }}
      />

      <div className="relative z-10 p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
              <History className="h-3 w-3 text-primary" />
              <span>Replay · 24h scrub</span>
              {!isAtLive && (
                <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-warning font-medium uppercase">
                  <span className="dot dot-warn" />
                  Historical
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-semibold tracking-tight font-mono text-foreground">
                {formatClock(positionMs)}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatRelative(positionMs)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-3 w-3" />
            <span>Close</span>
          </button>
        </div>

        {/* Snapshot tiles — show numerical readout at the scrub position */}
        {currentSnap && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            <ReadoutTile label="Hashrate" value={`${currentSnap.hashrate.toFixed(1)}`} unit={profile.algo === 'SHA-256' ? 'TH/s' : profile.algo === 'kHeavyHash' ? 'GH/s' : 'MH/s'} />
            <ReadoutTile label="Hottest board" value={`${currentSnap.temp.toFixed(1)}`} unit="°C" warn={currentSnap.temp >= 80} />
            <ReadoutTile label="Fans" value={`${Math.max(currentSnap.intakePwm, currentSnap.exhaustPwm).toFixed(0)}`} unit="% PWM" warn={Math.max(currentSnap.intakePwm, currentSnap.exhaustPwm) >= 95} />
            <ReadoutTile label="Power" value={`${(currentSnap.powerW / 1000).toFixed(2)}`} unit="kW" />
          </div>
        )}

        {/* Timeline track */}
        <div className="mb-4">
          <div
            ref={trackRef}
            className="relative h-9 rounded-lg bg-card/60 border border-border cursor-pointer select-none"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onTrackPointer(e); }}
            onPointerMove={(e) => { if (e.buttons === 1) onTrackPointer(e); }}
          >
            {/* Tick marks at every 3 hours */}
            {Array.from({ length: 9 }).map((_, i) => (
              <span
                key={i}
                className="absolute top-1 bottom-1 w-px bg-border"
                style={{ left: `${(i / 8) * 100}%` }}
              />
            ))}

            {/* Filled track up to current position */}
            <span
              className="absolute top-1 bottom-1 left-1 rounded bg-primary/15 border border-primary/30"
              style={{ width: `calc(${(ratio * 100).toFixed(2)}% - 2px)` }}
            />

            {/* Handle */}
            <span
              className="absolute top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-primary border-2 border-background shadow-lg shadow-primary/40 transition-transform group-hover:scale-110"
              style={{ left: `calc(${(ratio * 100).toFixed(2)}% - 14px)`, pointerEvents: 'none' }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
            <span>{formatClock(windowStartMs)}</span>
            <span>−18h</span>
            <span>−12h</span>
            <span>−6h</span>
            <span>now</span>
          </div>
        </div>

        {/* Sparklines */}
        {series && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            <Sparkline
              label="Hashrate"
              data={series.samples}
              accessor={(s) => s.hashrate}
              min={series.hashMin * 0.95}
              max={series.hashMax * 1.02}
              color="rgb(168, 85, 247)"
              currentMs={positionMs}
              windowStart={windowStartMs}
              windowEnd={windowEndMs}
            />
            <Sparkline
              label="Temp"
              data={series.samples}
              accessor={(s) => s.temp}
              min={series.tempMin - 2}
              max={series.tempMax + 2}
              color="rgb(34, 211, 238)"
              currentMs={positionMs}
              windowStart={windowStartMs}
              windowEnd={windowEndMs}
            />
            <Sparkline
              label="Fans"
              data={series.samples}
              accessor={(s) => Math.max(s.intakePwm, s.exhaustPwm)}
              min={Math.max(0, series.fanMin - 5)}
              max={Math.min(100, series.fanMax + 5)}
              color="rgb(251, 191, 36)"
              currentMs={positionMs}
              windowStart={windowStartMs}
              windowEnd={windowEndMs}
            />
            <Sparkline
              label="Power"
              data={series.samples}
              accessor={(s) => s.powerW / 1000}
              min={series.powerMin / 1000 * 0.95}
              max={series.powerMax / 1000 * 1.05}
              color="rgb(16, 185, 129)"
              currentMs={positionMs}
              windowStart={windowStartMs}
              windowEnd={windowEndMs}
            />
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPosition(positionMs - 60 * 60 * 1000)}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-colors"
            title="Step back 1 hour"
          >
            <Rewind className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={toggle}
            className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium text-sm"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            onClick={() => setPosition(positionMs + 60 * 60 * 1000)}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-colors"
            title="Step forward 1 hour"
          >
            <FastForward className="h-3.5 w-3.5" />
          </button>

          <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5 ml-1">
            {SPEEDS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSpeed(opt.value)}
                className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                  speed === opt.value
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="ml-auto inline-flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setPosition(windowEndMs)}
              disabled={isAtLive}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md border transition-colors font-medium ${
                isAtLive
                  ? 'border-border bg-card/40 text-muted-foreground cursor-default'
                  : 'border-success/30 bg-success/10 text-success hover:bg-success/15'
              }`}
            >
              <Activity className="h-3 w-3" />
              <span>Jump to live</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const ReadoutTile: React.FC<{
  label: string;
  value: string;
  unit: string;
  warn?: boolean;
}> = ({ label, value, unit, warn }) => (
  <div className="rounded-lg border border-border bg-card/40 px-3 py-2">
    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="flex items-baseline gap-1 mt-0.5">
      <span className={`font-mono text-base font-semibold ${warn ? 'text-warning' : 'text-foreground'}`}>
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground">{unit}</span>
    </div>
  </div>
);

interface SparklineProps {
  label: string;
  data: { timestamp: number; hashrate: number; temp: number; intakePwm: number; exhaustPwm: number; powerW: number }[];
  accessor: (s: SparklineProps['data'][number]) => number;
  min: number;
  max: number;
  color: string;
  currentMs: number;
  windowStart: number;
  windowEnd: number;
}

const Sparkline: React.FC<SparklineProps> = ({ label, data, accessor, min, max, color, currentMs, windowStart, windowEnd }) => {
  if (data.length < 2) return null;
  const range = Math.max(0.0001, max - min);
  const path = data
    .map((s, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 30 - ((accessor(s) - min) / range) * 28;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  const fillPath = `${path} L 100 30 L 0 30 Z`;

  const currentRatio = (currentMs - windowStart) / (windowEnd - windowStart);
  const cursorX = Math.max(0, Math.min(100, currentRatio * 100));

  // Find the closest sample to the cursor for the marker dot.
  const idx = Math.min(data.length - 1, Math.max(0, Math.round(currentRatio * (data.length - 1))));
  const markerY = 30 - ((accessor(data[idx]) - min) / range) * 28;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-12">
        <defs>
          <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill={`url(#spark-${label})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.2" />
        {/* Cursor */}
        <line x1={cursorX} y1="0" x2={cursorX} y2="30" stroke="rgba(168, 85, 247, 0.7)" strokeWidth="0.8" strokeDasharray="2 2" />
        <circle cx={cursorX} cy={markerY} r="2" fill={color} stroke="rgb(168, 85, 247)" strokeWidth="0.8" />
      </svg>
    </div>
  );
};

export default ReplayPanel;

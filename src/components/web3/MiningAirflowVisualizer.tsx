import { useMemo } from 'react';
import { Fan, Thermometer, Wind, Gauge } from 'lucide-react';
import { useRigStore } from '../../store/useRigStore';
import { RIG_BY_ID } from '../../lib/mock/rigData';

/**
 * Mining-flavoured airflow visualizer. SVG cross-section of an ASIC rig
 * (top-down): intake fan on the left, three hashboards in the middle,
 * exhaust fan on the right. Each hashboard tile is heat-coloured by its
 * synthetic per-board temperature; both fans spin at PWM duty cycle pulled
 * from the live PL/SL telemetry.
 *
 * Replaces the legacy servo-driven AirFlowDiagram in the new web3 layout.
 */

const COOL_C = 45;   // cold side of the colour ramp
const HOT_C = 85;    // hot side of the colour ramp

// Maps °C to a CSS color along emerald → amber → rose. We use HSL so we
// can stay deterministic and avoid pulling a color library.
const tempToColor = (c: number): string => {
  const t = Math.max(0, Math.min(1, (c - COOL_C) / (HOT_C - COOL_C)));
  // Hue: 152 (emerald) → 38 (amber) → 348 (rose)
  const hue = t < 0.5
    ? 152 + (38 - 152) * (t / 0.5)
    : 38 + (348 - 38) * ((t - 0.5) / 0.5);
  return `hsl(${hue.toFixed(0)}, 75%, ${(48 + (1 - t) * 8).toFixed(0)}%)`;
};

const tempToBg = (c: number): string => {
  const color = tempToColor(c);
  return color.replace('hsl(', 'hsla(').replace(')', ', 0.18)');
};

export const MiningAirflowVisualizer: React.FC = () => {
  const deviceId = useRigStore((s) => s.deviceId);
  const currentData = useRigStore((s) => s.currentData);
  const profile = deviceId ? RIG_BY_ID.get(deviceId) : undefined;

  const data = useMemo(() => {
    if (!profile) return null;
    const intakePct = typeof currentData.PL === 'number' ? currentData.PL : 0;
    const exhaustPct = typeof currentData.SL === 'number' ? currentData.SL : 0;
    const intakeT = typeof currentData.T === 'number' ? currentData.T : 0;
    const exhaustT = intakeT + 12 + intakePct * 0.05;

    // Synthesise per-hashboard temps: middle board is always warmest,
    // outer boards lag by a few degrees. Adds a stable per-rig offset
    // so identical models don't show identical heat patterns.
    const seed = deviceId ? deviceId.length : 0;
    const boardOffsets = [seed % 3 - 1, seed % 5 - 2, (seed % 7) - 3];
    const boardTemps = [
      intakeT + 18 + boardOffsets[0],
      intakeT + 23 + boardOffsets[1],
      intakeT + 20 + boardOffsets[2],
    ];

    // Estimate CFM from fan PWM duty + nominal spec. Mock — close enough
    // for the visualization.
    const intakeCfm = (intakePct / 100) * 230;
    const exhaustCfm = (exhaustPct / 100) * 230;
    const deltaPa = Math.max(0, (intakeCfm - exhaustCfm) * 0.6 + 8);

    // Animation duration in seconds; faster duty = faster spin
    const intakeSpin = intakePct > 0 ? Math.max(0.4, 3.5 - intakePct / 30) : 0;
    const exhaustSpin = exhaustPct > 0 ? Math.max(0.4, 3.5 - exhaustPct / 30) : 0;

    return {
      intakePct, exhaustPct, intakeT, exhaustT,
      boardTemps, intakeCfm, exhaustCfm, deltaPa,
      intakeSpin, exhaustSpin,
    };
  }, [profile, currentData, deviceId]);

  if (!profile || !data) {
    return (
      <div className="rounded-2xl bg-card border border-border p-8 text-center text-sm text-muted-foreground">
        Connect a rig to view its cooling layout.
      </div>
    );
  }

  const maxBoardTemp = Math.max(...data.boardTemps);
  const overheat = maxBoardTemp >= 80;

  return (
    <div className="relative rounded-2xl bg-card border border-border p-5 overflow-hidden">
      {/* Subtle hot-zone halo if any hashboard is in the warning band */}
      {overheat && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 75% 50%, rgba(244, 63, 94, 0.14), transparent 60%)',
          }}
        />
      )}

      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
            <Wind className="h-3 w-3 text-info" />
            <span>Cooling Topology · Live</span>
          </div>
          <h3 className="text-base font-semibold tracking-tight text-foreground mt-0.5">
            Airflow & Hashboard Temps
          </h3>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Gauge className="h-3 w-3" />
          <span>ΔP <span className="font-mono text-foreground">{data.deltaPa.toFixed(1)} Pa</span></span>
        </div>
      </div>

      {/* SVG schematic */}
      <div className="relative z-10">
        <svg viewBox="0 0 400 180" className="w-full h-auto" aria-label="Rig cooling diagram">
          {/* Rig chassis outline */}
          <rect x="60" y="35" width="280" height="110" rx="8"
            fill="rgba(15, 19, 32, 0.45)" stroke="rgba(148, 163, 184, 0.18)" strokeWidth="1" />

          {/* Air stream — animated dashed lines flowing left → right */}
          {[55, 75, 95, 115].map((y, i) => (
            <line
              key={y}
              x1="10" y1={y} x2="390" y2={y}
              stroke="rgba(34, 211, 238, 0.35)"
              strokeWidth="1"
              strokeDasharray="4 8"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="0" to="-24"
                dur={`${1.2 + i * 0.18}s`}
                repeatCount="indefinite"
              />
            </line>
          ))}

          {/* Three hashboards */}
          {data.boardTemps.map((temp, idx) => {
            const x = 110 + idx * 70;
            return (
              <g key={idx}>
                <rect x={x} y="60" width="50" height="60" rx="3"
                  fill={tempToBg(temp)}
                  stroke={tempToColor(temp)}
                  strokeWidth="1.5" />
                {/* Chip grid pattern */}
                {[0, 1, 2, 3].map((row) =>
                  [0, 1, 2].map((col) => (
                    <rect
                      key={`${row}-${col}`}
                      x={x + 6 + col * 13}
                      y={62 + row * 13.5}
                      width="9"
                      height="9"
                      rx="1"
                      fill={tempToColor(temp)}
                      opacity={0.42 + row * 0.06}
                    />
                  )),
                )}
                {/* Board label */}
                <text x={x + 25} y="135"
                  textAnchor="middle"
                  fontSize="8"
                  fontFamily="var(--font-mono)"
                  fill="rgb(141, 149, 179)"
                >
                  HB{idx + 1}
                </text>
                <text x={x + 25} y="148"
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                  fill={tempToColor(temp)}
                >
                  {temp.toFixed(0)}°C
                </text>
              </g>
            );
          })}

          {/* Intake fan (left) — rotating */}
          <FanGlyph cx={40} cy={90} duration={data.intakeSpin} label="IN" intake />
          {/* Exhaust fan (right) */}
          <FanGlyph cx={360} cy={90} duration={data.exhaustSpin} label="OUT" />

          {/* Inlet temperature reading */}
          <text x="40" y="155" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="rgb(141, 149, 179)">
            {data.intakeT.toFixed(0)}°C in
          </text>
          {/* Outlet temperature */}
          <text x="360" y="155" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="rgb(141, 149, 179)">
            {data.exhaustT.toFixed(0)}°C out
          </text>
        </svg>
      </div>

      {/* Bottom stat grid */}
      <div className="relative z-10 mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
        <StatPair
          icon={Fan}
          label="Intake PWM"
          value={`${data.intakePct.toFixed(0)}%`}
          sub={`${data.intakeCfm.toFixed(0)} CFM`}
          tone={data.intakePct >= 95 ? 'warn' : 'ok'}
        />
        <StatPair
          icon={Fan}
          label="Exhaust PWM"
          value={`${data.exhaustPct.toFixed(0)}%`}
          sub={`${data.exhaustCfm.toFixed(0)} CFM`}
          tone={data.exhaustPct >= 95 ? 'warn' : 'ok'}
        />
        <StatPair
          icon={Thermometer}
          label="Hottest board"
          value={`HB${data.boardTemps.indexOf(maxBoardTemp) + 1}`}
          sub={`${maxBoardTemp.toFixed(1)}°C`}
          tone={overheat ? 'warn' : 'ok'}
        />
        <StatPair
          icon={Wind}
          label="ΔT in→out"
          value={`+${(data.exhaustT - data.intakeT).toFixed(0)}°C`}
          sub="Heat removed by airflow"
          tone="ok"
        />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FanGlyph — rotating fan SVG with N blades
// ─────────────────────────────────────────────────────────────────────────────

const FanGlyph: React.FC<{
  cx: number;
  cy: number;
  /** Rotation duration in seconds; 0 = stopped. */
  duration: number;
  label: string;
  intake?: boolean;
}> = ({ cx, cy, duration, label }) => {
  const r = 18;
  const blades = 5;
  const bladePath = (i: number) => {
    const angle = (i / blades) * 360;
    const a1 = (angle * Math.PI) / 180;
    const a2 = ((angle + 65) * Math.PI) / 180;
    return `M 0 0
            L ${(r * 0.95 * Math.cos(a1)).toFixed(1)} ${(r * 0.95 * Math.sin(a1)).toFixed(1)}
            Q ${(r * 0.55 * Math.cos((a1 + a2) / 2)).toFixed(1)} ${(r * 0.55 * Math.sin((a1 + a2) / 2)).toFixed(1)},
              ${(r * 0.95 * Math.cos(a2)).toFixed(1)} ${(r * 0.95 * Math.sin(a2)).toFixed(1)}
            Z`;
  };

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Bezel */}
      <circle r={r + 4} fill="rgba(15, 19, 32, 0.7)" stroke="rgba(148, 163, 184, 0.2)" strokeWidth="1" />
      {/* Spinning blades */}
      <g>
        {duration > 0 && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0"
            to="360"
            dur={`${duration}s`}
            repeatCount="indefinite"
          />
        )}
        {Array.from({ length: blades }).map((_, i) => (
          <path
            key={i}
            d={bladePath(i)}
            fill="rgba(168, 85, 247, 0.55)"
            stroke="rgba(168, 85, 247, 0.85)"
            strokeWidth="0.5"
          />
        ))}
        {/* Hub */}
        <circle r="3" fill="rgb(168, 85, 247)" />
      </g>
      {/* Label below */}
      <text y={r + 17} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="rgb(141, 149, 179)">
        {label}
      </text>
    </g>
  );
};

const StatPair: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: 'ok' | 'warn';
}> = ({ icon: Icon, label, value, sub, tone }) => (
  <div className="rounded-lg border border-border bg-card/40 px-2.5 py-2">
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="h-3 w-3" />
      <span className="text-[9px] uppercase tracking-wider">{label}</span>
    </div>
    <div className={`mt-0.5 font-mono text-sm ${tone === 'warn' ? 'text-warning' : 'text-foreground'}`}>
      {value}
    </div>
    <div className="text-[10px] text-muted-foreground">{sub}</div>
  </div>
);

export default MiningAirflowVisualizer;

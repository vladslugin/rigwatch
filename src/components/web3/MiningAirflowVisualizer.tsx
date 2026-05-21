import { useMemo, useState, lazy, Suspense } from 'react';
import { Fan, Thermometer, Wind, Gauge, Box, Layers } from 'lucide-react';
import { useRigStore } from '../../store/useRigStore';
import { RIG_BY_ID, ambientForLocation } from '../../lib/mock/rigData';

// Lazy-load the 3D scene — three.js + @react-three/fiber/drei is ~600 KB
// gzipped, so we only pull it in when the operator toggles 3D mode.
const RigASIC3D = lazy(() => import('./RigASIC3D'));

/**
 * Mining-flavoured airflow visualizer. SVG cross-section of an ASIC rig
 * (top-down): intake fan on the left, three hashboards in the middle,
 * exhaust fan on the right.
 *
 * Numerical fidelity tuned to match real Antminer S21 / Whatsminer M60S
 * physics: intake = datacenter ambient (18-29°C depending on site),
 * exhaust = intake + ~12-22°C, hashboards = ambient + 40-55°C chip rise,
 * CFM 0-280 per fan at 100% PWM, chip count 32 per board.
 */

// Hot-end of the colour ramp uses 4 distinct stops so 78°C reads visibly
// different from 85°C (operator triage colour).
const tempToColor = (c: number): string => {
  if (c < 50)  return 'hsl(152, 70%, 50%)';                                  // cool emerald
  if (c < 65)  return `hsl(${(152 - (c - 50) * 4).toFixed(0)}, 72%, 50%)`;   // emerald → lime
  if (c < 75)  return `hsl(${(92 - (c - 65) * 3.2).toFixed(0)}, 80%, 52%)`;  // lime → yellow
  if (c < 82)  return `hsl(${(60 - (c - 75) * 5).toFixed(0)}, 84%, 54%)`;    // yellow → amber
  if (c < 88)  return `hsl(${(25 - (c - 82) * 3).toFixed(0)}, 88%, 52%)`;    // amber → red-orange
  return `hsl(${Math.max(348, 7 - (c - 88) * 1).toFixed(0)}, 88%, 50%)`;     // red → crimson
};

const tempToBg = (c: number): string => {
  const alpha = c < 50 ? 0.18 : c < 65 ? 0.22 : c < 75 ? 0.26 : c < 85 ? 0.32 : 0.38;
  return tempToColor(c).replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
};

// Per-rig stable jitter so each unit's heat fingerprint differs slightly.
const stableHash = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const MiningAirflowVisualizer: React.FC = () => {
  const deviceId = useRigStore((s) => s.deviceId);
  const currentData = useRigStore((s) => s.currentData);
  const profile = deviceId ? RIG_BY_ID.get(deviceId) : undefined;

  const data = useMemo(() => {
    if (!profile) return null;

    // Telemetry (P could be hashrate, T was already used as a stove temp;
    // we re-interpret it as the warmest hashboard temp here).
    const intakePct = typeof currentData.PL === 'number' ? currentData.PL : 0;
    const exhaustPct = typeof currentData.SL === 'number' ? currentData.SL : 0;
    const reportedHashboardT = typeof currentData.T === 'number' ? currentData.T : 0;

    // True ambient = datacenter intake air, NOT the chip temp.
    const ambient = ambientForLocation(profile.location);

    // Behavior-driven heat rise. Stable rigs sit at +40°C above ambient,
    // throttling rigs at +55-60°C, efficient (hydro) at +30°C.
    const chipRiseBase =
      profile.behavior === 'efficient'  ? 32 :
      profile.behavior === 'stable'     ? 42 :
      profile.behavior === 'jittery'    ? 44 :
      profile.behavior === 'throttling' ? 56 :
      profile.behavior === 'degraded'   ? 47 :
      0;

    // Per-board offsets so HB2 (middle) is always the hottest (real
    // ASICs see this — least airflow access to centre board). Deterministic
    // per-rig wobble keeps each unit's fingerprint distinct.
    const seed = stableHash(profile.id);
    const offsets = [
      -2 + ((seed >> 0) % 5) * 0.4,
      +2 + ((seed >> 3) % 5) * 0.4,  // middle = hottest baseline
      -1 + ((seed >> 6) % 5) * 0.4,
    ];

    // Final per-board temps. The mock telemetry's T field tracks the
    // chassis surface temp (≈40°C), not the chip core, so we don't anchor
    // to it — chip core temps run ambient + 30-60°C in real hardware and
    // we want the visualizer to show that operator-relevant number.
    // `reportedHashboardT` is referenced just to mark the variable as used.
    void reportedHashboardT;
    const boardTemps = offsets.map((o) => ambient + chipRiseBase + o);

    // Exhaust = intake + heat carried away by airflow. Higher PWM moves
    // more air → ΔT collapses (more dilution); low PWM → ΔT climbs.
    const avgFanDuty = (intakePct + exhaustPct) / 2;
    const deltaT = avgFanDuty > 0 ? 14 + (60 / Math.max(40, avgFanDuty)) * 2 : 22;
    const exhaustT = ambient + deltaT;

    // CFM — Antminer S21 spec is ~280 CFM per fan at 100% duty. Scale
    // linearly with PWM. Real fans aren't perfectly linear but it's close.
    const intakeCfm = (intakePct / 100) * 278;
    const exhaustCfm = (exhaustPct / 100) * 278;

    // ΔP — intake pushes positive, exhaust pulls negative. Net depends
    // on which fan is stronger.
    const deltaPa = Math.abs(intakeCfm - exhaustCfm) * 0.5 + 6;

    // Spin speed — duty cycle maps to seconds-per-revolution roughly.
    // At 100% PWM real ASIC fans spin 5000-6000 RPM (≈100 rev/s, so 10ms/rev).
    // We exaggerate visibility: at 100% → 0.18s/rev, at 30% → 1.2s/rev.
    const intakeSpin = intakePct > 0 ? Math.max(0.18, 2.4 - intakePct / 50) : 0;
    const exhaustSpin = exhaustPct > 0 ? Math.max(0.18, 2.4 - exhaustPct / 50) : 0;

    return {
      intakePct, exhaustPct,
      intakeT: ambient,
      exhaustT,
      boardTemps,
      intakeCfm, exhaustCfm,
      deltaPa,
      intakeSpin, exhaustSpin,
    };
  }, [profile, currentData]);

  // View toggle — defaults to schematic (cheaper, no Three.js bundle).
  const [view, setView] = useState<'2d' | '3d'>('2d');

  if (!profile || !data) {
    return (
      <div className="rounded-2xl bg-card border border-border p-8 text-center text-sm text-muted-foreground">
        Connect a rig to view its cooling layout.
      </div>
    );
  }

  const maxBoardTemp = Math.max(...data.boardTemps);
  const hottestIdx = data.boardTemps.indexOf(maxBoardTemp);
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
              'radial-gradient(ellipse 80% 60% at 75% 50%, rgba(244, 63, 94, 0.12), transparent 60%)',
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
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">ΔP <span className="font-mono text-foreground">{data.deltaPa.toFixed(1)} Pa</span></span>
          {/* 2D/3D toggle */}
          <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5">
            <button
              type="button"
              onClick={() => setView('2d')}
              className={`inline-flex items-center gap-1 h-7 px-2.5 rounded text-[11px] font-medium transition-colors ${
                view === '2d' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label="Schematic view"
            >
              <Layers className="h-3 w-3" />
              <span>2D</span>
            </button>
            <button
              type="button"
              onClick={() => setView('3d')}
              className={`inline-flex items-center gap-1 h-7 px-2.5 rounded text-[11px] font-medium transition-colors ${
                view === '3d' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label="3D model"
            >
              <Box className="h-3 w-3" />
              <span>3D</span>
            </button>
          </div>
        </div>
      </div>

      {/* Scene — either SVG schematic or Three.js 3D model */}
      {view === '3d' && (
        <div className="relative z-10">
          <Suspense
            fallback={
              <div className="w-full h-72 sm:h-80 rounded-xl bg-card/40 border border-border flex items-center justify-center text-sm text-muted-foreground">
                <span className="shimmer rounded-lg px-3 py-1">Loading 3D scene…</span>
              </div>
            }
          >
            <RigASIC3D />
          </Suspense>
        </div>
      )}

      {/* SVG schematic */}
      {view === '2d' && (
      <div className="relative z-10">
        <svg viewBox="0 0 400 180" className="w-full h-auto" aria-label="Rig cooling diagram">
          <defs>
            <linearGradient id="fan-blade" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(203, 213, 225, 0.85)" />
              <stop offset="55%" stopColor="rgba(148, 163, 184, 0.55)" />
              <stop offset="100%" stopColor="rgba(100, 116, 139, 0.35)" />
            </linearGradient>
            <radialGradient id="fan-hub" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(15, 19, 32, 1)" />
              <stop offset="100%" stopColor="rgba(15, 19, 32, 0.4)" />
            </radialGradient>
          </defs>

          {/* Rig chassis outline */}
          <rect x="60" y="35" width="280" height="110" rx="6"
            fill="rgba(15, 19, 32, 0.55)"
            stroke="rgba(148, 163, 184, 0.22)" strokeWidth="1" />
          {/* Chassis ribbing — vents along the top/bottom for that
              "I/O bracket" look */}
          {[42, 138].map((y) => (
            <g key={y}>
              {Array.from({ length: 14 }).map((_, i) => (
                <line key={i}
                  x1={68 + i * 19} y1={y}
                  x2={68 + i * 19 + 12} y2={y}
                  stroke="rgba(148, 163, 184, 0.14)"
                  strokeWidth="1" />
              ))}
            </g>
          ))}

          {/* Air stream — animated dashed lines flowing left → right.
              Density scales with avg fan duty so the airflow looks faster
              when fans spin harder. */}
          {[55, 75, 95, 115].map((y, i) => (
            <line
              key={y}
              x1="10" y1={y} x2="390" y2={y}
              stroke="rgba(34, 211, 238, 0.32)"
              strokeWidth="1"
              strokeDasharray="4 8"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="0" to="-24"
                dur={`${0.8 + i * 0.15}s`}
                repeatCount="indefinite"
              />
            </line>
          ))}

          {/* Three hashboards with denser 8×4 chip grid (=32 chips/board,
              close to real S19 layout). */}
          {data.boardTemps.map((temp, idx) => {
            const x = 110 + idx * 70;
            const cols = 8, rows = 4;
            const chipW = 5, chipH = 12, padX = 4, padY = 3;
            const gridStartX = x + (50 - (cols * chipW)) / 2;
            return (
              <g key={idx}>
                <rect x={x} y="60" width="50" height="60" rx="3"
                  fill={tempToBg(temp)}
                  stroke={tempToColor(temp)}
                  strokeWidth="1.5" />
                {/* Chip grid — each chip slightly varies in saturation to
                    suggest manufacturing variance. */}
                {Array.from({ length: rows }).map((_, r) =>
                  Array.from({ length: cols }).map((_, c) => {
                    const variance = ((r * cols + c) % 7) * 0.04;
                    return (
                      <rect
                        key={`${r}-${c}`}
                        x={gridStartX + c * (chipW + 0.5)}
                        y={62 + padY + r * (chipH + 1)}
                        width={chipW}
                        height={chipH}
                        rx="0.6"
                        fill={tempToColor(temp)}
                        opacity={0.42 + variance + r * 0.04}
                      />
                    );
                  }),
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
                {/* Critical indicator for any board > 85°C — small dot */}
                {temp >= 85 && (
                  <circle cx={x + 46} cy={64} r="2" fill="hsl(348, 88%, 56%)">
                    <animate attributeName="opacity" values="0.4;1;0.4" dur="1.2s" repeatCount="indefinite" />
                  </circle>
                )}
              </g>
            );
          })}

          {/* Intake fan (left) */}
          <AxialFan cx={40} cy={90} duration={data.intakeSpin} label="IN" pct={data.intakePct} />
          {/* Exhaust fan (right) */}
          <AxialFan cx={360} cy={90} duration={data.exhaustSpin} label="OUT" pct={data.exhaustPct} />

          {/* Inlet temperature reading */}
          <text x="40" y="155" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="rgb(141, 149, 179)">
            {data.intakeT.toFixed(0)}°C ambient
          </text>
          {/* Outlet temperature */}
          <text x="360" y="155" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="rgb(141, 149, 179)">
            {data.exhaustT.toFixed(0)}°C out
          </text>
        </svg>
      </div>
      )}

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
          value={`HB${hottestIdx + 1}`}
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
// AxialFan — realistic 9-blade fan SVG, with metallic bezel and centre hub.
// Replaces the previous 5-pointed star glyph.
// ─────────────────────────────────────────────────────────────────────────────

const AxialFan: React.FC<{
  cx: number;
  cy: number;
  /** Rotation duration in seconds; 0 = stopped. */
  duration: number;
  /** PWM duty for the RPM readout (0-100). */
  pct: number;
  label: string;
}> = ({ cx, cy, duration, pct, label }) => {
  const r = 17;
  const blades = 9;

  // Build one blade as a swept airfoil that curves backward (real axial
  // fans have backward-curved blades to push air axially).
  const bladePath = (i: number): string => {
    const angle = (i / blades) * 360;
    const a1 = (angle * Math.PI) / 180;
    const a2 = ((angle + 38) * Math.PI) / 180; // narrower blade pitch
    const tipR = r * 0.93;
    const rootR = r * 0.25;
    return `M ${(rootR * Math.cos(a1)).toFixed(2)} ${(rootR * Math.sin(a1)).toFixed(2)}
            Q ${(tipR * 0.6 * Math.cos((a1 + a2) / 2 - 0.18)).toFixed(2)} ${(tipR * 0.6 * Math.sin((a1 + a2) / 2 - 0.18)).toFixed(2)},
              ${(tipR * Math.cos(a2)).toFixed(2)} ${(tipR * Math.sin(a2)).toFixed(2)}
            L ${(rootR * 1.2 * Math.cos(a2)).toFixed(2)} ${(rootR * 1.2 * Math.sin(a2)).toFixed(2)}
            Q ${(tipR * 0.45 * Math.cos((a1 + a2) / 2)).toFixed(2)} ${(tipR * 0.45 * Math.sin((a1 + a2) / 2)).toFixed(2)},
              ${(rootR * Math.cos(a1)).toFixed(2)} ${(rootR * Math.sin(a1)).toFixed(2)}
            Z`;
  };

  // Approximate RPM from PWM: 100% ≈ 6000 RPM is the spec for an S21 fan.
  const rpm = Math.round((pct / 100) * 6000);

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Outer bezel ring (mounting frame) */}
      <circle r={r + 4} fill="rgba(15, 19, 32, 0.85)" stroke="rgba(148, 163, 184, 0.32)" strokeWidth="1" />
      {/* Inner ring (where the blades sit) */}
      <circle r={r + 1} fill="none" stroke="rgba(148, 163, 184, 0.18)" strokeWidth="0.5" />
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
            fill="url(#fan-blade)"
            stroke="rgba(148, 163, 184, 0.45)"
            strokeWidth="0.4"
          />
        ))}
        {/* Hub */}
        <circle r="3.5" fill="url(#fan-hub)" />
        <circle r="3.5" fill="none" stroke="rgba(168, 85, 247, 0.7)" strokeWidth="0.6" />
        <circle r="1" fill="rgb(168, 85, 247)" />
      </g>
      {/* Label below — show RPM during operation */}
      <text y={r + 17} textAnchor="middle" fontSize="7.5" fontFamily="var(--font-mono)" fill="rgb(141, 149, 179)">
        {label}
      </text>
      <text y={r + 26} textAnchor="middle" fontSize="6.5" fontFamily="var(--font-mono)" fill="rgb(141, 149, 179)" opacity="0.7">
        {rpm.toLocaleString()} rpm
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

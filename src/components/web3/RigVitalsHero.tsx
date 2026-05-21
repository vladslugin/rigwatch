import { useMemo } from 'react';
import { useRigStore } from '../../store/useRigStore';
import { RIG_BY_ID } from '../../lib/mock/rigData';
import { Activity, Thermometer, Zap, Clock, Wifi } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Connected-state hero strip. Renders four big live metrics so the
 * dashboard "feels alive" the moment a rig comes online: hashrate, temp,
 * power, uptime. Reads telemetry from the same store the rest of the
 * dashboard subscribes to so it ticks at the same cadence.
 */

const formatHashrate = (value: number, algo: string): { num: string; unit: string } => {
  if (algo === 'SHA-256') return { num: value.toFixed(1), unit: 'TH/s' };
  if (algo === 'kHeavyHash') return { num: value.toFixed(2), unit: 'GH/s' };
  return { num: value.toFixed(0), unit: 'MH/s' };
};

const formatUptime = (ms: number): { num: string; unit: string } => {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days > 0) {
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return { num: String(days), unit: hours > 0 ? `d ${hours}h` : 'd' };
  }
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours > 0) {
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return { num: String(hours), unit: mins > 0 ? `h ${mins}m` : 'h' };
  }
  return { num: String(Math.floor(ms / (1000 * 60))), unit: 'm' };
};

export const RigVitalsHero: React.FC = () => {
  const deviceId = useRigStore((s) => s.deviceId);
  const currentData = useRigStore((s) => s.currentData);

  const profile = deviceId ? RIG_BY_ID.get(deviceId) : undefined;

  const vitals = useMemo(() => {
    if (!profile) return null;
    const hashrate = typeof currentData.P === 'number' ? currentData.P : 0;
    const temp = typeof currentData.T === 'number' ? currentData.T : 0;
    const powerW = typeof currentData.CO2 === 'number' ? currentData.CO2 : 0;
    const uptime = Date.now() - profile.startedAt;

    // Efficiency in J/TH (lower = better)
    const efficiency = hashrate > 0 ? powerW / hashrate : 0;
    const nominalEff = profile.nominalPowerW / profile.nominalHashrate;
    const effDelta = nominalEff > 0 ? ((efficiency - nominalEff) / nominalEff) * 100 : 0;

    const hashFmt = formatHashrate(hashrate, profile.algo);
    const upFmt = formatUptime(uptime);

    return {
      hashrate: hashFmt,
      nominalHash: formatHashrate(profile.nominalHashrate, profile.algo),
      temp,
      powerW,
      uptime: upFmt,
      efficiency: efficiency.toFixed(1),
      efficiencyDelta: effDelta,
      hashrateDelta: hashrate > 0 ? ((hashrate - profile.nominalHashrate) / profile.nominalHashrate) * 100 : 0,
    };
  }, [currentData, profile]);

  if (!profile || !vitals) return null;

  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mt-2">
      <VitalCard
        label="Hashrate"
        valueNode={(
          <>
            <span className="text-gradient">{vitals.hashrate.num}</span>
            <span className="text-base text-muted-foreground ml-1.5">{vitals.hashrate.unit}</span>
          </>
        )}
        icon={Activity}
        accent="violet"
        sub={`Nominal ${vitals.nominalHash.num} ${vitals.nominalHash.unit}`}
        delta={vitals.hashrateDelta}
        deltaInvert={false}
      />
      <VitalCard
        label="Temperature"
        valueNode={(
          <>
            <span className={vitals.temp >= 80 ? 'text-warning' : vitals.temp >= 70 ? 'text-foreground' : 'text-foreground'}>
              {vitals.temp.toFixed(1)}
            </span>
            <span className="text-base text-muted-foreground ml-1.5">°C</span>
          </>
        )}
        icon={Thermometer}
        accent={vitals.temp >= 80 ? 'rose' : 'cyan'}
        sub={vitals.temp >= 80 ? 'Above safe envelope' : vitals.temp >= 70 ? 'High, monitor closely' : 'Within nominal envelope'}
      />
      <VitalCard
        label="Power Draw"
        valueNode={(
          <>
            <span className="text-foreground">{(vitals.powerW / 1000).toFixed(2)}</span>
            <span className="text-base text-muted-foreground ml-1.5">kW</span>
          </>
        )}
        icon={Zap}
        accent="amber"
        sub={`Efficiency ${vitals.efficiency} J/TH`}
        delta={vitals.efficiencyDelta}
        deltaInvert
      />
      <VitalCard
        label="Uptime"
        valueNode={(
          <>
            <span className="text-foreground">{vitals.uptime.num}</span>
            <span className="text-base text-muted-foreground ml-1.5">{vitals.uptime.unit}</span>
          </>
        )}
        icon={Clock}
        accent="emerald"
        sub={(
          <>
            <Wifi className="inline h-3 w-3 mr-1 opacity-70" />
            <span>Online · {profile.location}</span>
          </>
        )}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// VitalCard — one of four big metric tiles
// ─────────────────────────────────────────────────────────────────────────────

interface VitalCardProps {
  label: string;
  valueNode: React.ReactNode;
  icon: LucideIcon;
  accent: 'violet' | 'cyan' | 'amber' | 'emerald' | 'rose';
  sub?: React.ReactNode;
  /** % delta vs nominal (positive = above nominal). Optional. */
  delta?: number;
  /** When true, a positive delta is bad (used for efficiency). */
  deltaInvert?: boolean;
}

const ACCENT_GRAD: Record<VitalCardProps['accent'], string> = {
  violet:  'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(168, 85, 247, 0.18), transparent 60%)',
  cyan:    'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(34, 211, 238, 0.16), transparent 60%)',
  amber:   'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(251, 191, 36, 0.16), transparent 60%)',
  emerald: 'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(16, 185, 129, 0.16), transparent 60%)',
  rose:    'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(244, 63, 94, 0.18), transparent 60%)',
};

const ACCENT_ICON_TONE: Record<VitalCardProps['accent'], string> = {
  violet:  'text-primary',
  cyan:    'text-info',
  amber:   'text-warning',
  emerald: 'text-success',
  rose:    'text-destructive',
};

const VitalCard: React.FC<VitalCardProps> = ({
  label,
  valueNode,
  icon: Icon,
  accent,
  sub,
  delta,
  deltaInvert = false,
}) => {
  const showDelta = typeof delta === 'number' && Number.isFinite(delta);
  const isPositive = (delta ?? 0) >= 0;
  const isGood = deltaInvert ? !isPositive : isPositive;

  return (
    <div className="relative rounded-2xl bg-card border border-border p-4 overflow-hidden">
      {/* Accent halo in the top-right */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-90"
        style={{ background: ACCENT_GRAD[accent] }}
      />

      <div className="relative z-10 flex items-start justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${ACCENT_ICON_TONE[accent]}`} />
      </div>

      <div className="relative z-10 mt-3 text-3xl font-semibold tracking-tight font-mono leading-none">
        {valueNode}
      </div>

      <div className="relative z-10 mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{sub}</span>
        {showDelta && (
          <span
            className={`shrink-0 font-mono font-medium ${
              isGood ? 'text-success' : 'text-destructive'
            }`}
            title={deltaInvert ? 'vs. model efficiency' : 'vs. nominal hashrate'}
          >
            {isPositive ? '+' : ''}
            {(delta ?? 0).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
};

export default RigVitalsHero;

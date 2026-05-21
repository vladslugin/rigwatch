import { useMemo, useState } from 'react';
import {
  Activity, RefreshCw, ArrowRightLeft, Thermometer, AlertTriangle,
  ZapOff, Sparkles, Gauge, WifiOff, Wifi, Boxes, Users,
  type LucideIcon,
} from 'lucide-react';
import { useRigStore } from '../../store/useRigStore';
import { eventsForRig, type EventType, type EventSeverity, type RigEvent } from '../../lib/mock/events';

/**
 * Mining-flavoured event log. Replaces the legacy HistoricalDataPanel
 * (which was a select-list of timestamp buckets) with a scrollable
 * timeline of real mining events: firmware rollouts, pool switches,
 * thermal alerts, share rejection spikes, hashboard drops, recoveries,
 * block finds.
 *
 * Filter chips at the top let the operator narrow to one severity class.
 */

const ICON_BY_TYPE: Record<EventType, LucideIcon> = {
  firmware_update:     Sparkles,
  restart:             RefreshCw,
  pool_switch:         ArrowRightLeft,
  thermal_alert:       Thermometer,
  share_reject_spike:  AlertTriangle,
  hashboard_drop:      ZapOff,
  hashboard_recover:   Activity,
  auto_tune:           Gauge,
  connection_loss:     WifiOff,
  connection_restored: Wifi,
  block_found:         Boxes,
  ownership_transfer:  Users,
};

const TONE_BY_SEVERITY: Record<EventSeverity, {
  text: string;
  bg: string;
  border: string;
  iconBg: string;
}> = {
  info:    { text: 'text-info',         bg: 'bg-info/5',         border: 'border-info/20',         iconBg: 'bg-info/15' },
  success: { text: 'text-success',      bg: 'bg-success/5',      border: 'border-success/20',      iconBg: 'bg-success/15' },
  warn:    { text: 'text-warning',      bg: 'bg-warning/5',      border: 'border-warning/20',      iconBg: 'bg-warning/15' },
  error:   { text: 'text-destructive',  bg: 'bg-destructive/5',  border: 'border-destructive/25',  iconBg: 'bg-destructive/15' },
};

const formatRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

type Filter = 'all' | 'warn' | 'error' | 'success';

export const RigEventLog: React.FC = () => {
  const deviceId = useRigStore((s) => s.deviceId);
  const [filter, setFilter] = useState<Filter>('all');

  const events = useMemo(() => (deviceId ? eventsForRig(deviceId) : []), [deviceId]);

  const counts = useMemo(() => {
    const c = { all: events.length, warn: 0, error: 0, success: 0 };
    for (const e of events) {
      if (e.severity === 'warn') c.warn++;
      else if (e.severity === 'error') c.error++;
      else if (e.severity === 'success') c.success++;
    }
    return c;
  }, [events]);

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((e) => e.severity === filter);
  }, [events, filter]);

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <FilterChip active={filter === 'all'}      onClick={() => setFilter('all')}     label="All"      count={counts.all} />
        <FilterChip active={filter === 'warn'}     onClick={() => setFilter('warn')}    label="Warning"  count={counts.warn}    tone="warn" />
        <FilterChip active={filter === 'error'}    onClick={() => setFilter('error')}   label="Errors"   count={counts.error}   tone="error" />
        <FilterChip active={filter === 'success'}  onClick={() => setFilter('success')} label="Resolved" count={counts.success} tone="success" />
      </div>

      {/* Event list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
          No events of this type.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {filtered.slice(0, 50).map((evt) => (
            <EventRow key={evt.id} evt={evt} />
          ))}
        </div>
      )}
    </div>
  );
};

const FilterChip: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: 'warn' | 'error' | 'success';
}> = ({ active, onClick, label, count, tone }) => {
  const toneClass = active
    ? tone === 'warn'    ? 'bg-warning/15 text-warning border-warning/30'
    : tone === 'error'   ? 'bg-destructive/15 text-destructive border-destructive/30'
    : tone === 'success' ? 'bg-success/15 text-success border-success/30'
    :                      'bg-primary/15 text-primary border-primary/30'
    : 'bg-card/40 text-muted-foreground border-border hover:bg-card hover:text-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${toneClass}`}
    >
      <span>{label}</span>
      <span className="font-mono opacity-70">{count}</span>
    </button>
  );
};

const EventRow: React.FC<{ evt: RigEvent }> = ({ evt }) => {
  const Icon = ICON_BY_TYPE[evt.type];
  const tone = TONE_BY_SEVERITY[evt.severity];

  return (
    <div className={`group flex items-start gap-3 rounded-lg border ${tone.border} ${tone.bg} px-3 py-2.5 hover:bg-card/80 transition-colors`}>
      <div className={`shrink-0 mt-0.5 h-7 w-7 rounded-md inline-flex items-center justify-center ${tone.iconBg}`}>
        <Icon className={`h-3.5 w-3.5 ${tone.text}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">{evt.title}</span>
          <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
            {formatRelative(evt.timestamp)}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
          {evt.details}
        </p>
      </div>
    </div>
  );
};

export default RigEventLog;

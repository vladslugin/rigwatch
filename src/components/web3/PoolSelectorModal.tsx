import { useEffect, useState } from 'react';
import { ref, get, update } from 'firebase/database';
import { X, Check, ArrowUpRight, Globe, Zap, Shield } from 'lucide-react';
import { realtimeDB } from '../../lib/firebase';

/**
 * Pool selector — modal listing the major SHA-256 / Scrypt / KAS pools
 * with fee, region, daily-est, and ping figures. Picking a pool writes
 * the new config back to `konstant/{rigId}/pool` in the mock RTDB.
 *
 * "Daily" numbers are deliberately rough — they communicate *relative*
 * profitability between pools rather than exact payouts. Real apps
 * would query each pool's API.
 */

interface PoolInfo {
  name: string;
  region: string;
  fee: number;            // percent
  payoutScheme: 'PPS' | 'PPLNS' | 'FPPS' | 'PPS+';
  dailyEstUsd: number;    // for a 234 TH/s rig
  pingMs: number;
  url: string;
  worker: string;
  tags: ('low-fee' | 'reliable' | 'beta')[];
}

const SHA_POOLS: PoolInfo[] = [
  { name: 'Foundry USA',  region: 'US-East',  fee: 0.0,  payoutScheme: 'FPPS',   dailyEstUsd: 10.54, pingMs: 18,  url: 'stratum+tcp://btc.foundryusapool.com:3333', worker: 'rigwatch_1', tags: ['low-fee', 'reliable'] },
  { name: 'AntPool',      region: 'CN',       fee: 1.5,  payoutScheme: 'PPS+',   dailyEstUsd: 10.42, pingMs: 92,  url: 'stratum+tcp://stratum.antpool.com:443',     worker: 'rigwatch_1', tags: ['reliable'] },
  { name: 'F2Pool',       region: 'CN',       fee: 2.5,  payoutScheme: 'PPS',    dailyEstUsd: 10.31, pingMs: 88,  url: 'stratum+tcp://btc.f2pool.com:1314',         worker: 'rigwatch_1', tags: ['reliable'] },
  { name: 'ViaBTC',       region: 'CN',       fee: 2.0,  payoutScheme: 'PPLNS',  dailyEstUsd: 10.36, pingMs: 81,  url: 'stratum+tcp://btc.viabtc.com:3333',         worker: 'rigwatch_1', tags: [] },
  { name: 'Luxor',        region: 'US-West',  fee: 0.7,  payoutScheme: 'FPPS',   dailyEstUsd: 10.49, pingMs: 24,  url: 'stratum+tcp://btc.global.luxor.tech:700',   worker: 'rigwatch_1', tags: ['low-fee'] },
  { name: 'OCEAN',        region: 'EU',       fee: 0.0,  payoutScheme: 'PPLNS',  dailyEstUsd: 10.21, pingMs: 38,  url: 'stratum+tcp://mining.ocean.xyz:3334',       worker: 'rigwatch_1', tags: ['low-fee', 'beta'] },
];

interface Props {
  open: boolean;
  onClose: () => void;
  rigId: string | null;
}

const TAG_LABEL: Record<PoolInfo['tags'][number], { text: string; tone: 'online' | 'info' | 'warn' }> = {
  'low-fee':  { text: 'Low fee',  tone: 'online' },
  reliable:   { text: 'Reliable', tone: 'info' },
  beta:       { text: 'Beta',     tone: 'warn' },
};

export const PoolSelectorModal: React.FC<Props> = ({ open, onClose, rigId }) => {
  const [currentPoolName, setCurrentPoolName] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !rigId || !realtimeDB) return;
    const refConfig = ref(realtimeDB, `konstant/${rigId}/pool`);
    void get(refConfig).then((snap) => {
      const v = snap.val();
      setCurrentPoolName(v?.name ?? null);
    });
  }, [open, rigId]);

  const handleSwitch = async (pool: PoolInfo) => {
    if (!rigId || !realtimeDB) return;
    setSwitching(pool.name);
    try {
      // Simulated network round-trip — gives the spinner a beat to show.
      await new Promise((r) => setTimeout(r, 600));
      const refConfig = ref(realtimeDB, `konstant/${rigId}`);
      await update(refConfig, {
        pool: { name: pool.name, url: pool.url, worker: pool.worker },
      });
      setCurrentPoolName(pool.name);
    } finally {
      setSwitching(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center p-4 backdrop-blur-md"
      style={{ background: 'rgba(7, 8, 13, 0.55)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Select pool"
        className="glass gradient-border relative w-full max-w-2xl rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Mining · Pool
            </div>
            <h2 className="text-lg font-semibold tracking-tight mt-0.5">
              Switch <span className="text-gradient">pool</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
          {SHA_POOLS.map((pool) => {
            const isCurrent = currentPoolName === pool.name;
            const isSwitching = switching === pool.name;
            return (
              <div
                key={pool.name}
                className={`group rounded-xl border ${
                  isCurrent ? 'border-primary/50 bg-primary/[0.04]' : 'border-border bg-card/50 hover:border-border/80 hover:bg-card'
                } px-4 py-3 transition-colors`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{pool.name}</span>
                      {isCurrent && (
                        <span className="pill pill-info" style={{ padding: '2px 8px', fontSize: 9 }}>
                          <Check className="h-2.5 w-2.5" />
                          ACTIVE
                        </span>
                      )}
                      {pool.tags.map((t) => {
                        const meta = TAG_LABEL[t];
                        return (
                          <span key={t} className={`pill pill-${meta.tone}`} style={{ padding: '2px 7px', fontSize: 9 }}>
                            {meta.text}
                          </span>
                        );
                      })}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
                      <StatPair icon={Globe} label="Region" value={pool.region} />
                      <StatPair icon={Shield} label="Fee" value={`${pool.fee.toFixed(1)}%`} />
                      <StatPair icon={Zap} label="Ping" value={`${pool.pingMs} ms`} tone={pool.pingMs > 60 ? 'warn' : 'normal'} />
                      <StatPair label="Daily est." value={`$${pool.dailyEstUsd.toFixed(2)}`} mono />
                    </div>
                    <div className="mt-1.5 text-[10px] text-muted-foreground font-mono truncate">
                      {pool.url} · {pool.payoutScheme}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isCurrent || isSwitching}
                    onClick={() => handleSwitch(pool)}
                    className={`shrink-0 h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-all ${
                      isCurrent
                        ? 'bg-primary/15 text-primary cursor-default'
                        : isSwitching
                        ? 'bg-primary/30 text-primary'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    } disabled:opacity-60`}
                  >
                    {isCurrent ? 'In use' : isSwitching ? 'Switching…' : (
                      <>
                        Switch
                        <ArrowUpRight className="h-3 w-3" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border bg-card/40 text-[11px] text-muted-foreground">
          Pool switches take ~3 minutes to fully reflect on hashrate. Existing
          shares finish on the previous pool.
        </div>
      </div>
    </div>
  );
};

const StatPair: React.FC<{
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'warn' | 'normal';
}> = ({ icon: Icon, label, value, mono, tone }) => (
  <div className="flex items-center gap-1.5 text-muted-foreground">
    {Icon && <Icon className="h-3 w-3 opacity-70" />}
    <span className="text-[10px] uppercase tracking-wider">{label}</span>
    <span className={`text-[11px] text-foreground/90 ${mono ? 'font-mono' : ''} ${tone === 'warn' ? 'text-warning' : ''}`}>
      {value}
    </span>
  </div>
);

export default PoolSelectorModal;

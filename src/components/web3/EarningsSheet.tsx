import { useMemo, useState } from 'react';
import {
  X, Copy, Check, TrendingUp, Wallet, Filter, ArrowUpRight,
} from 'lucide-react';
import { RIGS } from '../../lib/mock/rigData';
import {
  allEarnings,
  dailyBuckets,
  aggregateUsd,
  aggregateBtc,
  currentBtcUsd,
  earningsForRigs,
  type PayoutTx,
} from '../../lib/mock/earnings';
import { useWalletStore, shortAddress } from '../../store/useWalletStore';

/**
 * Earnings sheet — full-screen modal showing payout history across the
 * fleet (or filtered to the connected wallet's rigs). Big number summary
 * at the top, a sparkline of the last 14 days, and a paginated tx list
 * underneath with hash-copy buttons.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const formatBtc = (n: number): string => n.toFixed(n < 0.001 ? 6 : 4);
const formatUsd = (n: number): string =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 10000 ? 1 : 2)}k`
    : `$${n.toFixed(2)}`;

const formatRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / (60 * 60 * 1000));
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

const shortHash = (h: string): string => `${h.slice(0, 8)}…${h.slice(-6)}`;

export const EarningsSheet: React.FC<Props> = ({ open, onClose }) => {
  const account = useWalletStore((s) => s.account);
  const [scope, setScope] = useState<'fleet' | 'owned'>('fleet');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // When a wallet is connected we have a synthetic "owned rigs" filter
  // — mock: pretend the connected wallet owns 4 rigs (first wallet group).
  const ownedRigIds = useMemo(
    () => (account ? RIGS.filter((r) => r.ownerWallet.endsWith(account.address.slice(-4))).map((r) => r.id) : []),
    [account],
  );
  const effectiveScope = !account ? 'fleet' : scope;
  const rigIds = effectiveScope === 'owned' && ownedRigIds.length > 0
    ? ownedRigIds
    : RIGS.map((r) => r.id);

  const all = useMemo<PayoutTx[]>(
    () => (effectiveScope === 'owned' ? earningsForRigs(rigIds) : allEarnings()),
    [effectiveScope, rigIds],
  );
  const buckets = useMemo(() => dailyBuckets(rigIds), [rigIds]);

  const totalUsd = useMemo(() => aggregateUsd(rigIds), [rigIds]);
  const totalBtc = useMemo(() => aggregateBtc(rigIds), [rigIds]);
  const last24Usd = useMemo(() => aggregateUsd(rigIds, Date.now() - DAY_MS), [rigIds]);
  const last7Usd = useMemo(() => aggregateUsd(rigIds, Date.now() - 7 * DAY_MS), [rigIds]);
  const pending = useMemo(() => all.filter((t) => t.status === 'pending'), [all]);

  const handleCopy = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash((cur) => (cur === hash ? null : cur)), 1400);
    } catch {}
  };

  if (!open) return null;

  // Compute sparkline path — last 14 days of USD.
  const sparkData = buckets.slice(-14).map((b) => b.usd);
  const sparkMax = Math.max(...sparkData, 0.0001);
  const sparkPath = sparkData
    .map((v, i) => {
      const x = (i / (sparkData.length - 1 || 1)) * 100;
      const y = 30 - (v / sparkMax) * 28;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div
      className="fixed inset-0 z-[180] flex items-stretch justify-end backdrop-blur-md"
      style={{ background: 'rgba(7, 8, 13, 0.55)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Earnings"
        className="glass relative w-full max-w-3xl h-full overflow-y-auto"
        style={{ borderLeft: '1px solid rgba(168, 85, 247, 0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-card/80 backdrop-blur-xl">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Mining Operations · Payouts
            </div>
            <h2 className="text-xl font-semibold tracking-tight mt-0.5">
              <span className="text-gradient">Earnings</span>
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

        <div className="p-6 space-y-6">
          {/* Scope filter */}
          {account && ownedRigIds.length > 0 && (
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="inline-flex rounded-lg border border-border bg-card/60 p-0.5">
                <button
                  type="button"
                  onClick={() => setScope('fleet')}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    effectiveScope === 'fleet' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Whole fleet
                </button>
                <button
                  type="button"
                  onClick={() => setScope('owned')}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    effectiveScope === 'owned' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  My rigs ({ownedRigIds.length})
                </button>
              </div>
              <span className="ml-auto text-[11px] text-muted-foreground">
                <Wallet className="inline h-3 w-3 mr-1" />
                {shortAddress(account.address)}
              </span>
            </div>
          )}

          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryTile
              label="Total mined"
              value={formatUsd(totalUsd)}
              sub={`${formatBtc(totalBtc)} BTC`}
              accent="violet"
            />
            <SummaryTile
              label="Last 24h"
              value={formatUsd(last24Usd)}
              sub={`${((last24Usd / Math.max(totalUsd, 1)) * 100).toFixed(1)}% of total`}
              accent="cyan"
            />
            <SummaryTile
              label="Last 7d"
              value={formatUsd(last7Usd)}
              sub={`avg ${formatUsd(last7Usd / 7)}/day`}
              accent="emerald"
            />
            <SummaryTile
              label="Pending"
              value={String(pending.length)}
              sub={pending.length > 0 ? 'awaiting confirmation' : 'all settled'}
              accent="amber"
            />
          </div>

          {/* Sparkline */}
          <div className="rounded-2xl bg-card border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  USD payouts · last 14 days
                </div>
                <div className="text-sm text-foreground/80 mt-0.5">
                  Peak <span className="font-mono">{formatUsd(sparkMax)}</span> on best day
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 text-[11px] text-success font-medium">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>BTC at {formatUsd(currentBtcUsd())}</span>
              </div>
            </div>
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-20">
              <defs>
                <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(168, 85, 247)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="rgb(168, 85, 247)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d={`${sparkPath} L 100 30 L 0 30 Z`}
                fill="url(#spark-fill)"
              />
              <path d={sparkPath} fill="none" stroke="rgb(168, 85, 247)" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Transaction list */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-sm font-semibold text-foreground">Recent payouts</h3>
              <span className="text-[11px] text-muted-foreground">{all.length} total</span>
            </div>
            <div className="space-y-1.5">
              {all.slice(0, 24).map((tx) => (
                <PayoutRow
                  key={tx.hash}
                  tx={tx}
                  copied={copiedHash === tx.hash}
                  onCopy={() => handleCopy(tx.hash)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SummaryTile + PayoutRow
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT_TONE: Record<string, string> = {
  violet:  'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(168, 85, 247, 0.18), transparent 60%)',
  cyan:    'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(34, 211, 238, 0.16), transparent 60%)',
  emerald: 'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(16, 185, 129, 0.16), transparent 60%)',
  amber:   'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(251, 191, 36, 0.16), transparent 60%)',
};

const SummaryTile: React.FC<{
  label: string;
  value: string;
  sub: string;
  accent: keyof typeof ACCENT_TONE;
}> = ({ label, value, sub, accent }) => (
  <div className="relative rounded-2xl bg-card border border-border p-4 overflow-hidden">
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-2xl"
      style={{ background: ACCENT_TONE[accent] }}
    />
    <div className="relative z-10 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {label}
    </div>
    <div className="relative z-10 mt-2 text-2xl font-semibold tracking-tight font-mono">
      {value}
    </div>
    <div className="relative z-10 mt-1 text-[11px] text-muted-foreground">{sub}</div>
  </div>
);

const PayoutRow: React.FC<{
  tx: PayoutTx;
  copied: boolean;
  onCopy: () => void;
}> = ({ tx, copied, onCopy }) => (
  <div className="group flex items-center gap-3 rounded-xl bg-card/50 border border-border/60 hover:border-border hover:bg-card transition-colors px-3.5 py-2.5">
    <span
      className={`pill ${tx.status === 'pending' ? 'pill-warn' : 'pill-online'}`}
      style={{ padding: '2px 8px', fontSize: 9, textTransform: 'uppercase' }}
    >
      {tx.status}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-foreground truncate">{tx.rigName}</span>
        <span className="text-[10px] text-muted-foreground">·</span>
        <span className="text-[11px] text-muted-foreground">{tx.poolName}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
        <span className="font-mono">{shortHash(tx.hash)}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Copy hash"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
        <span className="opacity-50">·</span>
        <span>{formatRelative(tx.timestamp)}</span>
        {tx.status === 'pending' && (
          <span className="text-warning">{tx.confirmations}/6 conf.</span>
        )}
      </div>
    </div>
    <div className="text-right shrink-0">
      <div className="text-sm font-mono font-medium text-foreground">{formatUsd(tx.usd)}</div>
      <div className="text-[10px] font-mono text-muted-foreground">{formatBtc(tx.btc)} BTC</div>
    </div>
    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-70 transition-opacity" />
  </div>
);

export default EarningsSheet;

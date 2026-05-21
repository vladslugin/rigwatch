import { useMemo, useState } from 'react';
import { Bitcoin, TrendingUp, TrendingDown, RefreshCw, Layers } from 'lucide-react';
import { useRigStore } from '../../store/useRigStore';
import { RIG_BY_ID } from '../../lib/mock/rigData';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import PoolSelectorModal from './PoolSelectorModal';

/**
 * Live profitability card. Combines:
 *   - Real BTC/USD price from CoinGecko (refreshed every 60s)
 *   - Current effective hashrate from the connected rig
 *   - Rough $/day per TH (calibrated for current difficulty)
 *
 * Renders three numbers — daily / monthly revenue, plus a power-cost
 * sub-line. Numbers update on every store tick AND on every BTC price
 * refresh, so the strip "breathes" with the market.
 */

// Per-algo $/day per nominal unit at the current network difficulty +
// $97k BTC. We then rescale by `liveBtc / 97000` so the value tracks the
// market in real time.
const REF_BTC_USD = 97_400;
const DAILY_USD_PER_TH_SHA = 0.045;
const DAILY_USD_PER_GH_KAS = 8.0;
const DAILY_USD_PER_MH_SCRYPT = 0.0012;

// Approximate datacenter power cost; tunable per profile in real apps.
const POWER_COST_USD_PER_KWH = 0.06;

const formatUsd = (n: number): string =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 10000 ? 1 : 2)}k`
    : `$${n.toFixed(2)}`;

export const ProfitabilityCard: React.FC = () => {
  const deviceId = useRigStore((s) => s.deviceId);
  const currentData = useRigStore((s) => s.currentData);
  const btc = useBtcPrice();
  const profile = deviceId ? RIG_BY_ID.get(deviceId) : undefined;
  const [poolModalOpen, setPoolModalOpen] = useState(false);

  const calc = useMemo(() => {
    if (!profile) return null;
    const hashrate = typeof currentData.P === 'number' ? currentData.P : 0;
    const powerW = typeof currentData.CO2 === 'number' ? currentData.CO2 : 0;

    let revenuePerDay = 0;
    switch (profile.algo) {
      case 'SHA-256':    revenuePerDay = hashrate * DAILY_USD_PER_TH_SHA; break;
      case 'kHeavyHash': revenuePerDay = hashrate * DAILY_USD_PER_GH_KAS; break;
      case 'Scrypt':     revenuePerDay = hashrate * DAILY_USD_PER_MH_SCRYPT; break;
    }
    // Rescale by current BTC vs the reference price the constants were
    // calibrated against. Holds the model honest as BTC moves.
    revenuePerDay *= btc.usd / REF_BTC_USD;

    const powerCostPerDay = (powerW / 1000) * 24 * POWER_COST_USD_PER_KWH;
    const netPerDay = revenuePerDay - powerCostPerDay;
    const netPerMonth = netPerDay * 30;
    const profitMargin = revenuePerDay > 0 ? netPerDay / revenuePerDay : 0;

    return {
      revenuePerDay,
      powerCostPerDay,
      netPerDay,
      netPerMonth,
      profitMargin,
    };
  }, [profile, currentData, btc.usd]);

  if (!profile || !calc) return null;

  const change24h = btc.change24h;
  const ChangeIcon = change24h >= 0 ? TrendingUp : TrendingDown;
  const isProfit = calc.netPerDay > 0;

  return (
    <div className="relative rounded-2xl bg-card border border-border p-5 overflow-hidden">
      {/* Subtle radial halo in the top-right corner */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 100% 0%, rgba(251, 191, 36, 0.18), transparent 60%)',
        }}
      />

      {/* Header row */}
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
            <Bitcoin className="h-3 w-3 text-warning" />
            <span>Profitability</span>
            {btc.stale && (
              <span className="ml-1 text-warning" title="Using cached price — network fetch failed">
                · offline
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-base font-mono text-foreground">{formatUsd(btc.usd)}</span>
            <span
              className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
                change24h >= 0 ? 'text-success' : 'text-destructive'
              }`}
            >
              <ChangeIcon className="h-3 w-3" />
              {change24h >= 0 ? '+' : ''}
              {change24h.toFixed(2)}%
            </span>
            <span className="text-[10px] text-muted-foreground">24h · BTC</span>
          </div>
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Three big numbers in a row */}
      <div className="relative z-10 mt-4 grid grid-cols-3 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Revenue / day</div>
          <div className="text-xl font-semibold tracking-tight font-mono mt-1 text-gradient-warm">
            {formatUsd(calc.revenuePerDay)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Net / day</div>
          <div className={`text-xl font-semibold tracking-tight font-mono mt-1 ${isProfit ? 'text-success' : 'text-destructive'}`}>
            {formatUsd(calc.netPerDay)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Margin</div>
          <div className="text-xl font-semibold tracking-tight font-mono mt-1 text-foreground">
            {(calc.profitMargin * 100).toFixed(1)}<span className="text-base text-muted-foreground">%</span>
          </div>
        </div>
      </div>

      {/* Footer line — power cost + monthly projection + pool switcher */}
      <div className="relative z-10 mt-4 pt-3 border-t border-border flex items-center justify-between gap-3 text-[11px] text-muted-foreground flex-wrap">
        <span>
          Power · <span className="font-mono">{formatUsd(calc.powerCostPerDay)}/day</span> at ${POWER_COST_USD_PER_KWH.toFixed(2)}/kWh
        </span>
        <span>
          Monthly · <span className={`font-mono ${isProfit ? 'text-success' : 'text-destructive'}`}>{formatUsd(calc.netPerMonth)}</span>
        </span>
        <button
          type="button"
          onClick={() => setPoolModalOpen(true)}
          className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors font-medium"
        >
          <Layers className="h-3 w-3" />
          Switch pool →
        </button>
      </div>

      <PoolSelectorModal
        open={poolModalOpen}
        onClose={() => setPoolModalOpen(false)}
        rigId={deviceId ?? null}
      />
    </div>
  );
};

export default ProfitabilityCard;

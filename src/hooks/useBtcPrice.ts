import { useEffect, useState } from 'react';

/**
 * Live BTC price hook. Polls CoinGecko's free endpoint every 60s and keeps
 * the latest USD quote in component state. Falls back to a frozen value if
 * the network call fails (offline demo, rate limit, etc.).
 *
 * One singleton fetch loop is shared across all subscribers via a module-
 * level cache + listener set — so a page with five widgets that need BTC
 * price only makes one network request per minute.
 */

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true';
const POLL_MS = 60_000;
const FALLBACK_USD = 97_400;

export interface BtcQuote {
  usd: number;
  change24h: number;
  /** Unix ms when this quote was fetched. */
  fetchedAt: number;
  /** True if the quote came from the fallback constant (network failed). */
  stale: boolean;
}

let cached: BtcQuote = {
  usd: FALLBACK_USD,
  change24h: 0,
  fetchedAt: 0,
  stale: true,
};

const listeners = new Set<(q: BtcQuote) => void>();
let loopHandle: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

const notify = (): void => {
  for (const l of listeners) {
    try {
      l(cached);
    } catch {}
  }
};

const fetchOnce = async (): Promise<void> => {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const resp = await fetch(COINGECKO_URL);
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      const data = await resp.json();
      const usd = Number(data?.bitcoin?.usd);
      const change24h = Number(data?.bitcoin?.usd_24h_change);
      if (Number.isFinite(usd) && usd > 0) {
        cached = {
          usd,
          change24h: Number.isFinite(change24h) ? change24h : 0,
          fetchedAt: Date.now(),
          stale: false,
        };
        notify();
      }
    } catch (err) {
      // Keep the existing cached quote but mark fetchedAt so consumers know
      // a refresh was attempted. The `stale` flag stays true until the first
      // successful fetch.
      cached = { ...cached, fetchedAt: Date.now() };
      notify();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

const startLoop = (): void => {
  if (loopHandle) return;
  void fetchOnce();
  loopHandle = setInterval(() => {
    void fetchOnce();
  }, POLL_MS);
};

const stopLoopIfIdle = (): void => {
  if (listeners.size === 0 && loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
};

export const useBtcPrice = (): BtcQuote => {
  const [quote, setQuote] = useState<BtcQuote>(cached);

  useEffect(() => {
    listeners.add(setQuote);
    // If the cached quote is older than 30s, refresh on mount. Cheap.
    if (Date.now() - cached.fetchedAt > 30_000) startLoop();
    else startLoop();
    setQuote(cached);
    return () => {
      listeners.delete(setQuote);
      stopLoopIfIdle();
    };
  }, []);

  return quote;
};

/** Synchronous access for non-React modules (e.g. the earnings mock). */
export const peekBtcPrice = (): BtcQuote => cached;

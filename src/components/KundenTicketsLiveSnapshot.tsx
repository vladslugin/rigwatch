import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ref, get } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import { usePingTest } from '../hooks/usePingTest';
import { decodeRigErrors, type DecodedRigError } from '../utils/decodeRigErrors';
import {
  BRENNBEWERTUNG_KEYS,
  type BrennbewertungKey,
  type BrennbewertungValues,
} from '../types/brennbewertung';
import { starsForCValue } from '../utils/brennbewertungKnowledge';

/**
 * Compact "is the problem still happening?" panel for the staff inbox.
 *
 * On mount we fetch three things in parallel:
 *   - tsfc (last heartbeat from `konstant_app/<id>/tsfc`) — passive online check.
 *   - C0–C6 from `statistik_monat_tage/<id>/c` — current burn-quality.
 *   - ecode/ecode2 from `konstant_app/<id>` — decoded controller errors.
 *
 * That single read is enough to decide whether the original complaint may have
 * resolved itself. If the admin needs a strict yes/no answer they can hit the
 * "Aktiv prüfen" button which runs the active ping test.
 */

const PASSIVE_ONLINE_THRESHOLD_MS = 90 * 1000; // 90 s heartbeat freshness

type Liveness = 'unknown' | 'online' | 'offline' | 'never_seen';

interface SnapshotData {
  liveness: Liveness;
  /** Last seen UNIX timestamp (seconds) — null when never connected. */
  lastSeenSec: number | null;
  cValues: BrennbewertungValues;
  errors: DecodedRigError[];
}

const ZERO_C: BrennbewertungValues = {
  C0: 0, C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0,
};

const formatRelativeSeconds = (sec: number, t: (k: string, o?: any) => string): string => {
  const diffMs = Date.now() - sec * 1000;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return t('kundenTickets.justNow') as string;
  if (minutes < 60) return t('kundenTickets.minutesAgo', { count: minutes }) as string;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('kundenTickets.hoursAgo', { count: hours }) as string;
  const days = Math.floor(hours / 24);
  return t('kundenTickets.daysAgo', { count: days }) as string;
};

export interface KundenTicketsLiveSnapshotProps {
  deviceId: string;
  /** Called when the admin clicks the "all clear → mark as resolved" shortcut. */
  onMarkResolved?: () => void;
  /** Whether the parent ticket is already resolved — hides the resolve shortcut. */
  isAlreadyResolved?: boolean;
}

export const KundenTicketsLiveSnapshot: React.FC<KundenTicketsLiveSnapshotProps> = ({
  deviceId,
  onMarkResolved,
  isAlreadyResolved,
}) => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ping = usePingTest(deviceId);

  useEffect(() => {
    if (!deviceId || !realtimeDB) {
      setSnapshot(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const [appSnap, cSnap] = await Promise.all([
          get(ref(realtimeDB!, `konstant_app/${deviceId}`)),
          get(ref(realtimeDB!, `statistik_monat_tage/${deviceId}/c`)),
        ]);
        if (cancelled) return;

        const meta = appSnap.exists() ? (appSnap.val() ?? {}) : null;

        let liveness: Liveness = 'unknown';
        let lastSeenSec: number | null = null;
        if (meta === null) {
          liveness = 'never_seen';
        } else {
          const tsfcRaw = meta.tsfc;
          if (typeof tsfcRaw === 'number' && Number.isFinite(tsfcRaw)) {
            lastSeenSec = tsfcRaw;
            const ageMs = Date.now() - tsfcRaw * 1000;
            liveness = ageMs <= PASSIVE_ONLINE_THRESHOLD_MS ? 'online' : 'offline';
          } else {
            liveness = 'offline';
          }
        }

        const cValues = { ...ZERO_C };
        if (cSnap.exists()) {
          const raw = cSnap.val() ?? {};
          for (const key of BRENNBEWERTUNG_KEYS) {
            const v = Number(raw[key]);
            if (Number.isFinite(v)) cValues[key] = Math.max(0, Math.min(100, v));
          }
        }

        const errors = decodeRigErrors({
          ecode: typeof meta?.ecode === 'number' ? meta.ecode : null,
          ecode2: typeof meta?.ecode2 === 'number' ? meta.ecode2 : null,
        });

        setSnapshot({ liveness, lastSeenSec, cValues, errors });
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[TicketLiveSnapshot] failed to load snapshot:', err);
        setError(err instanceof Error ? err.message : 'Snapshot failed');
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  // After an active ping we refresh the snapshot so the dot reflects the new
  // liveness. We only update the liveness — the C-values / errors stay as they
  // were because the active ping does not touch them.
  useEffect(() => {
    if (ping.status !== 'online' && ping.status !== 'offline') return;
    setSnapshot((prev) => (prev ? { ...prev, liveness: ping.status as Liveness } : prev));
  }, [ping.status]);

  if (isLoading) {
    return (
      <section className="rounded-theme border border-border bg-muted/20 p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-3 w-48 animate-pulse rounded bg-muted/70" />
      </section>
    );
  }

  if (error || !snapshot) {
    return (
      <section className="rounded-theme border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error ?? 'Snapshot unavailable'}
      </section>
    );
  }

  const topThree = (Object.keys(snapshot.cValues) as BrennbewertungKey[])
    .filter((k) => snapshot.cValues[k] > 0)
    .sort((a, b) => snapshot.cValues[b] - snapshot.cValues[a])
    .slice(0, 3);

  const allClear =
    snapshot.liveness === 'online' && topThree.length === 0 && snapshot.errors.length === 0;

  const livenessClass = (() => {
    if (ping.status === 'testing') return 'border-warning/40 bg-warning/10 text-warning';
    if (snapshot.liveness === 'online') return 'border-success/40 bg-success/10 text-success';
    if (snapshot.liveness === 'offline') return 'border-destructive/40 bg-destructive/10 text-destructive';
    if (snapshot.liveness === 'never_seen') return 'border-border bg-muted/30 text-muted-foreground';
    return 'border-border bg-muted/30 text-muted-foreground';
  })();

  const livenessLabel = (() => {
    if (ping.status === 'testing') return t('dealerV2.status.checking');
    if (snapshot.liveness === 'online') return t('dealerV2.status.online');
    if (snapshot.liveness === 'offline') return t('dealerV2.status.offline');
    if (snapshot.liveness === 'never_seen') return t('kundenTickets.live.neverSeen');
    return t('dealerV2.status.unknown');
  })();

  return (
    <section
      className={`rounded-theme border p-4 ${
        allClear
          ? 'border-success/40 bg-success/10'
          : 'border-border bg-muted/20'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('kundenTickets.live.heading')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium ${livenessClass}`}>
              <span className="inline-block h-2 w-2 rounded-full bg-current" />
              {livenessLabel}
            </span>
            {snapshot.lastSeenSec ? (
              <span className="text-xs text-muted-foreground">
                {t('kundenTickets.live.lastSeen', {
                  ago: formatRelativeSeconds(snapshot.lastSeenSec, t),
                })}
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('kundenTickets.live.combustion')}
              </p>
              {topThree.length === 0 ? (
                <p className="mt-1 text-sm text-foreground">{t('kundenTickets.live.combustionOk')}</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {topThree.map((k) => (
                    <li key={k} className="flex items-center gap-2 text-foreground">
                      <span className="rounded-full border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {k}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {snapshot.cValues[k]}
                      </span>
                      <span className="text-warning" aria-hidden="true">
                        {'★'.repeat(starsForCValue(snapshot.cValues[k]))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('kundenTickets.live.errors')}
              </p>
              {snapshot.errors.length === 0 ? (
                <p className="mt-1 text-sm text-foreground">{t('kundenTickets.live.errorsOk')}</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {snapshot.errors.map((e) => (
                    <li key={`${e.source}-${e.bit}`} className="text-destructive">
                      {e.description}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => void ping.ping()}
            disabled={ping.status === 'testing'}
            className="inline-flex items-center gap-1.5 rounded-theme border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            {ping.status === 'testing' ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M21 12a9 9 0 1 1-3.18-6.86" />
                <path d="M21 4v5h-5" />
              </svg>
            )}
            {ping.status === 'testing'
              ? t('dealerV2.status.checking')
              : t('kundenTickets.live.activeCheck')}
          </button>
        </div>
      </div>

      {allClear && !isAlreadyResolved && onMarkResolved ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-theme border border-success/40 bg-success/10 p-3">
          <p className="text-sm text-foreground">{t('kundenTickets.live.allClearHint')}</p>
          <button
            type="button"
            onClick={onMarkResolved}
            className="rounded-theme bg-success px-3 py-1.5 text-xs font-semibold text-success-foreground transition-colors hover:opacity-90"
          >
            {t('kundenTickets.live.markResolved')}
          </button>
        </div>
      ) : null}
    </section>
  );
};

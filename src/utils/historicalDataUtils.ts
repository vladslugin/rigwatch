import type { HistoricalLog, RigData } from '../types';

/**
 * Flatten a Firebase HistoricalLog object into a chronologically sorted array
 * of RigData entries.  Adds absolute timestamp (milliseconds) computed from
 * the log's base timestamp path and marks the entries as historical.
 *
 * @param log           HistoricalLog loaded from Firebase
 * @param baseTimestamp Unix epoch seconds (string or number) that corresponds
 *                      to the log folder name in `historien/{deviceId}/{timestamp}`.
 *                      Can be 10-digit seconds or 13-digit millis; will be
 *                      normalised to milliseconds internally.
 * @returns Sorted array of RigData objects, each including `id_timestamp` and
 *          `__historical` flag so that downstream code (preprocess, charts)
 *          can treat them correctly.
 */
export function flattenHistoricalLog(log: HistoricalLog, baseTimestamp: string | number): RigData[] {
  // Normalise base ts to number in milliseconds
  let baseMs = typeof baseTimestamp === 'string' ? Number(baseTimestamp) : baseTimestamp;
  if (baseMs < 1e11) {
    // given in seconds ➔ convert to ms
    baseMs *= 1000;
  }

  const out: RigData[] = Object.entries(log)
    .filter(([relative, data]) => typeof data === 'object' && data !== null)
    .map(([relative, data]) => {
      const relSec = Number(relative);
      const absTs = Number.isFinite(relSec) ? baseMs + relSec * 1000 : baseMs;
      return {
        ...(data as RigData),
        id_timestamp: absTs,
        __historical: true,
        __historicalPoints: Object.keys(log).length,
      } as RigData;
    })
    .sort((a, b) => (a.id_timestamp ?? 0) - (b.id_timestamp ?? 0));

  return out;
}

/**
 * Convenience helper that wraps flattenHistoricalLog for multiple logs (e.g.
 * user selected several timestamps).
 */
export function mergeHistoricalLogs(logs: Array<{ log: HistoricalLog; baseTimestamp: string | number }>): RigData[] {
  const merged: RigData[] = [];
  logs.forEach(({ log, baseTimestamp }) => {
    merged.push(...flattenHistoricalLog(log, baseTimestamp));
  });
  // Already sorted inside each log; need global sort
  merged.sort((a, b) => (a.id_timestamp ?? 0) - (b.id_timestamp ?? 0));
  return merged;
}

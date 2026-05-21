import { ref, get } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';

/**
 * Length of the Ofen-Seriennummer prefix that dealers type. Anything longer is
 * assumed to be a full device ID and returned as-is.
 */
export const SERIENNR_LENGTH = 7;

const isPureDigits = (value: string) => /^\d+$/.test(value);

/**
 * Pull the dealer-visible 7-digit Ofen-Seriennummer out of a full device ID.
 * Per Claus-Peter Hamisch (2026-04-28): dealers must NEVER see the rest of the
 * ID — only the first seven digits.
 */
export const extractSeriennr = (deviceId: string): string => {
  const trimmed = String(deviceId || '').trim();
  return trimmed.slice(0, SERIENNR_LENGTH);
};

/**
 * Find the device ID that matches a dealer-entered serial.
 *
 * Rules:
 *  - Input ≥ 14 chars or contains non-digits → returned untouched (full ID typed).
 *  - Otherwise we treat it as a Seriennr prefix and pick the matching device.
 *  - When several IDs share the same Seriennr (legacy / re-registered hardware),
 *    we resolve to the one with the freshest `tsfc` heartbeat. Claus warned us
 *    explicitly about this case in the 2026-04-28 spec.
 */
export const resolveBySeriennr = async (
  rawInput: string,
  allDeviceIds: string[]
): Promise<string | null> => {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;

  // Already a full / partial-but-long ID — let upstream code use it directly.
  if (trimmed.length >= 14) return trimmed;
  if (!isPureDigits(trimmed)) return trimmed;

  const candidates = allDeviceIds.filter((id) => id.startsWith(trimmed));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple stoves under the same Seriennr → pick the most recently active.
  const tsfcValues = await Promise.all(
    candidates.map(async (id) => {
      try {
        if (!realtimeDB) return { id, tsfc: 0 };
        const snap = await get(ref(realtimeDB, `konstant_app/${id}/tsfc`));
        const raw = snap.val();
        const tsfc = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
        return { id, tsfc };
      } catch {
        return { id, tsfc: 0 };
      }
    })
  );

  tsfcValues.sort((a, b) => b.tsfc - a.tsfc);
  return tsfcValues[0].id;
};

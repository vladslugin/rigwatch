import { create } from 'zustand';

/**
 * Replay-mode state machine. While `mode === 'replay'` the dashboard
 * stops following live telemetry and reads synthesized historical
 * samples at `positionMs` (a unix timestamp, almost always in the past).
 *
 * Playback loop is owned by the store so any component can subscribe
 * without having to coordinate timers — just read `positionMs`.
 */

const DEFAULT_WINDOW_HOURS = 24;

interface ReplayState {
  mode: 'live' | 'replay';
  /** Unix-ms timestamp the dashboard is currently displaying. */
  positionMs: number;
  /** When `true`, position advances at the chosen speed via an interval. */
  playing: boolean;
  /** Replay speed multiplier: 1× = realtime, 60× = one minute per second. */
  speed: 1 | 4 | 16 | 60 | 240;
  /** Anchor used as "the earliest we can scrub to" — usually now-24h. */
  windowStartMs: number;
  /** Anchor used as "the latest we can scrub to" — usually now (slides forward). */
  windowEndMs: number;
}

interface ReplayActions {
  enterReplay: () => void;
  exitReplay: () => void;
  setPosition: (ms: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (speed: ReplayState['speed']) => void;
  /** Internal tick — called by the interval. */
  advance: () => void;
}

type Store = ReplayState & ReplayActions;

const computeWindow = (): { start: number; end: number } => {
  const end = Date.now();
  return { start: end - DEFAULT_WINDOW_HOURS * 60 * 60 * 1000, end };
};

const initialWindow = computeWindow();

export const useReplayStore = create<Store>((set, get) => ({
  mode: 'live',
  // Default scrub position = 2h ago (so opening Replay lands somewhere meaningful)
  positionMs: initialWindow.end - 2 * 60 * 60 * 1000,
  playing: false,
  speed: 60,
  windowStartMs: initialWindow.start,
  windowEndMs: initialWindow.end,

  enterReplay: () => {
    const w = computeWindow();
    set({
      mode: 'replay',
      windowStartMs: w.start,
      windowEndMs: w.end,
      positionMs: w.end - 2 * 60 * 60 * 1000,
    });
  },

  exitReplay: () => set({ mode: 'live', playing: false }),

  setPosition: (ms) => {
    const { windowStartMs, windowEndMs } = get();
    const clamped = Math.max(windowStartMs, Math.min(windowEndMs, ms));
    set({ positionMs: clamped });
  },

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set((s) => ({ playing: !s.playing })),

  setSpeed: (speed) => set({ speed }),

  advance: () => {
    const { playing, positionMs, speed, windowEndMs, mode } = get();
    if (!playing || mode !== 'replay') return;
    // Each tick = 1s wall clock; advance positionMs by `speed` seconds.
    const next = positionMs + speed * 1000;
    if (next >= windowEndMs) {
      // Reached "now" — stop and snap to the live anchor.
      set({ positionMs: windowEndMs, playing: false });
      return;
    }
    set({ positionMs: next });
  },
}));

// Single tick driver — runs once per second while playback is on.
if (typeof window !== 'undefined') {
  setInterval(() => {
    useReplayStore.getState().advance();
  }, 1000);

  // Slide the window forward every minute so "now" stays current.
  setInterval(() => {
    const { mode } = useReplayStore.getState();
    if (mode === 'live') return;
    const w = computeWindow();
    useReplayStore.setState((s) => ({
      windowStartMs: w.start,
      windowEndMs: w.end,
      // If the user was sitting on the live edge, slide along with it.
      positionMs: s.positionMs > w.end - 60_000 ? w.end : s.positionMs,
    }));
  }, 60_000);
}

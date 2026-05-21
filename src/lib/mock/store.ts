/**
 * In-memory mirror of the legacy Firebase tree. Other mock modules
 * (database, firestore, auth) read/write through this single store.
 *
 * Layout matches what the existing UI consumes:
 *   temporaer/{rigId}            — live telemetry, tick-updated
 *   konstant/{rigId}             — device config
 *   konstant_app/{rigId}         — device metadata (model, fw, comment)
 *   historien/{rigId}/{ts}       — historical telemetry buckets (lazy)
 *   statistik_monat_tage/{rigId} — daily stats + health (C0..C6)
 *   masse_und_gewichte/{paramId} — Firestore parameter metadata
 *   users/{uid}                  — Firestore user profiles
 *
 * The store is dual-shaped: RTDB-style tree under `rtdb` and
 * Firestore-style collections under `fs`. RTDB lookups by path
 * traverse the tree; Firestore lookups go by (collection, docId).
 */

import { RIGS, RIG_BY_ID, PARAMETER_METADATA, buildKonstant, buildKonstantApp, type RigProfile } from './rigData';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AnyNode = Record<string, any> | unknown;
type Listener = (value: any) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

const splitPath = (path: string): string[] => path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

const getAt = (root: any, parts: string[]): any => {
  let cur = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
};

const setAt = (root: any, parts: string[], value: any): void => {
  if (parts.length === 0) return;
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
};

const deleteAt = (root: any, parts: string[]): void => {
  if (parts.length === 0) return;
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') return;
    cur = cur[p];
  }
  delete cur[parts[parts.length - 1]];
};

const cloneDeep = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

// ─────────────────────────────────────────────────────────────────────────────
// RTDB-style tree
// ─────────────────────────────────────────────────────────────────────────────

const rtdb: Record<string, AnyNode> = {
  temporaer: {},
  konstant: {},
  konstant_app: {},
  historien: {},
  statistik_monat_tage: {},
  users_chats: {},
  tickets: {},
  // .info/connected is read by the legacy connection monitor — we keep it true.
  '.info': { connected: true },
};

// Seed konstant + konstant_app for all rigs. temporaer is filled by the pumper.
for (const r of RIGS) {
  (rtdb.konstant as any)[r.id] = buildKonstant(r);
  (rtdb.konstant_app as any)[r.id] = buildKonstantApp(r);
  // Seed an initial empty health scorecard.
  (rtdb.statistik_monat_tage as any)[r.id] = {
    c: { C0: 5, C1: 5, C2: 5, C3: 5, C4: 5, C5: 5, C6: 5 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore-style collections
// ─────────────────────────────────────────────────────────────────────────────

const fs: Record<string, Map<string, any>> = {
  users: new Map(),
  masse_und_gewichte: new Map(),
  tickets: new Map(),
  kunden_tickets: new Map(),
  users_chats: new Map(),
  role_configs: new Map(),
  stove_models: new Map(),
  dealer_prompt_settings: new Map(),
  brennbewertung_knowledge: new Map(),
  rigops_script_library_v1: new Map(),
  app_versions: new Map(),
};

// Seed parameter metadata.
for (const [k, meta] of Object.entries(PARAMETER_METADATA)) {
  fs.masse_und_gewichte.set(k, { ...meta });
}

// Seed default role configs (mirrors what the legacy app stores).
fs.role_configs.set('viewer',     { permissions: ['read_data', 'export_data'], level: 1 });
fs.role_configs.set('admin',      { permissions: ['read_data', 'export_data', 'manage_stoves', 'modify_settings'], level: 2 });
fs.role_configs.set('developer',  { permissions: ['read_data', 'export_data', 'manage_stoves', 'modify_settings', 'manage_updates', 'manage_users', 'assign_roles'], level: 3 });
fs.role_configs.set('super_admin',{ permissions: ['read_data', 'export_data', 'manage_stoves', 'modify_settings', 'manage_users', 'assign_roles'], level: 3 });
fs.role_configs.set('pending',    { permissions: [], level: 0 });

// ─────────────────────────────────────────────────────────────────────────────
// RTDB pub/sub
// ─────────────────────────────────────────────────────────────────────────────

const rtdbListeners = new Map<string, Set<Listener>>();

const notifyRtdb = (changedPath: string): void => {
  const parts = splitPath(changedPath);
  // Notify the path itself and every ancestor — `onValue` listeners may be
  // attached at any level of the tree.
  for (let i = 0; i <= parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/');
    const set = rtdbListeners.get(ancestor);
    if (set && set.size > 0) {
      const snap = cloneDeep(getAt(rtdb, parts.slice(0, i)));
      for (const cb of set) {
        try { cb(snap); } catch (e) { /* swallow */ }
      }
    }
  }
};

export const rtdbGet = (path: string): any => cloneDeep(getAt(rtdb, splitPath(path)));

export const rtdbSet = (path: string, value: any): void => {
  setAt(rtdb, splitPath(path), cloneDeep(value));
  notifyRtdb(path);
};

export const rtdbUpdate = (path: string, updates: Record<string, any>): void => {
  // RTDB update semantics: each key in `updates` is a child path (may contain `/`).
  for (const [k, v] of Object.entries(updates)) {
    const childPath = path === '' ? k : `${path}/${k}`;
    setAt(rtdb, splitPath(childPath), cloneDeep(v));
    notifyRtdb(childPath);
  }
};

export const rtdbRemove = (path: string): void => {
  deleteAt(rtdb, splitPath(path));
  notifyRtdb(path);
};

export const rtdbTransaction = (path: string, fn: (current: any) => any): any => {
  const cur = cloneDeep(getAt(rtdb, splitPath(path)));
  const next = fn(cur);
  if (next !== undefined) {
    setAt(rtdb, splitPath(path), cloneDeep(next));
    notifyRtdb(path);
  }
  return next;
};

export const rtdbSubscribe = (path: string, cb: Listener): (() => void) => {
  const key = splitPath(path).join('/');
  if (!rtdbListeners.has(key)) rtdbListeners.set(key, new Set());
  rtdbListeners.get(key)!.add(cb);
  // Immediately deliver current value (matches Firebase onValue contract).
  queueMicrotask(() => {
    try { cb(cloneDeep(getAt(rtdb, splitPath(path)))); } catch (e) { /* swallow */ }
  });
  return () => {
    rtdbListeners.get(key)?.delete(cb);
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Firestore pub/sub
// ─────────────────────────────────────────────────────────────────────────────

type FsListener = (snap: any) => void;
const fsDocListeners = new Map<string, Set<FsListener>>();         // key: `${col}/${id}`
const fsCollectionListeners = new Map<string, Set<FsListener>>();  // key: collection name

const notifyFsDoc = (col: string, id: string): void => {
  const key = `${col}/${id}`;
  const docSet = fsDocListeners.get(key);
  const data = fs[col]?.get(id);
  if (docSet) for (const cb of docSet) { try { cb(data); } catch {} }
  const colSet = fsCollectionListeners.get(col);
  if (colSet) {
    const all = Array.from(fs[col]?.entries() ?? []).map(([k, v]) => ({ id: k, data: v }));
    for (const cb of colSet) { try { cb(all); } catch {} }
  }
};

export const fsGetDoc = (col: string, id: string): any => {
  const m = fs[col];
  if (!m) return undefined;
  const v = m.get(id);
  return v === undefined ? undefined : cloneDeep(v);
};

export const fsGetCollection = (col: string): Array<{ id: string; data: any }> => {
  const m = fs[col];
  if (!m) return [];
  return Array.from(m.entries()).map(([id, data]) => ({ id, data: cloneDeep(data) }));
};

export const fsSetDoc = (col: string, id: string, value: any): void => {
  if (!fs[col]) fs[col] = new Map();
  fs[col].set(id, cloneDeep(value));
  notifyFsDoc(col, id);
};

export const fsUpdateDoc = (col: string, id: string, updates: Record<string, any>): void => {
  if (!fs[col]) fs[col] = new Map();
  const cur = fs[col].get(id) ?? {};
  fs[col].set(id, { ...cur, ...cloneDeep(updates) });
  notifyFsDoc(col, id);
};

export const fsDeleteDoc = (col: string, id: string): void => {
  fs[col]?.delete(id);
  notifyFsDoc(col, id);
};

export const fsSubscribeDoc = (col: string, id: string, cb: FsListener): (() => void) => {
  const key = `${col}/${id}`;
  if (!fsDocListeners.has(key)) fsDocListeners.set(key, new Set());
  fsDocListeners.get(key)!.add(cb);
  queueMicrotask(() => { try { cb(fs[col]?.get(id)); } catch {} });
  return () => fsDocListeners.get(key)?.delete(cb);
};

export const fsSubscribeCollection = (col: string, cb: FsListener): (() => void) => {
  if (!fsCollectionListeners.has(col)) fsCollectionListeners.set(col, new Set());
  fsCollectionListeners.get(col)!.add(cb);
  queueMicrotask(() => {
    const all = Array.from(fs[col]?.entries() ?? []).map(([k, v]) => ({ id: k, data: cloneDeep(v) }));
    try { cb(all); } catch {}
  });
  return () => fsCollectionListeners.get(col)?.delete(cb);
};

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry pumper — drives temporaer/{rigId} ticks
// ─────────────────────────────────────────────────────────────────────────────

const noise = (amp: number): number => (Math.random() - 0.5) * 2 * amp;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface RigRuntime {
  hashrate: number;
  temp: number;
  fanFront: number;
  fanRear: number;
  power: number;
  status: number;             // matches N: 0..7
  acceptedPerMin: number;
  // Slow-moving baselines so consecutive ticks correlate (no spikes).
  baseTempDrift: number;
  baseLoadDrift: number;
}

const runtime = new Map<string, RigRuntime>();

const initRuntime = (rig: RigProfile): RigRuntime => {
  // Behavior-dependent baselines.
  const hot = rig.behavior === 'throttling' || rig.behavior === 'jittery';
  const efficient = rig.behavior === 'efficient';
  const degraded = rig.behavior === 'degraded';
  const offline = rig.behavior === 'offline';

  const baseHashrate = offline ? 0 : rig.nominalHashrate * (degraded ? 0.82 : hot ? 0.92 : 1.0);
  const baseTemp = efficient ? 42 : hot ? 82 : 65;
  const baseFan = efficient ? 35 : hot ? 95 : 65;
  const status = offline ? 0 : hot ? 4 : 3;

  return {
    hashrate: baseHashrate,
    temp: baseTemp,
    fanFront: baseFan,
    fanRear: baseFan + (hot ? 2 : 0),
    power: rig.nominalPowerW * (offline ? 0 : degraded ? 0.95 : 1.0),
    status,
    acceptedPerMin: baseHashrate > 0 ? Math.round(180 + baseHashrate * 0.2) : 0,
    baseTempDrift: 0,
    baseLoadDrift: 0,
  };
};

const tickRig = (rig: RigProfile): void => {
  if (!runtime.has(rig.id)) runtime.set(rig.id, initRuntime(rig));
  const rt = runtime.get(rig.id)!;
  const offline = rig.behavior === 'offline';

  // Slow random walk on baselines so the chart looks alive but not chaotic.
  rt.baseTempDrift = clamp(rt.baseTempDrift + noise(0.3), -3, 3);
  rt.baseLoadDrift = clamp(rt.baseLoadDrift + noise(0.4), -4, 4);

  if (offline) {
    rtdbSet(`temporaer/${rig.id}`, {
      T: 22, PL: 0, SL: 0, P: 0, N: 0, CO2: 0, TRIG1: 0,
      a: 1, id_timestamp: Date.now(),
    });
    return;
  }

  // Per-behavior jitter amplitudes.
  const jitter = rig.behavior === 'jittery' ? 6 : rig.behavior === 'throttling' ? 4 : 1.5;
  const tempJitter = rig.behavior === 'throttling' ? 3 : rig.behavior === 'efficient' ? 0.5 : 1.5;

  const hashrate = clamp(
    rig.nominalHashrate * (rig.behavior === 'degraded' ? 0.82 : rig.behavior === 'throttling' ? 0.92 : 1.0)
      + rt.baseLoadDrift + noise(jitter),
    0,
    rig.nominalHashrate * 1.05,
  );
  rt.hashrate = hashrate;

  const targetTemp = rig.behavior === 'efficient' ? 42 : rig.behavior === 'throttling' ? 82 : 65;
  rt.temp = clamp(targetTemp + rt.baseTempDrift + noise(tempJitter), 30, 95);

  // Fans react to temperature (linearised).
  const fanTarget = clamp(35 + (rt.temp - 40) * 1.6, 25, 100);
  rt.fanFront = clamp(fanTarget + noise(2), 0, 100);
  rt.fanRear = clamp(fanTarget + noise(2.5), 0, 100);

  rt.power = clamp(
    rig.nominalPowerW * (hashrate / rig.nominalHashrate) + noise(40),
    0,
    rig.nominalPowerW * 1.1,
  );

  rt.status = rig.behavior === 'throttling' ? 4 : 3;

  // Share counter — jittery rigs occasionally drop to near-zero (rejection spike).
  const baseShareRate = 180 + rig.nominalHashrate * 0.2;
  rt.acceptedPerMin = rig.behavior === 'jittery' && Math.random() < 0.08
    ? Math.round(baseShareRate * 0.4)
    : Math.round(baseShareRate + noise(8));

  rtdbSet(`temporaer/${rig.id}`, {
    T: Math.round(rt.temp * 10) / 10,
    PL: Math.round(rt.fanFront * 10) / 10,
    SL: Math.round(rt.fanRear * 10) / 10,
    P: Math.round(rt.hashrate * 10) / 10,
    N: rt.status,
    CO2: Math.round(rt.power),
    TRIG1: rt.acceptedPerMin,
    a: 1,
    id_timestamp: Date.now(),
  });
};

let pumperHandle: ReturnType<typeof setInterval> | null = null;

export const startTelemetryPumper = (intervalMs = 2000): void => {
  if (pumperHandle) return;
  // Initial flush so connecting rigs have data immediately.
  for (const r of RIGS) tickRig(r);
  pumperHandle = setInterval(() => {
    for (const r of RIGS) tickRig(r);
  }, intervalMs);
};

export const stopTelemetryPumper = (): void => {
  if (pumperHandle) {
    clearInterval(pumperHandle);
    pumperHandle = null;
  }
};

// Auto-start the pumper at module load — every consumer of the mock store
// gets live data without any explicit boot step.
startTelemetryPumper();

// ─────────────────────────────────────────────────────────────────────────────
// Debug helpers (used by Phase 6 features and the docs preview).
// ─────────────────────────────────────────────────────────────────────────────

export const __mockStore = { rtdb, fs, RIG_BY_ID };

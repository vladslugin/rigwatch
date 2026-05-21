/**
 * Mock for `firebase/database`. Implements the named exports the legacy
 * code consumes — ref, onValue, get, set, update, remove, runTransaction,
 * off, getDatabase, push, child, type Database — backed by the in-memory
 * tree in ./store.
 *
 * Wired via Vite's resolve.alias so `import { ref, onValue } from 'firebase/database'`
 * lands here instead of the real package.
 */

import {
  rtdbGet,
  rtdbSet,
  rtdbUpdate,
  rtdbRemove,
  rtdbTransaction,
  rtdbSubscribe,
} from './store';

// ─────────────────────────────────────────────────────────────────────────────
// Reference objects
// ─────────────────────────────────────────────────────────────────────────────

export interface Database {
  __mock: true;
}

export interface DatabaseReference {
  __mockRef: true;
  path: string;
  key: string | null;
  parent: DatabaseReference | null;
  root: DatabaseReference;
  toString: () => string;
}

const buildRef = (path: string): DatabaseReference => {
  const normalized = path.replace(/^\/+|\/+$/g, '');
  const segments = normalized.split('/').filter(Boolean);
  const key = segments.length === 0 ? null : segments[segments.length - 1];
  const parentPath = segments.slice(0, -1).join('/');

  const refObj: DatabaseReference = {
    __mockRef: true,
    path: normalized,
    key,
    parent: null as any,
    root: null as any,
    toString: () => normalized,
  };

  Object.defineProperty(refObj, 'parent', {
    get: () => (segments.length === 0 ? null : buildRef(parentPath)),
  });
  Object.defineProperty(refObj, 'root', {
    get: () => buildRef(''),
  });

  return refObj;
};

export const getDatabase = (_app?: any): Database => ({ __mock: true });

export const ref = (_db: Database | any, path?: string): DatabaseReference => buildRef(path ?? '');

export const child = (parent: DatabaseReference, path: string): DatabaseReference =>
  buildRef(parent.path ? `${parent.path}/${path}` : path);

export const push = (parent: DatabaseReference, value?: any): DatabaseReference => {
  const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const childRef = buildRef(`${parent.path}/${id}`);
  if (value !== undefined) rtdbSet(childRef.path, value);
  return childRef;
};

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots
// ─────────────────────────────────────────────────────────────────────────────

export class DataSnapshot {
  private _value: any;
  public ref: DatabaseReference;
  public key: string | null;

  constructor(value: any, refObj: DatabaseReference) {
    this._value = value;
    this.ref = refObj;
    this.key = refObj.key;
  }

  exists(): boolean {
    return this._value !== undefined && this._value !== null;
  }

  val(): any {
    return this._value === undefined ? null : this._value;
  }

  toJSON(): any {
    return this.val();
  }

  hasChild(path: string): boolean {
    if (!this._value || typeof this._value !== 'object') return false;
    const parts = path.split('/').filter(Boolean);
    let cur = this._value;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return false;
      cur = cur[p];
    }
    return cur !== undefined && cur !== null;
  }

  child(path: string): DataSnapshot {
    const parts = path.split('/').filter(Boolean);
    let cur = this._value;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') { cur = undefined; break; }
      cur = cur[p];
    }
    return new DataSnapshot(cur, buildRef(`${this.ref.path}/${path}`));
  }

  forEach(cb: (snap: DataSnapshot) => boolean | void): boolean {
    if (!this._value || typeof this._value !== 'object') return false;
    for (const [k, v] of Object.entries(this._value)) {
      const stop = cb(new DataSnapshot(v, buildRef(`${this.ref.path}/${k}`)));
      if (stop === true) return true;
    }
    return false;
  }

  get size(): number {
    if (!this._value || typeof this._value !== 'object') return 0;
    return Object.keys(this._value).length;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read / write API
// ─────────────────────────────────────────────────────────────────────────────

export const get = async (r: DatabaseReference): Promise<DataSnapshot> => {
  // Special-case .info/connected — always true in mock.
  if (r.path === '.info/connected') return new DataSnapshot(true, r);
  const value = rtdbGet(r.path);
  return new DataSnapshot(value, r);
};

export const set = async (r: DatabaseReference, value: any): Promise<void> => {
  rtdbSet(r.path, value);
};

export const update = async (r: DatabaseReference, updates: Record<string, any>): Promise<void> => {
  rtdbUpdate(r.path, updates);
};

export const remove = async (r: DatabaseReference): Promise<void> => {
  rtdbRemove(r.path);
};

export interface TransactionResult {
  committed: boolean;
  snapshot: DataSnapshot;
}

export const runTransaction = async (
  r: DatabaseReference,
  transactionUpdate: (current: any) => any,
): Promise<TransactionResult> => {
  const next = rtdbTransaction(r.path, transactionUpdate);
  return {
    committed: next !== undefined,
    snapshot: new DataSnapshot(next, r),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Listeners
// ─────────────────────────────────────────────────────────────────────────────

const listenerByCallback = new WeakMap<Function, () => void>();

export const onValue = (
  r: DatabaseReference,
  callback: (snap: DataSnapshot) => void,
  errorCallback?: (err: Error) => void,
): (() => void) => {
  // Special-case .info/connected — fire once with true.
  if (r.path === '.info/connected') {
    queueMicrotask(() => {
      try { callback(new DataSnapshot(true, r)); } catch (e) {
        try { errorCallback?.(e as Error); } catch {}
      }
    });
    return () => { /* nothing to unsubscribe */ };
  }

  const unsub = rtdbSubscribe(r.path, (value) => {
    try {
      callback(new DataSnapshot(value, r));
    } catch (e) {
      try { errorCallback?.(e as Error); } catch {}
    }
  });
  listenerByCallback.set(callback, unsub);
  return unsub;
};

// `off(ref, eventType?, callback?)` — minimal: removes the callback's listener.
export const off = (_r: DatabaseReference, _eventType?: string, callback?: Function): void => {
  if (!callback) return;
  const unsub = listenerByCallback.get(callback);
  if (unsub) {
    unsub();
    listenerByCallback.delete(callback);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Server timestamp sentinel (used by some writes).
// ─────────────────────────────────────────────────────────────────────────────

export const serverTimestamp = (): { '.sv': string } => ({ '.sv': 'timestamp' });

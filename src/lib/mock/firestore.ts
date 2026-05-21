/**
 * Mock for `firebase/firestore`. Implements the surface that the legacy
 * code uses: collection, doc, getDoc, getDocs, setDoc, updateDoc,
 * addDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
 * serverTimestamp, Timestamp, writeBatch, getFirestore.
 *
 * Constraints handled in-memory: eq / != / in / >= / <= / >. orderBy +
 * limit applied after filtering. onSnapshot delivers immediately on
 * subscribe and again on every mutation.
 */

import {
  fsGetDoc,
  fsGetCollection,
  fsSetDoc,
  fsUpdateDoc,
  fsDeleteDoc,
  fsSubscribeDoc,
  fsSubscribeCollection,
} from './store';

// ─────────────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────────────

export interface Firestore {
  __mock: true;
}

export type Unsubscribe = () => void;

export interface CollectionReference {
  __mockKind: 'collection';
  id: string;
  path: string;
}

export interface DocumentReference {
  __mockKind: 'doc';
  id: string;
  path: string;
  // For deep paths (e.g. users_chats/{cid}/messages/{mid}) we store the
  // top-level collection name + a synthetic key. This handles the existing
  // app — every doc/setDoc call in the code targets a flat collection.
  collectionId: string;
  docId: string;
}

interface FilterClause {
  field: string;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';
  value: any;
}

interface OrderClause {
  field: string;
  direction: 'asc' | 'desc';
}

export interface Query {
  __mockKind: 'query';
  collectionId: string;
  filters: FilterClause[];
  orders: OrderClause[];
  limitN?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot classes
// ─────────────────────────────────────────────────────────────────────────────

export class DocumentSnapshot {
  public ref: DocumentReference;
  public id: string;
  private _data: any;

  constructor(ref: DocumentReference, data: any) {
    this.ref = ref;
    this.id = ref.docId;
    this._data = data;
  }

  exists(): boolean {
    return this._data !== undefined && this._data !== null;
  }

  data(): any {
    return this._data === undefined ? undefined : { ...this._data };
  }

  get(field: string): any {
    return this._data?.[field];
  }
}

export class QueryDocumentSnapshot extends DocumentSnapshot {
  data(): any {
    return super.data() ?? {};
  }
}

export class QuerySnapshot {
  public docs: QueryDocumentSnapshot[];
  public size: number;
  public empty: boolean;

  constructor(docs: QueryDocumentSnapshot[]) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }

  forEach(cb: (doc: QueryDocumentSnapshot) => void): void {
    this.docs.forEach(cb);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Refs
// ─────────────────────────────────────────────────────────────────────────────

export const getFirestore = (_app?: any): Firestore => ({ __mock: true });

export const collection = (db: Firestore | DocumentReference | any, ...pathSegments: string[]): CollectionReference => {
  // collection(db, 'users') | collection(db, 'users', 'uid', 'inbox')
  const fullPath = pathSegments.join('/');
  // Use the first segment as the canonical collection id.
  const id = pathSegments[0] ?? '';
  return { __mockKind: 'collection', id, path: fullPath };
};

export const doc = (
  dbOrCollection: Firestore | CollectionReference | any,
  ...pathSegments: string[]
): DocumentReference => {
  // Case A: doc(db, 'collection/id')      — segments may contain slashes
  // Case B: doc(db, 'collection', 'id')
  // Case C: doc(collectionRef, 'id')
  // Case D: doc(collectionRef)            — auto-id
  let collectionId: string;
  let docId: string;

  if (dbOrCollection && (dbOrCollection as CollectionReference).__mockKind === 'collection') {
    const colRef = dbOrCollection as CollectionReference;
    collectionId = colRef.id;
    docId = pathSegments[0] ?? `auto_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } else {
    // db-rooted form
    const allParts = pathSegments.flatMap((p) => String(p).split('/')).filter(Boolean);
    if (allParts.length < 2) throw new Error(`Invalid doc path: ${pathSegments.join('/')}`);
    collectionId = allParts[0];
    docId = allParts[allParts.length - 1];
  }

  return {
    __mockKind: 'doc',
    id: docId,
    path: `${collectionId}/${docId}`,
    collectionId,
    docId,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Read / write
// ─────────────────────────────────────────────────────────────────────────────

export const getDoc = async (ref: DocumentReference): Promise<DocumentSnapshot> => {
  const data = fsGetDoc(ref.collectionId, ref.docId);
  return new DocumentSnapshot(ref, data);
};

export const setDoc = async (ref: DocumentReference, data: any, options?: { merge?: boolean }): Promise<void> => {
  if (options?.merge) {
    const prev = fsGetDoc(ref.collectionId, ref.docId);
    fsUpdateDoc(ref.collectionId, ref.docId, materialize(data, prev));
  } else {
    fsSetDoc(ref.collectionId, ref.docId, materialize(data));
  }
};

export const updateDoc = async (ref: DocumentReference, updates: Record<string, any>): Promise<void> => {
  const prev = fsGetDoc(ref.collectionId, ref.docId);
  fsUpdateDoc(ref.collectionId, ref.docId, materialize(updates, prev));
};

export const deleteDoc = async (ref: DocumentReference): Promise<void> => {
  fsDeleteDoc(ref.collectionId, ref.docId);
};

export const addDoc = async (col: CollectionReference, data: any): Promise<DocumentReference> => {
  const docId = `auto_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  fsSetDoc(col.id, docId, materialize(data));
  return { __mockKind: 'doc', id: docId, path: `${col.id}/${docId}`, collectionId: col.id, docId };
};

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export const query = (
  source: CollectionReference | Query,
  ...constraints: any[]
): Query => {
  let base: Query;
  if ((source as Query).__mockKind === 'query') {
    base = source as Query;
  } else {
    const col = source as CollectionReference;
    base = { __mockKind: 'query', collectionId: col.id, filters: [], orders: [], limitN: undefined };
  }
  const filters = [...base.filters];
  const orders = [...base.orders];
  let limitN = base.limitN;
  for (const c of constraints) {
    if (!c) continue;
    if (c.__type === 'where') filters.push({ field: c.field, op: c.op, value: c.value });
    else if (c.__type === 'orderBy') orders.push({ field: c.field, direction: c.direction });
    else if (c.__type === 'limit') limitN = c.n;
  }
  return { __mockKind: 'query', collectionId: base.collectionId, filters, orders, limitN };
};

export const where = (field: string, op: FilterClause['op'], value: any) =>
  ({ __type: 'where', field, op, value });

export const orderBy = (field: string, direction: OrderClause['direction'] = 'asc') =>
  ({ __type: 'orderBy', field, direction });

export const limit = (n: number) => ({ __type: 'limit', n });

// Pagination cursor — accepted but ignored in mock (single page suffices
// for a portfolio dataset that's already in-memory).
export const startAfter = (..._args: any[]) => ({ __type: 'startAfter', _args });
export const startAt = (..._args: any[]) => ({ __type: 'startAt', _args });
export const endBefore = (..._args: any[]) => ({ __type: 'endBefore', _args });
export const endAt = (..._args: any[]) => ({ __type: 'endAt', _args });

const matchFilter = (data: any, f: FilterClause): boolean => {
  const v = data?.[f.field];
  switch (f.op) {
    case '==': return v === f.value;
    case '!=': return v !== f.value;
    case '<': return v < f.value;
    case '<=': return v <= f.value;
    case '>': return v > f.value;
    case '>=': return v >= f.value;
    case 'in': return Array.isArray(f.value) && f.value.includes(v);
    case 'not-in': return Array.isArray(f.value) && !f.value.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(f.value);
    default: return true;
  }
};

const runQuery = (q: Query | CollectionReference): Array<{ id: string; data: any }> => {
  const collectionId = (q as Query).__mockKind === 'query' ? (q as Query).collectionId : (q as CollectionReference).id;
  let rows = fsGetCollection(collectionId);
  if ((q as Query).__mockKind === 'query') {
    const qq = q as Query;
    if (qq.filters.length) rows = rows.filter(({ data }) => qq.filters.every((f) => matchFilter(data, f)));
    if (qq.orders.length) {
      rows = rows.slice().sort((a, b) => {
        for (const o of qq.orders) {
          const av = a.data?.[o.field];
          const bv = b.data?.[o.field];
          if (av === bv) continue;
          const cmp = av < bv ? -1 : 1;
          return o.direction === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (qq.limitN !== undefined) rows = rows.slice(0, qq.limitN);
  }
  return rows;
};

export const getDocs = async (q: Query | CollectionReference): Promise<QuerySnapshot> => {
  const rows = runQuery(q);
  const collectionId = (q as Query).__mockKind === 'query' ? (q as Query).collectionId : (q as CollectionReference).id;
  const snaps = rows.map(({ id, data }) =>
    new QueryDocumentSnapshot({ __mockKind: 'doc', id, path: `${collectionId}/${id}`, collectionId, docId: id }, data),
  );
  return new QuerySnapshot(snaps);
};

// ─────────────────────────────────────────────────────────────────────────────
// Listeners
// ─────────────────────────────────────────────────────────────────────────────

export const onSnapshot = (
  target: DocumentReference | Query | CollectionReference,
  cbOrOptions: any,
  maybeErrCb?: any,
): Unsubscribe => {
  const callback = typeof cbOrOptions === 'function' ? cbOrOptions : cbOrOptions?.next;
  const errorCallback = typeof cbOrOptions === 'function' ? maybeErrCb : cbOrOptions?.error;

  // Doc ref
  if ((target as DocumentReference).__mockKind === 'doc') {
    const ref = target as DocumentReference;
    return fsSubscribeDoc(ref.collectionId, ref.docId, (data) => {
      try {
        callback?.(new DocumentSnapshot(ref, data));
      } catch (e) {
        try { errorCallback?.(e); } catch {}
      }
    });
  }

  // Collection or query
  const collectionId =
    (target as Query).__mockKind === 'query'
      ? (target as Query).collectionId
      : (target as CollectionReference).id;

  return fsSubscribeCollection(collectionId, () => {
    try {
      const rows = runQuery(target as Query | CollectionReference);
      const snaps = rows.map(({ id, data }) =>
        new QueryDocumentSnapshot(
          { __mockKind: 'doc', id, path: `${collectionId}/${id}`, collectionId, docId: id },
          data,
        ),
      );
      callback?.(new QuerySnapshot(snaps));
    } catch (e) {
      try { errorCallback?.(e); } catch {}
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Timestamps + batches + materialise (resolves serverTimestamp sentinels)
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_TIMESTAMP_SENTINEL = Symbol('serverTimestamp');
const DELETE_FIELD_SENTINEL = Symbol('deleteField');

export const serverTimestamp = (): any => SERVER_TIMESTAMP_SENTINEL;
export const deleteField = (): any => DELETE_FIELD_SENTINEL;

interface ArrayUnionSentinel { __mockOp: 'arrayUnion'; values: any[] }
interface ArrayRemoveSentinel { __mockOp: 'arrayRemove'; values: any[] }
interface IncrementSentinel { __mockOp: 'increment'; delta: number }

export const arrayUnion = (...values: any[]): ArrayUnionSentinel =>
  ({ __mockOp: 'arrayUnion', values });

export const arrayRemove = (...values: any[]): ArrayRemoveSentinel =>
  ({ __mockOp: 'arrayRemove', values });

export const increment = (delta: number): IncrementSentinel =>
  ({ __mockOp: 'increment', delta });

export const FieldValue = { serverTimestamp, deleteField, arrayUnion, arrayRemove, increment };

export class Timestamp {
  public seconds: number;
  public nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static now(): Timestamp {
    const ms = Date.now();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }

  static fromDate(date: Date): Timestamp {
    const ms = date.getTime();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }

  static fromMillis(ms: number): Timestamp {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }

  toDate(): Date {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
  }

  toMillis(): number {
    return this.seconds * 1000 + this.nanoseconds / 1e6;
  }
}

const isMockOp = (v: any, op: string): boolean =>
  v != null && typeof v === 'object' && (v as any).__mockOp === op;

const materialize = (input: any, prevAtField?: any): any => {
  if (input === SERVER_TIMESTAMP_SENTINEL) return Timestamp.now();
  if (input === DELETE_FIELD_SENTINEL) return undefined;
  if (isMockOp(input, 'arrayUnion')) {
    const base = Array.isArray(prevAtField) ? [...prevAtField] : [];
    for (const v of (input as any).values) if (!base.includes(v)) base.push(v);
    return base;
  }
  if (isMockOp(input, 'arrayRemove')) {
    const base = Array.isArray(prevAtField) ? [...prevAtField] : [];
    return base.filter((v) => !(input as any).values.includes(v));
  }
  if (isMockOp(input, 'increment')) {
    const cur = typeof prevAtField === 'number' ? prevAtField : 0;
    return cur + (input as any).delta;
  }
  if (input == null || typeof input !== 'object') return input;
  if (input instanceof Timestamp) return input;
  if (Array.isArray(input)) return input.map((x) => materialize(x));
  const out: any = {};
  for (const [k, v] of Object.entries(input)) {
    const resolved = materialize(v, prevAtField?.[k]);
    if (resolved !== undefined) out[k] = resolved;
  }
  return out;
};

interface WriteBatchOp {
  kind: 'set' | 'update' | 'delete';
  ref: DocumentReference;
  data?: any;
  options?: { merge?: boolean };
}

export const writeBatch = (_db: Firestore) => {
  const ops: WriteBatchOp[] = [];
  return {
    set(ref: DocumentReference, data: any, options?: { merge?: boolean }) {
      ops.push({ kind: 'set', ref, data, options });
      return this;
    },
    update(ref: DocumentReference, data: any) {
      ops.push({ kind: 'update', ref, data });
      return this;
    },
    delete(ref: DocumentReference) {
      ops.push({ kind: 'delete', ref });
      return this;
    },
    async commit() {
      for (const op of ops) {
        if (op.kind === 'set') await setDoc(op.ref, op.data, op.options);
        else if (op.kind === 'update') await updateDoc(op.ref, op.data);
        else await deleteDoc(op.ref);
      }
    },
  };
};

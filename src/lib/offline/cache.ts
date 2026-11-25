// The last known results of queries, per account, in IndexedDB: the app opens
// with them at once, and works from them offline. All in memory while running.

const DB = "fomo";
const STORE = "queries";
// Raise when the shape of cached results changes.
const VERSION = 1;
const WRITE_DELAY_MS = 1000;

type Entry = { value: unknown; savedAt: number };

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB failed"));
  });
}

async function open(): Promise<IDBDatabase> {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  return await request(r);
}

export class QueryCache {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private db: IDBDatabase | null = null;
  private prefix: string;
  private closed = false;

  constructor(userId: string) {
    this.prefix = `${VERSION}|${userId}|`;
  }

  private get range() {
    return IDBKeyRange.bound(this.prefix, `${this.prefix}￿`);
  }

  async load() {
    try {
      this.db = await open();
      const store = this.db.transaction(STORE).objectStore(STORE);
      const [keys, values] = await Promise.all([
        request(store.getAllKeys(this.range)),
        request(store.getAll(this.range) as IDBRequest<Entry[]>),
      ]);
      keys.forEach((k, i) => this.entries.set(String(k).slice(this.prefix.length), values[i]));
    } catch (e) {
      // No offline use then (private window, full disk), but the app works.
      console.warn("Offline cache unavailable", e);
    }
  }

  get = (key: string) => this.entries.get(key)?.value;
  savedAt = (key: string) => this.entries.get(key)?.savedAt ?? 0;

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  };

  set(key: string, value: unknown) {
    if (this.closed || this.get(key) === value) return;
    this.entries.set(key, { value, savedAt: Date.now() });
    this.dirty.add(key);
    this.timer ??= setTimeout(() => this.flush(), WRITE_DELAY_MS);
    for (const f of this.listeners) f();
  }

  flush = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.db || this.dirty.size === 0) return;
    try {
      const store = this.db.transaction(STORE, "readwrite").objectStore(STORE);
      for (const key of this.dirty) store.put(this.entries.get(key), this.prefix + key);
      this.dirty.clear();
    } catch (e) {
      console.warn("Offline cache not saved", e);
    }
  };

  // Signing out: nothing of the account stays on the device.
  async clear() {
    this.closed = true;
    clearTimeout(this.timer);
    this.dirty.clear();
    this.entries.clear();
    try {
      if (this.db) await request(this.db.transaction(STORE, "readwrite").objectStore(STORE).delete(this.range));
      if ("caches" in globalThis) await caches.delete("covers");
    } catch (e) {
      console.warn("Offline cache not cleared", e);
    }
  }
}

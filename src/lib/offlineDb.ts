// Lightweight IndexedDB wrapper for offline caching and sync queue

const DB_NAME = "esba-offline";
const DB_VERSION = 1;

type StoreName = "students" | "syncQueue" | "meta";

export type OfflineStudent = {
  id: string;
  surname: string;
  firstName: string;
  middleName?: string;
  gender: string;
  dob: string;
  guardianContact?: string;
  class: string;
  status: string;
  version: number;
};

export type SyncChange = {
  id: string;
  type: "upsert" | "delete";
  doc?: OfflineStudent;
  version: number;
  clientId: string;
  timestamp: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("students")) {
        const s = db.createObjectStore("students", { keyPath: "id" });
        s.createIndex("class", "class", { unique: false });
      }
      if (!db.objectStoreNames.contains("syncQueue")) {
        db.createObjectStore("syncQueue", { keyPath: "timestamp" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => void | Promise<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let done = false;
    const wrap = async () => {
      try {
        const r = await fn(s);
        if (!done) {
          done = true;
          resolve(r as T);
        }
      } catch (e) {
        if (!done) {
          done = true;
          reject(e);
        }
      }
    };
    t.oncomplete = () => {
      if (!done) resolve(undefined as T);
    };
    t.onerror = () => {
      if (!done) reject(t.error);
    };
    void wrap();
  });
}

export const offlineDb = {
  async putStudent(doc: OfflineStudent): Promise<void> {
    await tx("students", "readwrite", (s) => {
      s.put(doc);
    });
  },

  async getStudentsByClass(cls?: string): Promise<OfflineStudent[]> {
    return tx("students", "readonly", (s) => {
      return new Promise<OfflineStudent[]>((resolve, reject) => {
        const items: OfflineStudent[] = [];
        let req: IDBRequest<IDBCursorWithValue | null>;
        if (cls) {
          const idx = s.index("class");
          req = idx.openCursor(IDBKeyRange.only(cls));
        } else {
          req = s.openCursor();
        }
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve(items);
          items.push(cur.value as OfflineStudent);
          cur.continue();
        };
      });
    });
  },

  async queueChange(change: SyncChange): Promise<void> {
    await tx("syncQueue", "readwrite", (s) => {
      s.put(change);
    });
  },

  async getQueuedChanges(limit = 100): Promise<SyncChange[]> {
    return tx("syncQueue", "readonly", (s) => {
      return new Promise<SyncChange[]>((resolve, reject) => {
        const items: SyncChange[] = [];
        const req = s.openCursor();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur || items.length >= limit) return resolve(items);
          items.push(cur.value as SyncChange);
          cur.continue();
        };
      });
    });
  },

  async deleteQueuedChanges(timestamps: number[]): Promise<void> {
    await tx("syncQueue", "readwrite", (s) => {
      timestamps.forEach((ts) => s.delete(ts));
    });
  },

  async getMeta<T>(key: string): Promise<T | null> {
    return tx("meta", "readonly", (s) => {
      return new Promise<T | null>((resolve, reject) => {
        const req = s.get(key);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const v = req.result as { key: string; value: T } | undefined;
          resolve(v ? v.value : null);
        };
      });
    });
  },

  async setMeta<T>(key: string, value: T): Promise<void> {
    await tx("meta", "readwrite", (s) => {
      s.put({ key, value });
    });
  },
};

/*
Public API: ClientSync helper for robust client-server synchronization
- Methods:
  - constructor(options)
  - queueUpsert(doc)
  - queueDelete(id)
  - flush()
  - start()
  - stop()
  - getStatus()
  - getPendingCount()
  - getHistory()
- Usage:
  const sync = new ClientSync({ baseUrl: "/api", token: myToken });
  sync.queueUpsert({ id: "S1", surname: "A", firstName: "B", class: "JHS 1", status: "Active", version: 1 });
  await sync.flush();
*/

import { logger } from "./logger";
import { kvGet, kvSet } from "./storage";

export type StudentDoc = {
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

type ChangeType = "upsert" | "delete";
export type Change = {
  id: string;
  type: ChangeType;
  doc?: StudentDoc;
  version: number;
  clientId: string;
  timestamp: number;
};

export type SyncStatus = {
  online: boolean;
  pending: number;
  lastCheckpoint: number;
  lastError?: string;
  lastSyncAt?: number;
};

type RequestAdapter = {
  get: (
    url: string,
    headers?: Record<string, string>
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  post: (
    url: string,
    body: unknown,
    headers?: Record<string, string>
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
};

type ConflictResolver = (
  local: Change,
  remote: { latestVersion: number; latestDoc?: StudentDoc }
) => Change | null | undefined;

function defaultAdapter(): RequestAdapter {
  return {
    async get(url, headers) {
      const resp = await fetch(url, { method: "GET", headers });
      return { ok: resp.ok, status: resp.status, json: () => resp.json() };
    },
    async post(url, body, headers) {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(headers || {}) },
        body: JSON.stringify(body),
      });
      return { ok: resp.ok, status: resp.status, json: () => resp.json() };
    },
  };
}

function nowTs(): number {
  return Date.now();
}

const LS_QUEUE = "SYNC::QUEUE";
const LS_CP = "SYNC::CHECKPOINT";
const LS_HISTORY = "SYNC::HISTORY";

function safeLocalStorageGet<T>(key: string): T | null {
  return kvGet<T>("local", key.replace(/^SYNC::/, ""));
}
function safeLocalStorageSet<T>(key: string, val: T): void {
  kvSet("local", key.replace(/^SYNC::/, ""), val);
}

export class ClientSync {
  private baseUrl: string;
  private token?: string;
  private adapter: RequestAdapter;
  private queue: Change[] = [];
  private history: Array<{ at: number; event: string; detail?: unknown }> = [];
  private checkpoint = 0;
  private timer: number | null = null;
  private throttleMs: number;
  private batchSize: number;
  private backoffMs = 1000;
  private maxBackoffMs = 30000;
  private resolveConflict?: ConflictResolver;

  constructor(options: {
    baseUrl: string;
    token?: string;
    adapter?: RequestAdapter;
    throttleMs?: number;
    batchSize?: number;
    resolveConflict?: ConflictResolver;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.adapter = options.adapter || defaultAdapter();
    this.throttleMs = Math.max(200, options.throttleMs || 1000);
    this.batchSize = Math.max(1, options.batchSize || 50);
    this.resolveConflict = options.resolveConflict;
    const q = safeLocalStorageGet<Change[]>(LS_QUEUE);
    this.queue = Array.isArray(q) ? q : [];
    const cp = safeLocalStorageGet<number>(LS_CP);
    this.checkpoint = typeof cp === "number" ? cp : 0;
    const hist =
      safeLocalStorageGet<
        Array<{ at: number; event: string; detail?: unknown }>
      >(LS_HISTORY);
    this.history = Array.isArray(hist) ? hist : [];
  }

  setToken(token?: string): void {
    this.token = token;
  }

  queueUpsert(doc: StudentDoc): void {
    const change: Change = {
      id: doc.id,
      type: "upsert",
      doc,
      version: doc.version,
      clientId: "client",
      timestamp: nowTs(),
    };
    this.queue.push(change);
    safeLocalStorageSet(LS_QUEUE, this.queue);
    this.history.push({
      at: nowTs(),
      event: "queue_upsert",
      detail: { id: doc.id },
    });
    safeLocalStorageSet(LS_HISTORY, this.history);
  }

  queueDelete(id: string, version = 1): void {
    const change: Change = {
      id,
      type: "delete",
      version,
      clientId: "client",
      timestamp: nowTs(),
    };
    this.queue.push(change);
    safeLocalStorageSet(LS_QUEUE, this.queue);
    this.history.push({ at: nowTs(), event: "queue_delete", detail: { id } });
    safeLocalStorageSet(LS_HISTORY, this.history);
  }

  async flush(): Promise<SyncStatus> {
    const online = typeof navigator !== "undefined" ? !!navigator.onLine : true;
    if (!online) {
      return this.getStatus();
    }
    const pending = this.queue.slice(0, this.batchSize);
    if (pending.length === 0) return this.getStatus();
    const hdrs: Record<string, string> = this.token
      ? { "x-blob-token": this.token }
      : {};
    const resp = await this.adapter.post(
      `${this.baseUrl}/sync/push`,
      { changes: pending },
      hdrs
    );
    if (!resp.ok) {
      logger.error("sync_push_failed", { status: resp.status });
      this.history.push({
        at: nowTs(),
        event: "push_failed",
        detail: { status: resp.status },
      });
      safeLocalStorageSet(LS_HISTORY, this.history);
      await this.retry();
      return this.getStatus();
    }
    const json = (await resp.json()) as {
      results?: Array<{
        id: string;
        status: string;
        latestVersion?: number;
        latestDoc?: StudentDoc;
      }>;
      checkpoint?: number;
    } | null;
    const checkpoint =
      json?.checkpoint && typeof json.checkpoint === "number"
        ? json.checkpoint
        : this.checkpoint;
    this.checkpoint = checkpoint;
    safeLocalStorageSet(LS_CP, this.checkpoint);

    const results = Array.isArray(json?.results) ? json!.results! : [];
    const remainder = this.queue.slice(pending.length);
    const nextQueue: Change[] = [];
    for (let i = 0; i < pending.length; i++) {
      const local = pending[i];
      const res = results[i] || { id: local.id, status: "skipped" };
      if (res.status === "ok") {
        continue;
      }
      if (res.status === "conflict") {
        const resolved = this.resolveConflict
          ? this.resolveConflict(local, {
              latestVersion: Number(res.latestVersion || 0),
              latestDoc: res.latestDoc,
            })
          : null;
        if (resolved) {
          nextQueue.push(resolved);
          logger.warn("sync_conflict_resolved", { id: local.id });
          this.history.push({
            at: nowTs(),
            event: "conflict_resolved",
            detail: { id: local.id },
          });
        } else {
          logger.warn("sync_conflict_drop", { id: local.id });
          this.history.push({
            at: nowTs(),
            event: "conflict_drop",
            detail: { id: local.id },
          });
        }
        continue;
      }
      nextQueue.push(local);
    }
    this.queue = nextQueue.concat(remainder);
    safeLocalStorageSet(LS_QUEUE, this.queue);
    this.history.push({
      at: nowTs(),
      event: "push_ok",
      detail: { count: pending.length },
    });
    logger.info("sync_push_ok", { count: pending.length });
    safeLocalStorageSet(LS_HISTORY, this.history);
    await this.pull();
    this.backoffMs = 1000;
    return this.getStatus();
  }

  async pull(): Promise<void> {
    const online = typeof navigator !== "undefined" ? !!navigator.onLine : true;
    if (!online) return;
    const resp = await this.adapter.get(
      `${this.baseUrl}/sync/pull?since=${this.checkpoint}&limit=1000`,
      this.token ? { "x-blob-token": this.token } : undefined
    );
    if (!resp.ok) {
      logger.error("sync_pull_failed", { status: resp.status });
      this.history.push({
        at: nowTs(),
        event: "pull_failed",
        detail: { status: resp.status },
      });
      safeLocalStorageSet(LS_HISTORY, this.history);
      return;
    }
    const json = (await resp.json()) as {
      items?: Array<{ ts: number; id: string; type: string }>;
    } | null;
    const items = Array.isArray(json?.items) ? json!.items! : [];
    if (items.length > 0) {
      const maxTs = items.reduce(
        (m, i) => (i.ts > m ? i.ts : m),
        this.checkpoint
      );
      this.checkpoint = maxTs;
      safeLocalStorageSet(LS_CP, this.checkpoint);
      this.history.push({
        at: nowTs(),
        event: "pull_ok",
        detail: { count: items.length },
      });
      logger.info("sync_pull_ok", { count: items.length });
      safeLocalStorageSet(LS_HISTORY, this.history);
    }
  }

  async retry(): Promise<void> {
    await new Promise((r) => setTimeout(r, this.backoffMs));
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
  }

  start(): void {
    if (this.timer) return;
    const fn = async () => {
      try {
        await this.flush();
      } catch {
        void 0;
      }
    };
    this.timer = setInterval(fn, this.throttleMs) as unknown as number;
    logger.info("sync_start", { throttleMs: this.throttleMs, batchSize: this.batchSize });
    if (typeof window !== "undefined") {
      const onlineHandler = async () => {
        logger.info("sync_online");
        await this.flush();
      };
      window.addEventListener("online", onlineHandler);
      window.addEventListener("offline", () => {
        this.history.push({ at: nowTs(), event: "offline" });
        logger.warn("sync_offline");
        safeLocalStorageSet(LS_HISTORY, this.history);
      });
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer as unknown as number);
      this.timer = null;
    }
    logger.info("sync_stop");
  }

  getStatus(): SyncStatus {
    const online = typeof navigator !== "undefined" ? !!navigator.onLine : true;
    return {
      online,
      pending: this.queue.length,
      lastCheckpoint: this.checkpoint,
      lastSyncAt: this.history.length
        ? this.history[this.history.length - 1].at
        : undefined,
    };
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  getHistory(): Array<{ at: number; event: string; detail?: unknown }> {
    return this.history.slice(-1000);
  }
}

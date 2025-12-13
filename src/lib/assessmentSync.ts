import { logger } from "./logger";
import { kvGet, kvSet } from "./storage";

export type SheetDoc = {
  id: string;
  subject: string;
  assessmentType: string;
  dateISO: string;
  version: number;
  rows?: Array<Record<string, unknown>>;
  cells?: Array<{ addr: string; r: number; c: number; t?: string; v?: unknown; w?: string; f?: string; z?: string }>;
};

type ChangeType = "upsert" | "delete";
export type Change = {
  id: string;
  type: ChangeType;
  doc?: SheetDoc;
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
  get: (url: string, headers?: Record<string, string>) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  post: (url: string, body: unknown, headers?: Record<string, string>) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
};

function defaultAdapter(): RequestAdapter {
  return {
    async get(url: string, headers?: Record<string, string>) {
      const r = await fetch(url, { headers });
      return { ok: r.ok, status: r.status, json: () => r.json() };
    },
    async post(url: string, body: unknown, headers?: Record<string, string>) {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
      return { ok: r.ok, status: r.status, json: () => r.json() };
    },
  };
}

function nowTs(): number { return Date.now(); }

const LS_QUEUE = "ASSESSREPO::QUEUE";
const LS_CP = "ASSESSREPO::CHECKPOINT";
const LS_HISTORY = "ASSESSREPO::HISTORY";

function safeLocalStorageGet<T>(key: string): T | null {
  return kvGet<T>("local", key.replace(/^ASSESSREPO::/, ""));
}
function safeLocalStorageSet(key: string, value: unknown): void {
  kvSet("local", key.replace(/^ASSESSREPO::/, ""), value);
}

export class AssessmentSync {
  private baseUrl: string;
  private role: string | undefined;
  private adapter: RequestAdapter;
  private throttleMs: number;
  private batchSize: number;
  private queue: Change[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkpoint = 0;
  private history: Array<{ at: number; event: string; detail?: unknown }> = [];

  constructor(options: { baseUrl: string; role?: string; adapter?: RequestAdapter; throttleMs?: number; batchSize?: number }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.role = options.role;
    this.adapter = options.adapter || defaultAdapter();
    this.throttleMs = Math.max(200, options.throttleMs || 1000);
    this.batchSize = Math.max(1, options.batchSize || 50);
    const q = safeLocalStorageGet<Change[]>(LS_QUEUE);
    this.queue = Array.isArray(q) ? q : [];
    const cp = safeLocalStorageGet<number>(LS_CP);
    this.checkpoint = typeof cp === "number" ? cp : 0;
    const hist = safeLocalStorageGet<Array<{ at: number; event: string; detail?: unknown }>>(LS_HISTORY);
    this.history = Array.isArray(hist) ? hist : [];
  }

  queueUpsert(doc: SheetDoc): void {
    const c: Change = { id: doc.id, type: "upsert", doc, version: doc.version, clientId: "client", timestamp: nowTs() };
    this.queue.push(c);
    safeLocalStorageSet(LS_QUEUE, this.queue);
    this.history.push({ at: nowTs(), event: "queue_upsert", detail: { id: doc.id } });
    safeLocalStorageSet(LS_HISTORY, this.history);
  }

  queueDelete(id: string, version: number): void {
    const c: Change = { id, type: "delete", version, clientId: "client", timestamp: nowTs() };
    this.queue.push(c);
    safeLocalStorageSet(LS_QUEUE, this.queue);
    this.history.push({ at: nowTs(), event: "queue_delete", detail: { id } });
    safeLocalStorageSet(LS_HISTORY, this.history);
  }

  async pushBatch(changes: Change[]): Promise<{ results: Array<{ id: string; status: string }> }> {
    const hdrs: Record<string, string> = {};
    if (this.role) hdrs["x-role"] = this.role;
    const r = await this.adapter.post(`${this.baseUrl}/assessrepo/push`, { changes }, hdrs);
    if (!r.ok) throw new Error(`push failed: ${r.status}`);
    const data = (await r.json()) as { results: Array<{ id: string; status: string }> };
    return data;
  }

  async flush(): Promise<SyncStatus> {
    const pending = this.queue.slice(0, this.batchSize);
    const remainder = this.queue.slice(this.batchSize);
    if (!pending.length) return this.getStatus();
    try {
      const res = await this.pushBatch(pending);
      const nextQueue: Change[] = [];
      for (let i = 0; i < pending.length; i++) {
        const local = pending[i];
        const rr = res.results[i] || { id: local.id, status: "skipped" };
        if (rr.status === "ok") continue;
        nextQueue.push(local);
      }
      this.queue = nextQueue.concat(remainder);
      safeLocalStorageSet(LS_QUEUE, this.queue);
      this.history.push({ at: nowTs(), event: "push_ok", detail: { count: pending.length } });
      safeLocalStorageSet(LS_HISTORY, this.history);
      await this.pull();
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.error("assessrepo_push_failed", msg);
      this.history.push({ at: nowTs(), event: "push_failed", detail: msg });
      safeLocalStorageSet(LS_HISTORY, this.history);
    }
    return this.getStatus();
  }

  async pull(): Promise<void> {
    const hdrs: Record<string, string> = {};
    if (this.role) hdrs["x-role"] = this.role;
    const r = await this.adapter.get(`${this.baseUrl}/assessrepo/pull?since=${encodeURIComponent(String(this.checkpoint))}`, hdrs);
    if (!r.ok) throw new Error(`pull failed: ${r.status}`);
    const data = (await r.json()) as { items: Array<{ updatedAt: number }> };
    const latest = data.items.reduce((m, it) => Math.max(m, it.updatedAt || 0), this.checkpoint);
    if (latest > this.checkpoint) {
      this.checkpoint = latest;
      safeLocalStorageSet(LS_CP, this.checkpoint);
      this.history.push({ at: nowTs(), event: "pull_ok", detail: { items: data.items.length } });
      safeLocalStorageSet(LS_HISTORY, this.history);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.throttleMs);
    logger.info("assessrepo_sync_start");
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info("assessrepo_sync_stop");
  }

  getStatus(): SyncStatus {
    const online = typeof navigator !== "undefined" ? !!navigator.onLine : true;
    return { online, pending: this.queue.length, lastCheckpoint: this.checkpoint, lastSyncAt: this.history.length ? this.history[this.history.length - 1].at : undefined };
  }

  getHistory(): Array<{ at: number; event: string; detail?: unknown }> { return this.history.slice(-1000); }
}

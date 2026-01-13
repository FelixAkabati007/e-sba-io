import { offlineDb, type OfflineStudent, type SyncChange } from "./offlineDb";
import { logger } from "./logger";

type Adapter = {
  get: (path: string) => Promise<Response>;
  post: (path: string, body: unknown) => Promise<Response>;
};

type SyncOptions = {
  baseUrl: string;
  clientId: string;
  adapter?: Adapter;
  throttleMs?: number;
  batchSize?: number;
};

type PullItem = {
  id: string;
  type: "upsert" | "delete";
  ts: number;
  url?: string;
};

export class SyncClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly adapter: Adapter;
  private readonly throttleMs: number;
  private readonly batchSize: number;
  private syncing = false;

  constructor(opts: SyncOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.clientId = opts.clientId;
    this.throttleMs = opts.throttleMs ?? 2000;
    this.batchSize = opts.batchSize ?? 50;
    this.adapter =
      opts.adapter ??
      ({
        get: async (path: string) => {
          return fetch(`${this.baseUrl}${path}`, {
            headers: this.authHeader(),
          });
        },
        post: async (path: string, body: unknown) => {
          return fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...this.authHeader(),
            },
            body: JSON.stringify(body),
          });
        },
      } as Adapter);
  }

  private authHeader(): Record<string, string> {
    try {
      const token =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("token") || undefined
          : undefined;
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  async queueUpsertStudent(doc: OfflineStudent): Promise<void> {
    const ts = Date.now();
    const change: SyncChange = {
      id: doc.id,
      type: "upsert",
      doc,
      version: doc.version,
      clientId: this.clientId,
      timestamp: ts,
    };
    await offlineDb.queueChange(change);
    await offlineDb.putStudent(doc);
  }

  async queueDeleteStudent(id: string): Promise<void> {
    const ts = Date.now();
    const change: SyncChange = {
      id,
      type: "delete",
      version: 0,
      clientId: this.clientId,
      timestamp: ts,
    };
    await offlineDb.queueChange(change);
  }

  async pullOnce(): Promise<void> {
    const since = (await offlineDb.getMeta<number>("checkpoint")) || 0;
    const resp = await this.adapter.get(
      `/sync/pull?since=${since}&limit=${this.batchSize}`
    );
    if (!resp.ok) {
      logger.warn("sync_pull_failed", { status: resp.status });
      return;
    }
    const data = (await resp.json()) as { items?: PullItem[] };
    const items = data.items || [];
    if (!items.length) return;

    let maxTs = since;
    for (const it of items) {
      maxTs = Math.max(maxTs, it.ts || since);
      if (it.type === "delete") {
        // Future: remove from offline store if needed
        continue;
      }
      if (!it.url) continue;
      const docResp = await this.adapter.get(it.url.replace(/^\/api/, ""));
      if (!docResp.ok) continue;
      const doc = (await docResp.json()) as OfflineStudent;
      await offlineDb.putStudent(doc);
    }
    await offlineDb.setMeta("checkpoint", maxTs);
  }

  async pushOnce(): Promise<void> {
    const pending = await offlineDb.getQueuedChanges(this.batchSize);
    if (!pending.length) return;
    const body = { changes: pending };
    const resp = await this.adapter.post("/sync/push", body);
    if (!resp.ok) {
      logger.warn("sync_push_failed", { status: resp.status });
      return;
    }
    const res = (await resp.json()) as {
      results?: Array<{ id: string; status: string }>;
      checkpoint?: number;
    };
    const succeededTs = pending
      .filter((_, idx) => res.results?.[idx]?.status === "ok")
      .map((c) => c.timestamp);
    if (succeededTs.length) {
      await offlineDb.deleteQueuedChanges(succeededTs);
    }
    if (typeof res.checkpoint === "number") {
      await offlineDb.setMeta("checkpoint", res.checkpoint);
    }
  }

  async syncNow(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.pushOnce();
      await this.pullOnce();
    } finally {
      this.syncing = false;
    }
  }
}


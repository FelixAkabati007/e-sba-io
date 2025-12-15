import { logger } from "./logger";
import { kvGet } from "./storage";
import type {
  UploadAssessmentQuery,
  UploadAssessmentResponse,
  SubjectSheetQuery,
  SubjectSheetResponse,
  ApiError,
} from "./apiTypes";

type HttpMethod = "GET" | "POST";

function baseUrl(): string {
  const env =
    (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const v = (env as Record<string, string>)["VITE_API_BASE"] || "/api";
  return v.replace(/\/$/, "");
}

function authHeader(): Record<string, string> {
  try {
    const token = kvGet<string>("local", "API_AUTH_TOKEN") || undefined;
    const up = kvGet<string>("local", "UPLOAD_TOKEN") || undefined;
    const down = kvGet<string>("local", "DOWNLOAD_TOKEN") || undefined;
    const hdrs: Record<string, string> = {};
    if (token) hdrs.Authorization = `Bearer ${token}`;
    if (up) hdrs["x-upload-token"] = up;
    if (down) hdrs["x-download-token"] = down;
    return hdrs;
  } catch {
    return {};
  }
}

async function request<T>(
  path: string,
  method: HttpMethod,
  body?: unknown,
  headers?: Record<string, string>,
  retries = 2
): Promise<T> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const hdrs = {
    "content-type": body ? "application/json" : undefined,
    ...authHeader(),
    ...(headers || {}),
  } as Record<string, string>;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method,
        headers: hdrs,
        body: body ? JSON.stringify(body) : undefined,
      });
      const ct = resp.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      const data = isJson
        ? ((await resp.json()) as unknown)
        : ((await resp.text()) as unknown);
      if (!resp.ok) {
        const err =
          (isJson ? (data as ApiError)?.error : String(data)) ||
          `HTTP ${resp.status}`;
        throw new Error(err);
      }
      return data as T;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.warn("api_request_retry", { path, attempt, msg });
      if (attempt === retries) throw e;
      await new Promise((r) =>
        setTimeout(r, Math.min(1000 * (attempt + 1), 3000))
      );
    }
  }
  throw new Error("Request failed");
}

async function uploadFile<T>(
  path: string,
  file: File,
  query: Record<string, string>,
  headers?: Record<string, string>,
  retries = 1
): Promise<T> {
  const qs = Object.keys(query)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}?${qs}`;
  const fd = new FormData();
  fd.append("file", file);
  const hdrs = { ...authHeader(), ...(headers || {}) } as Record<
    string,
    string
  >;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: hdrs,
        body: fd,
      });
      const ct = resp.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      const data = isJson
        ? ((await resp.json()) as unknown)
        : ((await resp.text()) as unknown);
      if (!resp.ok) {
        const err =
          (isJson ? (data as ApiError)?.error : String(data)) ||
          `HTTP ${resp.status}`;
        throw new Error(err);
      }
      return data as T;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      logger.warn("api_upload_retry", { path, attempt, msg });
      if (attempt === retries) throw e;
      await new Promise((r) =>
        setTimeout(r, Math.min(1000 * (attempt + 1), 3000))
      );
    }
  }
  throw new Error("Upload failed");
}

export const apiClient = {
  async getSubjectSheet(q: SubjectSheetQuery): Promise<SubjectSheetResponse> {
    return request<SubjectSheetResponse>(
      `/assessments/sheet?subject=${encodeURIComponent(
        q.subject
      )}&class=${encodeURIComponent(q.class)}&academicYear=${encodeURIComponent(
        q.academicYear
      )}&term=${encodeURIComponent(q.term)}`,
      "GET"
    );
  },
  async uploadAssessments(
    file: File,
    q: UploadAssessmentQuery
  ): Promise<UploadAssessmentResponse> {
    return uploadFile<UploadAssessmentResponse>(
      "/assessments/upload",
      file,
      q as Record<string, string>
    );
  },
  async getTalentRemarks(): Promise<{
    groups: Array<{ group: string; options: string[] }>;
  }> {
    return request("/meta/talent-remarks", "GET");
  },
  async adminClean(confirm = "yes"): Promise<unknown> {
    return request(
      `/admin/clean-master-db?confirm=${encodeURIComponent(confirm)}`,
      "POST"
    );
  },
  async listAssessmentRepo(
    q: {
      subject?: string;
      assessmentType?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    role?: string
  ): Promise<{ items: unknown[] }> {
    const qs = new URLSearchParams();
    if (q.subject) qs.set("subject", q.subject);
    if (q.assessmentType) qs.set("assessmentType", q.assessmentType);
    if (q.dateFrom) qs.set("dateFrom", q.dateFrom);
    if (q.dateTo) qs.set("dateTo", q.dateTo);
    const hdrs = role ? { "x-role": role } : undefined;
    const r = await fetch(`${baseUrl()}/assessrepo/index?${qs.toString()}`, {
      headers: hdrs,
    });
    const json = await r.json();
    return json as { items: unknown[] };
  },
  async pushAssessmentRepo(
    changes: unknown[],
    role?: string
  ): Promise<{ results: unknown[] }> {
    const hdrs: Record<string, string> = { "Content-Type": "application/json" };
    if (role) hdrs["x-role"] = role;
    const r = await fetch(`${baseUrl()}/assessrepo/push`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ changes }),
    });
    const json = await r.json();
    return json as { results: unknown[] };
  },
};

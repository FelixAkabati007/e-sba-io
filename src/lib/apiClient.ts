import { logger } from "./logger";
import type {
  UploadAssessmentQuery,
  UploadAssessmentResponse,
  SubjectSheetQuery,
  SubjectSheetResponse,
  ApiError,
} from "./apiTypes";

type HttpMethod = "GET" | "POST" | "DELETE";

type Gender = "Male" | "Female" | "Other";

export type StudentRecord = {
  id: string;
  surname: string;
  firstName: string;
  middleName: string;
  gender: Gender;
  dob: string;
  guardianContact: string;
  class: string;
  status: "Active" | "Withdrawn" | "Inactive";
};

function baseUrl(): string {
  const env =
    (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const v = (env as Record<string, string>)["VITE_API_BASE"] || "/api";
  return v.replace(/\/$/, "");
}

function authHeader(): Record<string, string> {
  try {
    const token =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("API_AUTH_TOKEN") ||
          localStorage.getItem("token") ||
          undefined
        : undefined;
    const up =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("UPLOAD_TOKEN") || undefined
        : undefined;
    const down =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("DOWNLOAD_TOKEN") || undefined
        : undefined;
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
      `/assessments?subject=${encodeURIComponent(
        q.subject
      )}&class=${encodeURIComponent(q.class)}&year=${encodeURIComponent(
        q.academicYear
      )}&term=${encodeURIComponent(q.term)}`,
      "GET"
    );
  },
  async getStudents(): Promise<StudentRecord[]> {
    return request<StudentRecord[]>("/students", "GET");
  },
  async upsertStudent(student: StudentRecord): Promise<void> {
    await request("/students", "POST", student);
  },
  async deleteStudent(id: string): Promise<void> {
    await request(`/students/${id}`, "DELETE");
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
  async request<T = unknown>(
    path: string,
    method: HttpMethod,
    body?: unknown
  ): Promise<T> {
    return request<T>(path, method, body);
  },
};

export const api = {
  get(path: string, options?: RequestInit) {
    const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
    return fetch(url, options);
  },
};

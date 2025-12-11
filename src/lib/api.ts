import { logger } from "./logger";

const tokenKey = "BLOB_RW_TOKEN";

function getToken(): string | undefined {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(tokenKey) || undefined
      : undefined;
  } catch {
    return undefined;
  }
}

async function getJSON(
  url: string,
  headers?: Record<string, string>
): Promise<unknown> {
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    logger.error("api_get_failed", { url, status: resp.status });
    throw new Error(`GET ${url} failed`);
  }
  return await resp.json();
}

export async function listStudents(
  baseUrl: string
): Promise<{ items: Array<{ id: string; url?: string }> }> {
  const token = getToken();
  const hdrs = token ? { "x-blob-token": token } : undefined;
  const json = (await getJSON(
    `${baseUrl.replace(/\/$/, "")}/blobdb/students`,
    hdrs
  )) as { items: Array<{ id: string; url?: string }> };
  logger.info("api_list_students_ok", { count: json.items?.length || 0 });
  return json;
}

export async function getStudent(
  baseUrl: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const token = getToken();
  const hdrs = token ? { "x-blob-token": token } : undefined;
  try {
    const json = (await getJSON(
      `${baseUrl.replace(/\/$/, "")}/blobdb/students/${id}`,
      hdrs
    )) as Record<string, unknown>;
    logger.info("api_get_student_ok", { id });
    return json;
  } catch {
    logger.warn("api_get_student_not_found", { id });
    return null;
  }
}

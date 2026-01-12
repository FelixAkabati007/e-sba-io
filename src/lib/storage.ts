export function kvGet<T>(scope: "local", key: string): T | null {
  void scope;
  try {
    const v =
      typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function kvSet<T>(scope: "local", key: string, value: T): void {
  void scope;
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function kvRemove(scope: "local", key: string): void {
  void scope;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    return;
  }
}

export async function saveUploadedFile(
  base: unknown,
  file: File,
  tags: string[],
  meta?: unknown
): Promise<{ id: string }> {
  void base;
  void file;
  void tags;
  void meta;
  return { id: crypto.randomUUID() };
}

export async function saveDownloadedContent(
  base: unknown,
  content: string,
  type: string,
  tags: string[],
  meta?: unknown,
  persist?: boolean,
  name?: string
): Promise<{ id: string }> {
  void base;
  void content;
  void type;
  void tags;
  void meta;
  void persist;
  void name;
  return { id: crypto.randomUUID() };
}

export async function list(_q: { tag?: string }): Promise<
  Array<{
    id: string;
    name?: string;
    size?: number;
    type?: string;
    timestamp: number;
    tags?: string[];
  }>
> {
  return [];
}

export async function getUsage(): Promise<{
  lsBytes: number;
  usage?: number;
  quota?: number;
}> {
  return { lsBytes: 0, usage: 0, quota: 0 };
}

export async function getData(id: string): Promise<null | {
  meta: { id: string; name?: string; size?: number; type?: string };
  data: string | ArrayBuffer;
}> {
  void id;
  return null;
}

export async function remove(id: string): Promise<void> {
  void id;
}

export async function cleanup(_opts: {
  predicate: (m: { tags?: string[] }) => boolean;
}): Promise<void> {
  return;
}

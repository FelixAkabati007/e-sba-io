type Level = "debug" | "info" | "warn" | "error";

const log = (level: Level, message: string, meta?: unknown) => {
  const payload = { level, message, meta };
  console[level]("[E-SBA]", payload);
};

export const logger = {
  debug: (m: string, meta?: unknown) => log("debug", m, meta),
  info: (m: string, meta?: unknown) => log("info", m, meta),
  warn: (m: string, meta?: unknown) => log("warn", m, meta),
  error: (m: string, meta?: unknown) => log("error", m, meta),
};

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | undefined;

function init(): SupabaseClient | undefined {
  if (!url || !anon) {
    logger.error("supabase_env_missing", { url: !!url, anon: !!anon });
    return undefined;
  }
  try {
    client =
      client ||
      createClient(url, anon, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    return client;
  } catch (e) {
    logger.error("supabase_init_failed", e);
    return undefined;
  }
}

export const supabase = init();

export function getSupabase(): SupabaseClient {
  const c = init();
  if (!c) throw new Error("Supabase not configured");
  return c;
}

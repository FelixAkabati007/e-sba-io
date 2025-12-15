import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

(() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [process.cwd(), path.resolve(here, "..", "..")];
  const files = [".env", ".env.development", ".env.local"];
  for (const r of roots) {
    for (const f of files) {
      const p = path.join(r, f);
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: true });
      }
    }
  }
})();

const url = process.env.SUPABASE_URL as string | undefined;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;

export const supabaseAdmin = url && key ? createClient(url, key) : undefined;

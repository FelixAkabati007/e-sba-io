import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL as string | undefined;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;

export const supabaseAdmin = url && key ? createClient(url, key) : undefined;


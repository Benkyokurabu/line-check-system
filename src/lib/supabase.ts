import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env";

export function createSupabaseAdminClient() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = getServerEnv();

  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

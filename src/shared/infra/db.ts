import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

export interface SupabaseConfig {
  url: string;
  key: string;
}

export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.key, { realtime: { transport: ws as any } });
}

function getConfigFromEnv(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY environment variables are required");
  }
  return { url, key };
}

let client: SupabaseClient | undefined;

export function getDb(): SupabaseClient {
  if (!client) {
    client = createSupabaseClient(getConfigFromEnv());
  }
  return client;
}

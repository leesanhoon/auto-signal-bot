import { createClient } from "@supabase/supabase-js";
import ws from "ws";

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY environment variables are required");
  }
  return { url, key };
}

let client: ReturnType<typeof createClient> | undefined;

export function getDb() {
  if (!client) {
    const { url, key } = getConfig();
    client = createClient(url, key, { realtime: { transport: ws as any } });
  }
  return client;
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requirePublicSetting(name: string, value: string | undefined): string {
  const setting = value?.trim();

  if (!setting) {
    throw new Error(`Missing required public Supabase configuration: ${name}`);
  }

  return setting;
}

export function createSupabaseClient(): SupabaseClient {
  const url = requirePublicSetting("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
  const publishableKey = requirePublicSetting(
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );

  return createClient(url, publishableKey);
}

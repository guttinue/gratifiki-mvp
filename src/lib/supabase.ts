import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateRuntimeConfig } from './runtimeConfig';

export function createSupabaseClient(): SupabaseClient {
  const { url, publishableKey } = validateRuntimeConfig({
    mode: import.meta.env.VITE_RUNTIME_MODE ?? 'local',
    url: import.meta.env.VITE_SUPABASE_URL ?? '',
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
    allowedDemoHosts: (import.meta.env.VITE_ALLOWED_DEMO_HOSTS ?? '').split(',').map((host: string) => host.trim()).filter(Boolean),
  });
  return createClient(url, publishableKey);
}

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { isDemoMode } from "@/demo/isDemo";

const demo = isDemoMode();

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? (demo ? "http://localhost:54321" : undefined);

const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (demo ? "demo-anon-key" : undefined);

/**
 * In demo mode, we allow the app to run without Supabase configured.
 * In non-demo mode, these env vars are required.
 */
export const isSupabaseConfigured = Boolean(!demo && supabaseUrl && supabaseAnonKey);

if (!demo && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local (or set VITE_DEMO_MODE=true)."
  );
}

export const supabase = createClient<Database>(supabaseUrl!, supabaseAnonKey!);

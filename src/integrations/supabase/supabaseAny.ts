import { supabase } from "@/integrations/supabase/client";

/**
 * Use this when your generated Database types are out of date,
 * or when writing to tables that aren't in src/integrations/supabase/types.ts yet.
 */
export const supabaseAny = supabase as any;

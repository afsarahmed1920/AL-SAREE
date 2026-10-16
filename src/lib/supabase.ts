import { createClient } from "@supabase/supabase-js"
import { supabaseAnonKey, supabaseUrl } from "./config"

export const supabase = createClient(
  supabaseUrl || "https://missing-project.supabase.co",
  supabaseAnonKey || "missing-supabase-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

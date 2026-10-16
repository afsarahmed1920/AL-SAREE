const env = import.meta.env

export const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? ""
export const supabaseAnonKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? env.VITE_SUPABASE_ANON_KEY?.trim() ?? ""
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

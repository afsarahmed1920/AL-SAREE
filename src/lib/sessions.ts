import { supabaseAnonKey, supabaseUrl } from "./config"
import { supabase } from "./supabase"

export type ActiveSession = {
  session_id: string
  user_agent: string | null
  ip: string | null
  created_at: string
  last_activity: string
  is_current: boolean
}

const endpoint = `${supabaseUrl}/functions/v1/make-server-8a5f868b/sessions`

async function request<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error("NO_SESSION")
  const response = await fetch(`${endpoint}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseAnonKey, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({})) as { error?: string; sessions?: ActiveSession[]; valid?: boolean; count?: number }
  if (path === "check" && (response.status === 401 || response.status === 403)) return { valid: false } as T
  if (!response.ok) throw new Error(result.error ?? "SESSION_REQUEST_FAILED")
  return result as T
}

export const listSessions = (userId?: string) => request<{ sessions: ActiveSession[] }>("list", userId ? { user_id: userId } : {}).then((result) => result.sessions)
export const revokeSession = (userId: string, sessionId: string) => request<{ revoked: boolean }>("revoke", { user_id: userId, session_id: sessionId })
export const revokeAllSessions = (userId: string, exceptCurrent = false) => request<{ count: number }>("revoke-all", { user_id: userId, except_current: exceptCurrent })
export const validateCurrentSession = (sessionId: string) => request<{ valid: boolean }>("check", { session_id: sessionId })

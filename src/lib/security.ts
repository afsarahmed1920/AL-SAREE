import { clearUserCatalogs } from "./catalog-cache"
import { clearUserQueue } from "./offline-queue"
import { validateCurrentSession } from "./sessions"
import { supabase } from "./supabase"

function currentSessionId(token: string) {
  try {
    const segment = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const payload = JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, "="))) as { session_id?: string }
    return payload.session_id ?? ""
  } catch { return "" }
}

export async function wipeRevokedUserData(userId: string) {
  await Promise.allSettled([clearUserCatalogs(userId), clearUserQueue(userId)])
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index)
    if (key === `products-ctx:${userId}` || key === `al-saree-session-start:${userId}` || key?.startsWith("stock-count:")) localStorage.removeItem(key)
  }
  sessionStorage.removeItem("locked")
  localStorage.setItem("al-saree-session-revoked", "1")
  await supabase.auth.signOut({ scope: "local" })
}

export async function checkCurrentSession() {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) return false
  const sessionId = currentSessionId(session.access_token)
  if (!sessionId) return null
  try {
    const result = await validateCurrentSession(sessionId)
    if (!result.valid) {
      await wipeRevokedUserData(session.user.id)
      window.dispatchEvent(new Event("session-revoked"))
      return false
    }
    return true
  } catch {
    return null
  }
}

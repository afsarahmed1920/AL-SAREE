import { supabaseAnonKey, supabaseUrl } from "./config"
import { supabase } from "./supabase"

const base = `${supabaseUrl}/functions/v1/make-server-8a5f868b/passkey`

async function call<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token ?? supabaseAnonKey}`,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json as T
}

export const passkeySupported = () =>
  typeof window !== "undefined" && window.isSecureContext && "PublicKeyCredential" in window

type RegOptions = Parameters<typeof import("@simplewebauthn/browser").startRegistration>[0]["optionsJSON"]
type AuthOptions = Parameters<typeof import("@simplewebauthn/browser").startAuthentication>[0]["optionsJSON"]

export async function registerPasskey() {
  const { startRegistration } = await import("@simplewebauthn/browser")
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error("NO_SESSION")
  const optionsJSON = await call<RegOptions>("register/options", {}, token)
  const response = await startRegistration({ optionsJSON })
  await call("register/verify", { response, label: navigator.userAgent.slice(0, 80) }, token)
  localStorage.setItem("passkey-registered", "1")
}

/** Signs in with a discoverable passkey and returns the username. */
export async function signInWithPasskey() {
  const { startAuthentication } = await import("@simplewebauthn/browser")
  const optionsJSON = await call<AuthOptions>("login/options", {})
  const response = await startAuthentication({ optionsJSON })
  const { token_hash } = await call<{ token_hash: string }>("login/verify", { response })
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" })
  if (error) throw error
  localStorage.setItem("passkey-registered", "1")
  return (data.user?.email ?? "").split("@")[0]
}

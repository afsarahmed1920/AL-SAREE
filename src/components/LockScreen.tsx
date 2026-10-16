import { useState, type FormEvent } from "react"
import { useApp } from "../lib/app-context"
import { passkeySupported, signInWithPasskey } from "../lib/passkey"
import { supabase } from "../lib/supabase"
import Icon from "./Icon"
import Logo from "./Logo"
import { toAuthEmail } from "./Login"

export default function LockScreen({ user, onUnlock, onLogout }: { user: string; onUnlock: () => void; onLogout: () => void }) {
  const { t } = useApp()
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const hasPasskey = passkeySupported() && localStorage.getItem("passkey-registered") === "1"

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    const { error } = await supabase.auth.signInWithPassword({ email: toAuthEmail(user), password })
    setBusy(false)
    if (error) setError(t("badLogin"))
    else onUnlock()
  }

  const passkey = async () => {
    setError("")
    try {
      const name = await signInWithPasskey()
      if (name === user) onUnlock()
      else onLogout()
    } catch (err) {
      if ((err as Error)?.name !== "NotAllowedError") setError(`${t("passkeyFailed")}: ${(err as Error).message}`)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="lock-title" className="lock-in fixed inset-0 z-[100] grid place-items-center bg-app/70 p-6 backdrop-blur-2xl">
      <form onSubmit={submit} className="glass-strong w-full max-w-sm rounded-[2rem] p-7 text-center">
        <Logo className="mx-auto size-14 rounded-2xl" />
        <h2 id="lock-title" className="mt-4 font-display text-xl font-semibold text-ink">{t("locked")}</h2>
        <p className="mt-1 text-sm text-ink2">{t("lockedSub")}</p>
        <p className="mt-4 text-sm font-semibold text-ink" dir="ltr">@{user}</p>
        {hasPasskey && (
          <button type="button" onClick={() => void passkey()} className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand font-semibold text-on-brand">
            <Icon name="eye" className="size-5" /> {t("unlockPasskey")}
          </button>
        )}
        <input type="password" autoFocus={!hasPasskey} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("password")} aria-label={t("password")}
          className="mt-4 h-12 w-full rounded-2xl border border-line2 bg-surface px-4 text-ink outline-none focus:border-focus focus:ring-2 focus:ring-focus/20" />
        {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button disabled={busy || !password} className={`mt-3 h-12 w-full rounded-2xl font-semibold disabled:opacity-50 ${hasPasskey ? "border border-line2 bg-surface text-ink" : "bg-brand text-on-brand"}`}>
          {busy ? t("syncing") : t("unlock")}
        </button>
        <button type="button" onClick={onLogout} className="mt-4 text-sm text-ink2 hover:text-ink">{t("signOut")}</button>
      </form>
    </div>
  )
}

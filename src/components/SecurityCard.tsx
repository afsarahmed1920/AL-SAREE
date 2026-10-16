import { useState } from "react"
import { useApp } from "../lib/app-context"
import { feedbackEnabled, scanFeedback } from "../lib/feedback"
import { passkeySupported, registerPasskey } from "../lib/passkey"
import Icon from "./Icon"

export const lockMinutes = () => Number(localStorage.getItem("auto-lock-min") ?? "5")

export default function SecurityCard() {
  const { t } = useApp()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [mins, setMins] = useState(lockMinutes())
  const [fb, setFb] = useState(feedbackEnabled())
  const supported = passkeySupported()

  const add = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await registerPasskey()
      setMsg({ ok: true, text: t("passkeyAdded") })
    } catch (err) {
      if ((err as Error)?.name !== "NotAllowedError") setMsg({ ok: false, text: `${t("passkeyFailed")}: ${(err as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold text-ink">{t("passkeys")}</h2>
      <p className="mt-1 text-sm text-ink2">{t("passkeySub")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void add()} disabled={busy || !supported}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-on-brand disabled:opacity-50">
          <Icon name="plus" className="size-5" /> {t("addPasskey")}
        </button>
        {!supported && <span className="text-sm text-ink2">{t("passkeyUnsupported")}</span>}
      </div>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}

      <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-ink2">
          {t("autoLock")}
          <select value={mins}
            onChange={(e) => {
              const v = Number(e.target.value)
              setMins(v)
              localStorage.setItem("auto-lock-min", String(v))
              window.dispatchEvent(new Event("auto-lock-change"))
            }}
            className="h-11 rounded-xl border border-line2 bg-surface px-3 text-ink">
            {[1, 2, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} {t("minutes")}</option>)}
            <option value={0}>{t("never")}</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end rounded-xl border border-line2 px-4 py-3 text-sm font-medium text-ink">
          <input type="checkbox" checked={fb} className="size-4"
            onChange={(e) => {
              setFb(e.target.checked)
              localStorage.setItem("scan-feedback", e.target.checked ? "on" : "off")
              if (e.target.checked) scanFeedback()
            }} />
          {t("scanFeedback")}
        </label>
      </div>
    </section>
  )
}

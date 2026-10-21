import { useCallback, useEffect, useState } from "react"
import { useApp } from "../lib/app-context"
import { feedbackEnabled, scanFeedback } from "../lib/feedback"
import { listPasskeys, passkeySupported, registerPasskey, removePasskey, type RegisteredPasskey } from "../lib/passkey"
import Icon from "./Icon"
import { useFeedback } from "./FeedbackProvider"

export const lockMinutes = () => Number(localStorage.getItem("auto-lock-min") ?? "5")

function displayPasskeyName(name: string | null, fallback: string) {
  if (!name) return fallback
  if (!/mozilla\/|applewebkit|chrome\/|safari\//i.test(name)) return name
  const platform = /android/i.test(name) ? "Android"
    : /iphone|ipad|ipod/i.test(name) ? "iPhone or iPad"
      : /macintosh|mac os/i.test(name) ? "Mac"
        : /windows/i.test(name) ? "Windows PC"
          : /linux/i.test(name) ? "Linux device"
            : "device"
  const browser = /edg\//i.test(name) ? "Edge"
    : /firefox\//i.test(name) ? "Firefox"
      : /chrome\//i.test(name) ? "Chrome"
        : /safari\//i.test(name) ? "Safari"
          : "Browser"
  return `${browser} on ${platform}`
}

export default function SecurityCard() {
  const { t, lang } = useApp()
  const { confirm, toast } = useFeedback()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingPasskeys, setLoadingPasskeys] = useState(true)
  const [passkeys, setPasskeys] = useState<RegisteredPasskey[]>([])
  const [mins, setMins] = useState(lockMinutes())
  const [fb, setFb] = useState(feedbackEnabled())
  const supported = passkeySupported()

  const refreshPasskeys = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys())
    } catch {
      setMsg({ ok: false, text: t("passkeyListFailed") })
    } finally {
      setLoadingPasskeys(false)
    }
  }, [t])

  useEffect(() => {
    void refreshPasskeys()
  }, [refreshPasskeys])

  const add = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await registerPasskey()
      setMsg({ ok: true, text: t("passkeyAdded") })
      await refreshPasskeys()
    } catch (err) {
      if ((err as Error)?.name !== "NotAllowedError") {
        setMsg({ ok: false, text: t("passkeyFailed") })
        toast("error", t("passkeyFailed"))
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (passkey: RegisteredPasskey) => {
    if (!await confirm({ title: t("removePasskey"), message: t("removePasskeyConfirm"), confirmLabel: t("removePasskey") })) return
    setBusy(true)
    setMsg(null)
    try {
      await removePasskey(passkey.id)
      setPasskeys((current) => current.filter((item) => item.id !== passkey.id))
      setMsg({ ok: true, text: t("passkeyRemoved") })
      toast("success", t("passkeyRemoved"))
    } catch {
      setMsg({ ok: false, text: t("passkeyRemoveFailed") })
      toast("error", t("passkeyRemoveFailed"))
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
      <div className="mt-4 grid gap-2" aria-live="polite">
        {loadingPasskeys ? (
          <p className="text-sm text-ink2">{t("loadingPasskeys")}</p>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-ink2">{t("noPasskeys")}</p>
        ) : passkeys.map((passkey) => (
          <div key={passkey.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line2 px-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Icon name="key" className="size-5 text-brand" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{displayPasskeyName(passkey.device_name, t("unknownDevice"))}</p>
                {passkey.created_at && (
                  <p className="mt-0.5 text-xs text-ink2">
                    {t("passkeyAddedOn")} {new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(new Date(passkey.created_at))}
                  </p>
                )}
              </div>
            </div>
            <button type="button" onClick={() => void remove(passkey)} disabled={busy}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line2 px-3 text-sm font-medium text-red-600 transition hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400">
              <Icon name="trash" className="size-4" /> {t("removePasskey")}
            </button>
          </div>
        ))}
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

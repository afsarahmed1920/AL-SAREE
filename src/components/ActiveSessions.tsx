import { useCallback, useEffect, useState } from "react"
import { useApp } from "../lib/app-context"
import { listSessions, revokeAllSessions, revokeSession, type ActiveSession } from "../lib/sessions"
import { wipeRevokedUserData } from "../lib/security"
import { useFeedback } from "./FeedbackProvider"
import Icon from "./Icon"

function parseDevice(agent: string | null, fallback: string) {
  const ua = agent ?? ""
  const platform = /android/i.test(ua) ? "Android"
    : /iphone|ipad|ipod/i.test(ua) ? "iPhone or iPad"
      : /macintosh|mac os/i.test(ua) ? "Mac"
        : /windows/i.test(ua) ? "Windows"
          : /linux/i.test(ua) ? "Linux"
            : ""
  const browser = /edg\//i.test(ua) ? "Edge"
    : /firefox\//i.test(ua) ? "Firefox"
      : /chrome\//i.test(ua) ? "Chrome"
        : /safari\//i.test(ua) ? "Safari"
          : "Browser"
  return { name: platform ? `${browser} on ${platform}` : (agent ? browser : fallback), mobile: /android|iphone|ipad|ipod/i.test(ua) }
}

export default function ActiveSessions({ userId, userName, managed = false }: { userId: string; userName?: string; managed?: boolean }) {
  const { t, lang } = useApp()
  const { toast, confirm } = useFeedback()
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const date = (value: string) => new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try { setSessions(await listSessions(managed ? userId : undefined)) }
    catch { setError(true); toast("error", t("sessionListFailed")) }
    finally { setLoading(false) }
  }, [managed, userId, toast, t])
  useEffect(() => { void load() }, [load])

  const remove = async (session: ActiveSession) => {
    const device = parseDevice(session.user_agent, t("deviceUnknown"))
    const message = t(managed ? "revokeManagedDeviceMessage" : "revokeDeviceMessage")
      .replace("{account}", userName ?? t("myAccount")).replace("{device}", device.name)
    const accepted = await confirm({ title: t("revokeDeviceTitle"), message, confirmLabel: t("revokeSession") })
    if (!accepted) return
    setBusy(true)
    try {
      await revokeSession(userId, session.session_id)
      if (!managed && session.is_current) {
        await wipeRevokedUserData(userId)
        window.location.assign("/login")
        return
      }
      toast("success", t("sessionRevoked"))
      await load()
    } catch { toast("error", t("sessionRevokeFailed")) }
    finally { setBusy(false) }
  }

  const removeOthers = async () => {
    const accepted = await confirm({ title: t("revokeOtherDevicesTitle"), message: t("revokeOtherDevicesMessage"), confirmLabel: t("signOutOtherDevices") })
    if (!accepted) return
    setBusy(true)
    try {
      await revokeAllSessions(userId, true)
      toast("success", t("sessionsRevoked"))
      await load()
    } catch { toast("error", t("sessionRevokeFailed")) }
    finally { setBusy(false) }
  }

  const removeAll = async () => {
    const accepted = await confirm({ title: t("revokeAllDevicesTitle"), message: t("revokeAllDevicesMessage").replace("{user}", userName ?? ""), confirmLabel: t("signOutAllDevices") })
    if (!accepted) return
    setBusy(true)
    try {
      await revokeAllSessions(userId, false)
      if (!managed) {
        await wipeRevokedUserData(userId)
        window.location.assign("/login")
        return
      }
      toast("success", t("allUserSessionsRevoked"))
      await load()
    } catch { toast("error", t("sessionRevokeFailed")) }
    finally { setBusy(false) }
  }

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-lg font-semibold text-ink">{managed ? t("sessionAccount") : t("devicesSessions")}</h2><p className="mt-1 text-sm text-ink2">{t("sessionsPrivacyNote")}</p></div>
        <button type="button" onClick={() => void load()} disabled={loading || busy} aria-label={t("refresh")} className="grid size-10 place-items-center rounded-xl border border-line2 text-ink2 hover:bg-surface2 disabled:opacity-50"><Icon name="history" className="size-5" /></button>
      </div>
      {!managed && <button type="button" disabled={busy || loading || sessions.filter((item) => !item.is_current).length === 0} onClick={() => void removeOthers()} className="mt-4 h-11 rounded-xl border border-line2 px-4 text-sm font-semibold text-ink disabled:opacity-50">{t("signOutOtherDevices")}</button>}
      {managed && <button type="button" disabled={busy || loading || sessions.length === 0} onClick={() => void removeAll()} className="mt-4 h-11 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400">{t("signOutAllDevices")}</button>}
      <div className="mt-4 space-y-2" aria-live="polite">
        {loading ? <p className="rounded-xl bg-app p-4 text-sm text-ink2">{t("loadingSessions")}</p>
          : error ? <button type="button" onClick={() => void load()} className="rounded-xl bg-red-500/10 p-4 text-start text-sm text-red-700 dark:text-red-300">{t("sessionListFailed")} · {t("retry")}</button>
            : !sessions.length ? <p className="rounded-xl bg-app p-4 text-sm text-ink2">{t("noActiveSessions")}</p>
              : sessions.map((session) => {
                const device = parseDevice(session.user_agent, t("deviceUnknown"))
                return <article key={session.session_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line2 p-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Icon name={device.mobile ? "phone" : "cog"} className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{device.name}</p>{session.is_current && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">{t("currentDevice")}</span>}</div>
                    <p className="mt-1 text-xs text-ink2">{t("lastActivity")}: {date(session.last_activity)}</p>
                    {session.ip && <p className="text-xs text-ink2" dir="ltr">IP: {session.ip}</p>}
                  </div>
                  <button type="button" onClick={() => void remove(session)} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"><Icon name="out" className="size-4" />{t("revokeSession")}</button>
                </article>
              })}
      </div>
    </section>
  )
}

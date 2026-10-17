import SecurityCard from "./SecurityCard"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useApp } from "../lib/app-context"
import { loadContext, type BranchRow, type Profile } from "../lib/products"
import {
  defaultSettings,
  refreshSettings,
  removeLogo,
  saveSettings,
  uploadLogo,
  useSettings,
  type AppSettings,
} from "../lib/settings"
import { supabase } from "../lib/supabase"
import Icon from "./Icon"
import Logo from "./Logo"

const suggestedCategories = [
  { en: "Sunglasses", ar: "نظارات شمسية" },
  { en: "Wallets", ar: "محافظ" },
  { en: "Pens", ar: "أقلام" },
  { en: "Cufflinks", ar: "أزرار أكمام" },
  { en: "Rings", ar: "خواتم" },
  { en: "Gift Items", ar: "هدايا" },
  { en: "Cosmetics", ar: "مستحضرات تجميل" },
  { en: "Ladies Purses", ar: "شنط نسائية" },
  { en: "Leather Wallets", ar: "محافظ جلد" },
  { en: "Mabkhara", ar: "مباخر" },
  { en: "Flasks", ar: "فلاسك" },
  { en: "Toys", ar: "ألعاب" },
  { en: "Glass Showpieces", ar: "تحف زجاجية" },
  { en: "Digital Tasbih", ar: "مسبحة رقمية" },
  { en: "Crown Tasbih", ar: "مسبحة كراون" },
]

const input =
  "h-11 w-full rounded-xl border border-line2 bg-app px-3.5 text-ink outline-none focus:border-focus focus:ring-2 focus:ring-focus/20 disabled:opacity-60"
const area =
  "min-h-32 w-full rounded-xl border border-line2 bg-app px-3.5 py-3 text-ink outline-none focus:border-focus focus:ring-2 focus:ring-focus/20"
const card = "rounded-2xl border border-line bg-surface p-5 sm:p-6"
const btn =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line2 bg-surface px-4 text-sm font-medium text-ink hover:bg-surface2 disabled:opacity-50"

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium text-ink2">{label}{children}</label>
}

type SessionLimitUser = { id: string; username: string; full_name: string; session_duration_minutes: number }

function SessionLimitsCard() {
  const { t } = useApp()
  const [users, setUsers] = useState<SessionLimitUser[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  const load = async () => {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id,username,full_name,session_duration_minutes")
      .order("username")
    if (error) throw error
    const rows = (data ?? []) as SessionLimitUser[]
    setUsers(rows)
    setDrafts(Object.fromEntries(rows.map((user) => [user.id, String(user.session_duration_minutes ?? 1440)])))
  }

  useEffect(() => {
    void load().catch(() => setMessage({ text: t("couldNotLoadUsers"), error: true }))
  }, [t])

  const save = async (user: SessionLimitUser) => {
    const minutes = Number(drafts[user.id])
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
      setMessage({ text: t("sessionLimitRange"), error: true })
      return
    }
    setBusy(user.id)
    setMessage(null)
    try {
      const { data, error } = await supabase
        .from("user_profiles")
        .update({ session_duration_minutes: minutes })
        .eq("id", user.id)
        .select("id")
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error("SESSION_LIMIT_DENIED")
      setUsers((current) => current.map((row) => row.id === user.id ? { ...row, session_duration_minutes: minutes } : row))
      window.dispatchEvent(new Event("session-limit-change"))
      setMessage({ text: t("sessionLimitSaved"), error: false })
    } catch {
      setMessage({ text: t("couldNotSaveSessionLimit"), error: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={card}>
      <h2 className="font-display text-lg font-semibold text-ink">{t("sessionLimits")}</h2>
      <p className="mt-1 text-sm text-ink2">{t("sessionLimitsSub")}</p>
      <p className="mt-2 text-xs text-ink2">{t("sessionLocalOnly")}</p>
      <div className="mt-4 divide-y divide-line rounded-xl border border-line">
        {users.map((user) => (
          <div key={user.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{user.full_name || user.username}</p>
              <p className="truncate text-xs text-ink2" dir="ltr">@{user.username}</p>
            </div>
            <label className="grid gap-1 text-xs font-medium text-ink2">
              {t("sessionMinutes")}
              <input
                type="number"
                min={5}
                max={1440}
                step={1}
                inputMode="numeric"
                value={drafts[user.id] ?? "1440"}
                onChange={(event) => setDrafts((current) => ({ ...current, [user.id]: event.target.value }))}
                className={input}
              />
            </label>
            <button type="button" disabled={busy !== null} onClick={() => void save(user)} className={btn}>
              {busy === user.id ? t("saving") : t("saveSessionLimit")}
            </button>
          </div>
        ))}
        {!users.length && <p className="p-4 text-sm text-ink2">{t("syncing")}</p>}
      </div>
      {message && <p role={message.error ? "alert" : "status"} className={`mt-3 text-sm ${message.error ? "text-red-600" : "text-emerald-600"}`}>{message.text}</p>}
    </section>
  )
}

export default function Settings() {
  const { t } = useApp()
  const stored = useSettings()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [form, setForm] = useState<AppSettings>(stored)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshSettings().then(() => undefined)
    loadContext()
      .then((c) => {
        setProfile(c.profile)
        setBranches(c.branches)
      })
      .catch(() => setMsg({ ok: false, text: t("loadFailed") }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => setForm(stored), [stored])

  if (profile && profile.role !== "master") {
    return <div className="mx-auto max-w-3xl space-y-5"><SecurityCard /><div className="rounded-2xl border border-line p-10 text-center text-ink2">{t("masterOnly")}</div></div>
  }

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setAddress = (code: string, lang: "en" | "ar", v: string) =>
    set("branch_addresses", {
      ...form.branch_addresses,
      [code]: { en: form.branch_addresses[code]?.en ?? "", ar: form.branch_addresses[code]?.ar ?? "", [lang]: v },
    })

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      const error = e as { message?: string; code?: string }
      const internal = `${error?.message ?? ""} ${error?.code ?? ""}`
      const isAccess = error?.code === "42501" || error?.message === "SETTINGS_PERMISSION_DENIED" || /row-level security|permission denied/i.test(internal)
      setMsg({ ok: false, text: isAccess ? t("masterOnly") : t("settingsSaveFailed") })
    } finally {
      setBusy(false)
    }
  }

  const onLogo = (file?: File) => {
    if (!file) return
    void run(async () => {
      const url = await uploadLogo(file)
      const next = { ...form, logo_url: url }
      await saveSettings(next)
      setMsg({ ok: true, text: t("settingsSaved") })
    })
  }

  const onRemoveLogo = () =>
    void run(async () => {
      await removeLogo()
      await saveSettings({ ...form, logo_url: null })
      setMsg({ ok: true, text: t("settingsSaved") })
    })

  const addSuggested = () =>
    void run(async () => {
      const { data: existing, error: readError } = await supabase.from("categories").select("name_en")
      if (readError) throw readError
      const have = new Set((existing ?? []).map((c) => String(c.name_en).toLowerCase()))
      const missing = suggestedCategories.filter((c) => !have.has(c.en.toLowerCase()))
      if (missing.length) {
        const { error } = await supabase.from("categories").insert(missing.map((c) => ({ name_en: c.en, name_ar: c.ar })))
        if (error) throw error
      }
      setMsg({ ok: true, text: `${t("categoriesAdded")} (${missing.length})` })
    })

  const save = () =>
    void run(async () => {
      await saveSettings(form)
      setMsg({ ok: true, text: t("settingsSaved") })
    })

  const numbers = form.contact_numbers.length ? form.contact_numbers : [""]

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{t("settings")}</h1>
        <p className="mt-1 text-sm text-ink2">{t("settingsSub")}</p>
      </div>

      <SecurityCard />

      {profile?.role === "master" && <SessionLimitsCard />}

      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-red-500/30 bg-red-500/10 text-red-500"}`}>
          {msg.text}
        </div>
      )}

      <section className={card}>
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">{t("companyInfo")}</h2>
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <Logo className="size-20 rounded-2xl border border-line text-2xl" />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={btn}>
                <Icon name="upload" className="size-4" /> {form.logo_url ? t("replaceLogo") : t("uploadLogo")}
              </button>
              {form.logo_url && (
                <button type="button" disabled={busy} onClick={onRemoveLogo} className={`${btn} text-red-500`}>
                  <Icon name="trash" className="size-4" /> {t("removeLogo")}
                </button>
              )}
            </div>
            <p className="text-xs text-ink2">{t("logoHint")}</p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onLogo(e.target.files?.[0]); e.target.value = "" }} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("companyNameEn")}>
            <input className={input} value={form.company_name_en} onChange={(e) => set("company_name_en", e.target.value)} />
          </Field>
          <Field label={t("companyNameAr")}>
            <input className={input} dir="rtl" value={form.company_name_ar} onChange={(e) => set("company_name_ar", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">{t("contactNumbers")}</h2>
        <div className="space-y-2">
          {numbers.map((n, i) => (
            <div key={i} className="flex gap-2">
              <input className={input} dir="ltr" inputMode="tel" value={n} placeholder="+966 ..."
                onChange={(e) => set("contact_numbers", numbers.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" aria-label={t("remove")} onClick={() => set("contact_numbers", numbers.filter((_, j) => j !== i))}
                className="grid size-11 shrink-0 place-items-center rounded-xl border border-line2 text-ink2 hover:bg-surface2">
                <Icon name="trash" className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set("contact_numbers", [...numbers, ""])} className={`${btn} mt-3`}>
          <Icon name="plus" className="size-4" /> {t("addNumber")}
        </button>
      </section>

      <section className={card}>
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">{t("branchAddresses")}</h2>
        <div className="space-y-5">
          {branches.map((b) => (
            <div key={b.id} className="grid gap-3 sm:grid-cols-2">
              <div className="text-sm font-semibold text-ink sm:col-span-2">{b.name_en} · <span dir="ltr">{b.code}</span></div>
              <Field label={t("addressEn")}>
                <input className={input} value={form.branch_addresses[b.code]?.en ?? ""} onChange={(e) => setAddress(b.code, "en", e.target.value)} />
              </Field>
              <Field label={t("addressAr")}>
                <input className={input} dir="rtl" value={form.branch_addresses[b.code]?.ar ?? ""} onChange={(e) => setAddress(b.code, "ar", e.target.value)} />
              </Field>
            </div>
          ))}
        </div>
      </section>

      {([["privacy", "privacyPolicy"], ["terms", "termsRules"]] as const).map(([k, title]) => (
        <section key={k} className={card}>
          <h2 className="mb-4 font-display text-lg font-semibold text-ink">{t(title)}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("textEn")}>
              <textarea className={area} value={form[`${k}_en`]} onChange={(e) => set(`${k}_en`, e.target.value)} />
            </Field>
            <Field label={t("textAr")}>
              <textarea className={area} dir="rtl" value={form[`${k}_ar`]} onChange={(e) => set(`${k}_ar`, e.target.value)} />
            </Field>
          </div>
        </section>
      ))}

      <section className={card}>
        <h2 className="font-display text-lg font-semibold text-ink">{t("suggestedCategories")}</h2>
        <p className="mb-4 mt-1 text-sm text-ink2">{t("suggestedCategoriesSub")}</p>
        <button type="button" disabled={busy} onClick={addSuggested} className={btn}>
          <Icon name="plus" className="size-4" /> {t("addSuggested")}
        </button>
      </section>

      <div className="sticky bottom-24 flex justify-end gap-2 lg:bottom-4">
        <button type="button" disabled={busy} onClick={() => setForm(defaultSettings)} className={`${btn} bg-app`}>{t("resetDefaults")}</button>
        <button type="button" disabled={busy} onClick={save}
          className="inline-flex h-11 items-center rounded-xl bg-brand px-6 text-sm font-semibold text-on-brand shadow-lg disabled:opacity-50">
          {busy ? t("saving") : t("saveSettings")}
        </button>
      </div>
    </div>
  )
}

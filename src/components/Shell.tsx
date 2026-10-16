import { useEffect, useRef, useState, type ReactNode } from "react"
import { useApp, type Key } from "../lib/app-context"
import Logo, { useCompanyName } from "./Logo"
import Icon, { type IconName } from "./Icon"
import Toggles from "./Toggles"

export type Page = "dashboard" | "scan" | "count" | "products" | "users" | "history" | "backup" | "settings"

const nav: { id: Page; icon: IconName; label: Key }[] = [
  { id: "dashboard", icon: "home", label: "dashboard" },
  { id: "scan", icon: "scan", label: "scanBarcode" },
  { id: "count", icon: "tag", label: "stockCount" },
  { id: "products", icon: "box", label: "products" },
  { id: "users", icon: "users", label: "users" },
  { id: "history", icon: "history", label: "history" },
  { id: "backup", icon: "swap", label: "backup" },
  { id: "settings", icon: "cog", label: "settings" },
]

function SyncBadge() {
  const { t } = useApp()
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(true)
  useEffect(() => {
    const on = () => { setOnline(true); setSyncing(true); setTimeout(() => setSyncing(false), 1200) }
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    const id = setTimeout(() => setSyncing(false), 1200)
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearTimeout(id) }
  }, [])
  const s = !online ? { l: t("offline"), c: "bg-red-500" } : syncing ? { l: t("syncing"), c: "bg-accent animate-pulse" } : { l: t("synced"), c: "bg-emerald-500" }
  return (
    <span className="glass inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm text-ink">
      <span className="relative flex size-2"><span className={`absolute inset-0 rounded-full opacity-60 ${online && !syncing ? "animate-ping" : ""} ${s.c}`} /><span className={`relative size-2 rounded-full ${s.c}`} /></span>
      <span className="hidden sm:inline">{s.l}</span>
    </span>
  )
}

export default function Shell({ page, setPage, branchId, setBranchId, branchList, onLogout, children }: {
  branchList: { code: string; name_en: string; name_ar: string }[]
  page: Page
  setPage: (p: Page) => void
  branchId: string
  setBranchId: (b: string) => void
  onLogout: () => void
  children: ReactNode
}) {
  const { t, lang } = useApp()
  const companyName = useCompanyName()

  const isMore = ["settings", "users", "backup", "count"].includes(page)

  // Pull-to-refresh: remounting the page re-runs its sync effects.
  const [refreshKey, setRefreshKey] = useState(0)
  const [pull, setPull] = useState(0)
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  useEffect(() => {
    const THRESHOLD = 72
    const down = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      startY.current = window.scrollY <= 0 && !target.closest("[role=dialog], #barcode-reader, #count-reader") ? e.touches[0].clientY : null
    }
    const move = (e: TouchEvent) => {
      if (startY.current === null) return
      const d = e.touches[0].clientY - startY.current
      pullRef.current = d > 0 ? Math.min(110, d * 0.5) : 0
      setPull(pullRef.current)
    }
    const up = () => {
      if (pullRef.current >= THRESHOLD * 0.75 && navigator.onLine) setRefreshKey((k) => k + 1)
      startY.current = null
      pullRef.current = 0
      setPull(0)
    }
    window.addEventListener("touchstart", down, { passive: true })
    window.addEventListener("touchmove", move, { passive: true })
    window.addEventListener("touchend", up)
    return () => {
      window.removeEventListener("touchstart", down)
      window.removeEventListener("touchmove", move)
      window.removeEventListener("touchend", up)
    }
  }, [])
  const ready = pull >= 54

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-app lg:ps-72">
      <div aria-hidden className="app-ambient pointer-events-none fixed inset-0 -z-0" />

      <aside className="fixed inset-y-3 start-3 z-40 hidden flex-col rounded-[1.75rem] glass-strong lg:flex" style={{ width: "16.5rem" }}>
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <div className="rounded-2xl bg-gradient-to-br from-accent/60 to-brand/60 p-[2px] shadow-lg shadow-brand/20">
            <Logo className="size-10 rounded-[14px]" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-[15px] font-semibold leading-tight text-ink">{companyName}</div>
            <div className="text-[10px] font-medium tracking-[0.25em] text-accent">AL-SAREE</div>
          </div>
        </div>
        <div className="mx-5 mb-3 h-px bg-gradient-to-r from-transparent via-line2 to-transparent" />
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((n) => {
            const active = page === n.id
            return (
              <button key={n.id} onClick={() => setPage(n.id)} aria-current={active ? "page" : undefined}
                className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-all duration-300 ${active ? "text-white shadow-lg shadow-brand/30" : "text-ink2 hover:bg-surface2/60 hover:text-ink"}`}>
                {active && <span className="nav-pill absolute inset-0 bg-gradient-to-r from-[#1e3a8a] to-[#3b5bdb]" />}
                <span className={`relative grid size-8 place-items-center rounded-xl transition ${active ? "bg-white/15" : "bg-surface2/70 group-hover:scale-105"}`}>
                  <Icon name={n.icon} active={active} className="size-[16px]" />
                </span>
                <span className="relative">{t(n.label)}</span>
                {active && <span className="relative ms-auto size-1.5 rounded-full bg-accent shadow-[0_0_10px_2px_rgba(255,138,0,.7)]" />}
              </button>
            )
          })}
        </nav>
        <div className="m-3 rounded-2xl border border-line/60 bg-surface2/40 p-1">
          <button onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink2 transition hover:bg-red-500/10 hover:text-red-500">
            <Icon name="out" className="size-[18px] rtl:-scale-x-100" /> {t("signOut")}
          </button>
        </div>
      </aside>

      <header className="safe-top safe-x sticky top-0 z-30 px-3 lg:px-6">
        <div className="glass-strong flex h-14 items-center justify-between gap-3 rounded-2xl px-3 lg:h-16 lg:px-4">
          <div className="flex items-center gap-3">
            <Logo className="size-9 rounded-xl lg:hidden" />
            <label className="sr-only" htmlFor="branch">{t("branch")}</label>
            <div className="relative">
              <Icon name="home" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-brand" />
              <select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}
                className="h-9 max-w-[9.5rem] cursor-pointer truncate min-[400px]:max-w-[11rem] appearance-none rounded-full border border-line2/70 bg-surface/60 pe-4 ps-8 text-sm font-semibold text-ink outline-none transition hover:border-brand/50 focus:ring-2 focus:ring-brand/20 sm:max-w-none">
                {branchList.map((b) => <option key={b.code} value={b.code}>{lang === "en" ? b.name_en : b.name_ar}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SyncBadge />
            <Toggles />
            <button onClick={onLogout} aria-label={t("signOut")} className="glass grid size-9 place-items-center rounded-full text-ink lg:hidden">
              <Icon name="out" className="size-4 rtl:-scale-x-100" />
            </button>
          </div>
        </div>
      </header>

      <div aria-hidden={pull === 0} className="pointer-events-none fixed inset-x-0 top-20 z-30 flex justify-center lg:hidden"
        style={{ opacity: Math.min(1, pull / 54), transform: `translateY(${pull - 40}px)`, transition: pull ? "none" : "all 250ms ease" }}>
        <span className="glass-strong inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-ink">
          <span className={`size-4 rounded-full border-2 border-brand/30 border-t-brand ${ready ? "motion-safe:animate-spin" : ""}`} style={{ transform: ready ? undefined : `rotate(${pull * 4}deg)` }} />
          {ready ? t("releaseRefresh") : t("pullRefresh")}
        </span>
      </div>

      <main key={`${page}-${refreshKey}`} className="dock-content page-enter safe-x relative min-w-0 p-4 lg:p-8">
        {isMore && (
          <div className="mx-auto mb-4 flex max-w-md items-center gap-1 rounded-2xl border border-line/80 bg-surface/80 p-1 shadow-sm backdrop-blur-xl lg:hidden">
            {([
              { id: "settings" as const, icon: "cog" as const, label: "settings" as const },
              { id: "users" as const, icon: "users" as const, label: "users" as const },
              { id: "backup" as const, icon: "swap" as const, label: "backup" as const },
              { id: "count" as const, icon: "tag" as const, label: "stockCount" as const },
            ]).map((m) => {
              const active = page === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => setPage(m.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all duration-200 ${
                    active
                      ? "bg-brand text-white shadow-sm shadow-brand/25"
                      : "text-ink2 hover:text-ink"
                  }`}
                >
                  <Icon name={m.icon} active={active} className="size-3.5" />
                  <span className="truncate">{t(m.label)}</span>
                </button>
              )
            })}
          </div>
        )}
        {children}
      </main>

      <nav
        aria-label="Primary"
        className="mobile-dock fixed inset-x-3 z-40 mx-auto grid h-20 max-w-md grid-cols-5 items-center rounded-full px-2 lg:hidden"
      >
        {(["dashboard", "products", "scan", "history", "settings"] as const).map((id) => {
          if (id === "scan") {
            const scanActive = page === "scan"
            return (
              <div key={id} className="flex items-center justify-center">
                <button
                  onClick={() => setPage("scan")}
                  aria-label={t("scanBarcode")}
                  aria-current={scanActive ? "page" : undefined}
                  className="dock-tab dock-scan group relative flex h-16 w-full flex-col items-center justify-center gap-1 rounded-3xl text-ink"
                >
                  <span className="dock-scan-tile grid size-11 place-items-center rounded-2xl bg-accent text-ink shadow-lg shadow-accent/25">
                    <Icon name="scan" active={scanActive} className="size-7 text-ink dark:text-app" />
                  </span>
                  <span className="text-xs font-semibold leading-none">{lang === "en" ? "Scan" : "مسح"}</span>
                </button>
              </div>
            )
          }
          const active = id === "settings" ? isMore : page === id
          const icon: IconName = id === "dashboard" ? "home" : id === "products" ? "box" : id === "history" ? "history" : "cog"
          const label = id === "history" ? (lang === "en" ? "Activity" : "النشاط") : id === "dashboard" ? (lang === "en" ? "Home" : "الرئيسية") : id === "settings" ? t("more") : t(id)
          return (
            <button key={id} onClick={() => setPage(id)} aria-current={active ? "page" : undefined}
              className={`dock-tab group relative flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-3xl ${
                active
                  ? "text-brand"
                  : "text-ink2 hover:text-ink"
              }`}>
              {active && (
                <span aria-hidden="true" className="dock-selection absolute inset-0.5 rounded-3xl bg-brand/10 ring-1 ring-brand/10" />
              )}
              <span className="dock-tab-icon relative flex items-center justify-center">
                <Icon name={icon} active={active} className="size-7" />
              </span>
              <span className={`relative max-w-full truncate px-0.5 text-xs leading-none ${active ? "font-semibold" : "font-medium"}`}>
                {label}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

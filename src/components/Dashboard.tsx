import React, { useEffect, useMemo, useState } from "react"
import { useApp, type Key } from "../lib/app-context"
import { getCachedCatalog, syncBranchCatalog, type CatalogProduct } from "../lib/catalog-cache"
import { listAudit, type AuditRow } from "../lib/users"
import Icon, { type IconName } from "./Icon"
import InstallCard from "./InstallCard"
import Skeleton, { SkeletonBlock } from "./Skeleton"

const LOW_STOCK = 5
const actionLabel: Record<string, Key> = {
  product_created: "actProductCreated",
  product_updated: "actProductUpdated",
  branch_product_created: "actBranchCreated",
  price_or_stock_changed: "actPriceChanged",
}

export default function Dashboard({ branchCode, branchName, user, onScan }: { branchCode: string; branchName: { en: string; ar: string }; user: string; onScan: () => void }) {
  const { t, lang, sar } = useApp()
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [recent, setRecent] = useState<{ row: AuditRow; code?: string }[]>([])
  const [loadedBranch, setLoadedBranch] = useState("")
  const [recentLoading, setRecentLoading] = useState(true)
  const [catalogIssue, setCatalogIssue] = useState(false)
  const [activityIssue, setActivityIssue] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    setProducts([])
    void (async () => {
      try {
        const cached = await getCachedCatalog(branchCode).catch(() => null)
        if (alive && cached) {
          setProducts(cached.products.filter((product) => !product.setup_incomplete))
          setLoadedBranch(branchCode)
        }
        const fresh = await syncBranchCatalog(branchCode)
        if (alive) { setProducts(fresh.products.filter((product) => !product.setup_incomplete)); setCatalogIssue(false) }
      } catch {
        if (alive) setCatalogIssue(true)
      } finally {
        if (alive) setLoadedBranch(branchCode)
      }
    })()
    return () => { alive = false }
  }, [branchCode, retry])

  useEffect(() => {
    let alive = true
    listAudit(6)
      .then(({ rows, products: found }) => {
        if (alive) { setRecent(rows.map((row) => ({ row, code: row.entity_id ? found.get(row.entity_id)?.code : undefined }))); setActivityIssue(false) }
      })
      .catch(() => { if (alive) setActivityIssue(true) })
      .finally(() => { if (alive) setRecentLoading(false) })
    return () => { alive = false }
  }, [retry])

  const d = useMemo(() => {
    const cats = new Map<string, { en: string; ar: string; n: number }>()
    let retailValue = 0
    for (const p of products) {
      const key = p.category_id ?? "none"
      const c = cats.get(key) ?? { en: p.category_name_en ?? "Uncategorized", ar: p.category_name_ar ?? "بدون فئة", n: 0 }
      c.n++
      cats.set(key, c)
      if (p.retail_price && p.track_stock && p.stock_quantity) retailValue += p.retail_price * p.stock_quantity
    }
    return {
      total: products.length,
      low: products.filter((p) => p.track_stock && (p.stock_quantity ?? 0) <= LOW_STOCK),
      noBarcode: products.filter((p) => !p.barcodes?.length).length,
      noImage: products.filter((p) => !p.images?.length).length,
      retailValue,
      hasRetail: products.some((p) => p.retail_price !== undefined),
      categories: [...cats.values()].sort((a, b) => b.n - a.n).slice(0, 6),
    }
  }, [products])

  const max = Math.max(1, ...d.categories.map((c) => c.n))
  const num = (n: number) => n.toLocaleString("en-US")

  const stats: { label: string; value: string; icon: IconName; warn?: boolean }[] = [
    { label: t("totalProducts"), value: num(d.total), icon: "box" },
    { label: t("lowStock"), value: String(d.low.length), icon: "alert", warn: true },
    { label: t("noBarcode"), value: String(d.noBarcode), icon: "tag" },
    { label: t("noImage"), value: String(d.noImage), icon: "image" },
  ]

  const hour = new Date().getHours()
  const greet = lang === "en"
    ? hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    : hour < 12 ? "صباح الخير" : "مساء الخير"
  const tones = [
    "from-[#3b82f6]/25 to-[#1e3a8a]/5 text-brand",
    "from-[#ff8a00]/30 to-[#ff8a00]/5 text-[#b45309] dark:text-accent",
    "from-[#8b5cf6]/25 to-[#8b5cf6]/5 text-[#6d28d9] dark:text-[#a78bfa]",
    "from-[#10b981]/25 to-[#10b981]/5 text-[#047857] dark:text-[#34d399]",
  ]

  if (loadedBranch !== branchCode) return <Skeleton variant="dashboard" />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {(catalogIssue || activityIssue) && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-amber-400/40 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
            <p>{catalogIssue ? t("dashboardLoadOffline") : t("dashboardAuditUnavailable")}</p>
          </div>
          <button type="button" onClick={() => { setCatalogIssue(false); setActivityIssue(false); setRetry((value) => value + 1) }} className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-amber-700/20 px-3 font-semibold hover:bg-amber-500/10">
            {t("retry")}
          </button>
        </div>
      )}
      <section className="stagger relative overflow-hidden rounded-[2rem] bg-[#0b1224] p-6 text-white shadow-2xl shadow-[#1e3a8a]/20 sm:p-8" style={{ "--i": 0 } as React.CSSProperties}>
        <div aria-hidden className="hero-orb absolute -right-16 -top-24 size-72 rounded-full bg-[#ff8a00]/35 blur-3xl" />
        <div aria-hidden className="hero-orb absolute -bottom-28 left-10 size-72 rounded-full bg-[#3b82f6]/40 blur-3xl" style={{ animationDelay: "-6s" }} />
        <div aria-hidden className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.9) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur-md">
              <span className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_2px_rgba(255,138,0,.6)]" />
              {t("overview")} {lang === "en" ? branchName.en : branchName.ar}
            </div>
            <p className="text-sm text-white/60">{greet},</p>
            <h1 className="font-display break-words text-2xl font-semibold capitalize tracking-tight min-[400px]:text-3xl sm:text-4xl">{user}</h1>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-white/50">{t("retailValue")}</div>
                <div className="mt-0.5 font-display text-2xl font-semibold">{d.hasRetail ? sar(d.retailValue) : "—"}</div>
              </div>
              <div className="w-px bg-white/15" />
              <div>
                <div className="text-xs uppercase tracking-wider text-white/50">{t("totalProducts")}</div>
                <div className="mt-0.5 font-display text-2xl font-semibold"><CountUp to={d.total} /></div>
              </div>
            </div>
          </div>
          <button onClick={onScan} className="group relative inline-flex h-12 items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-[#ffb04d] to-[#ff6a00] w-full justify-center px-6 font-semibold text-[#0d1426] shadow-lg sm:w-auto shadow-[#ff8a00]/30 transition hover:-translate-y-0.5 hover:shadow-xl">
            <span aria-hidden className="absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/40 blur-md transition-all duration-700 group-hover:left-[120%]" />
            <Icon name="scan" className="relative size-5" /> <span className="relative">{t("startScan")}</span>
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.map((s, i) => (
          <div key={s.label} className="stagger premium-card group relative overflow-hidden rounded-3xl p-5" style={{ "--i": i + 1 } as React.CSSProperties}>
            <div aria-hidden className={`absolute -right-8 -top-8 size-28 rounded-full bg-gradient-to-br opacity-60 blur-2xl transition-opacity duration-500 group-hover:opacity-100 ${tones[i]}`} />
            <div className={`relative mb-4 grid size-10 place-items-center rounded-2xl bg-gradient-to-br ring-1 ring-white/10 ${tones[i]}`}>
              <Icon name={s.icon} className="size-[18px]" />
            </div>
            <div className="relative font-display text-3xl font-semibold tracking-tight text-ink"><CountUp to={Number(s.value.replace(/,/g, ""))} /></div>
            <div className="relative mt-1 text-sm text-ink2">{s.label}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="stagger premium-card rounded-3xl p-6" style={{ "--i": 5 } as React.CSSProperties}>
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">{t("categories")}</h2>
            <span className="text-xs text-ink2">{d.categories.length}</span>
          </div>
          <ul className="space-y-4">
            {d.categories.map((c, i) => (
              <li key={c.en}>
                <div className="mb-1.5 flex justify-between text-sm text-ink"><span className="font-medium">{lang === "en" ? c.en : c.ar}</span><span className="tabular-nums text-ink2">{c.n}</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface2/80">
                  <div className="bar-grow h-full rounded-full bg-gradient-to-r from-[#1e3a8a] via-[#3b82f6] to-[#60a5fa] shadow-[0_0_12px_rgba(59,130,246,.45)]" style={{ width: `${(c.n / max) * 100}%`, animationDelay: `${300 + i * 90}ms` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="stagger premium-card rounded-3xl p-6" style={{ "--i": 6 } as React.CSSProperties}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">{t("lowStockItems")}</h2>
            {d.low.length > 0 && <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-[#b45309] dark:text-accent">{d.low.length}</span>}
          </div>
          <ul className="space-y-2">
            {d.low.length === 0 && <li className="py-6 text-center text-sm text-ink2">—</li>}
            {d.low.slice(0, 6).map((i) => (
              <li key={i.product_id} className="flex items-center justify-between gap-3 rounded-2xl border border-transparent px-3 py-2.5 transition hover:border-line hover:bg-surface2/50">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{lang === "en" ? i.name_en : i.name_ar || i.name_en}</div>
                  <div className="text-xs text-ink2" dir="ltr">{i.product_code}</div>
                </div>
                <span className="shrink-0 rounded-full bg-gradient-to-r from-accent/25 to-accent/10 px-2.5 py-1 text-xs font-semibold text-[#b45309] ring-1 ring-accent/20 dark:text-accent">{i.stock_quantity ?? 0} {t("left")}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <InstallCard />

      <section className="stagger premium-card rounded-3xl p-6" style={{ "--i": 7 } as React.CSSProperties}>
        <h2 className="mb-5 font-display text-lg font-semibold text-ink">{t("recent")}</h2>
        <ol className="relative space-y-4 border-s border-line2/70 ps-5">
          {recentLoading && <li role="status" className="space-y-3"><span className="sr-only">{t("syncing")}</span><SkeletonBlock className="h-4 w-2/3" /><SkeletonBlock className="h-4 w-1/2" /></li>}
          {!recentLoading && recent.length === 0 && <li className="text-sm text-ink2">{t("noHistory")}</li>}
          {recent.map(({ row, code }) => (
            <li key={row.id} className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="absolute -start-[25px] top-1.5 size-2.5 rounded-full bg-gradient-to-br from-accent to-brand ring-4 ring-[var(--surface-primary)]" />
              <span className="text-ink">{actionLabel[row.action] ? t(actionLabel[row.action]) : row.action}{code ? <span className="ms-1 rounded-md bg-surface2 px-1.5 py-0.5 text-xs text-ink2" dir="ltr">{code}</span> : ""}</span>
              <span className="shrink-0 text-xs text-ink2">{new Date(row.created_at).toLocaleString(lang === "en" ? "en-GB" : "ar-SA", { dateStyle: "short", timeStyle: "short" })}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function CountUp({ to }: { to: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!Number.isFinite(to)) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(to)
      return
    }
    let raf = 0
    const start = performance.now()
    const from = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 900)
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <>{v.toLocaleString("en-US")}</>
}

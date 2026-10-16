import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useApp } from "../lib/app-context"
import { findCatalogProduct, getCachedCatalog, syncBranchCatalog, type CatalogProduct } from "../lib/catalog-cache"
import { scanFeedback } from "../lib/feedback"
import Icon from "./Icon"
import { SkeletonBlock } from "./Skeleton"

const storageKey = (branch: string) => `stock-count:${branch}`

export default function StockCount({ branchCode }: { branchCode: string }) {
  const { t, lang } = useApp()
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [order, setOrder] = useState<string[]>([])
  const [restored, setRestored] = useState("")
  const [query, setQuery] = useState("")
  const [miss, setMiss] = useState("")
  const [flash, setFlash] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const lastCam = useRef({ code: "", at: 0 })

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(storageKey(branchCode)) ?? "null") as { counts: Record<string, number>; order: string[] } | null
    setCounts(saved?.counts ?? {})
    setOrder(saved?.order ?? [])
    setRestored(branchCode)
    setCatalog(null)
    let active = true
    void (async () => {
      const cached = await getCachedCatalog(branchCode).catch(() => null)
      if (active && cached) setCatalog(cached.products)
      if (!navigator.onLine) {
        if (active && !cached) setCatalog([])
        return
      }
      try {
        const fresh = await syncBranchCatalog(branchCode)
        if (active) setCatalog(fresh.products)
      } catch {
        if (active && !cached) setCatalog([])
      }
    })()
    return () => { active = false }
  }, [branchCode])

  // Persist the session so a count survives reloads, crashes and going offline.
  useEffect(() => {
    if (restored === branchCode) localStorage.setItem(storageKey(branchCode), JSON.stringify({ counts, order }))
  }, [counts, order, branchCode, restored])

  const add = useCallback((raw: string) => {
    if (!catalog) return
    const code = raw.trim()
    const p = findCatalogProduct(catalog, code)
    const exact = p && (p.barcodes.includes(code) || p.product_code.toLowerCase() === code.toLowerCase())
    if (!p || !exact) {
      setMiss(code)
      scanFeedback(false)
      return
    }
    setMiss("")
    scanFeedback(true)
    setCounts((c) => ({ ...c, [p.product_id]: (c[p.product_id] ?? 0) + 1 }))
    setOrder((o) => [p.product_id, ...o.filter((id) => id !== p.product_id)])
    setFlash(p.product_id)
    window.setTimeout(() => setFlash(null), 700)
  }, [catalog])

  const bump = (id: string, delta: number) => {
    setCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }))
    setOrder((o) => (o.includes(id) ? o : [id, ...o]))
  }

  // Hardware (keyboard-wedge) scanners.
  useEffect(() => {
    let buffer = ""
    let last = 0
    const listen = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return
      const now = Date.now()
      if (now - last > 80) buffer = ""
      last = now
      if (e.key === "Enter" && buffer.length >= 3) {
        add(buffer)
        buffer = ""
      } else if (e.key.length === 1) buffer += e.key
    }
    window.addEventListener("keydown", listen)
    return () => window.removeEventListener("keydown", listen)
  }, [add])

  // Continuous camera scanning; the same code is ignored for 1.5s to avoid double counts.
  useEffect(() => {
    if (!camera) return
    let scanner: import("html5-qrcode").Html5Qrcode | null = null
    let disposed = false
    void import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (disposed) return
        scanner = new Html5Qrcode("count-reader")
        return scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 130 } },
          (text) => {
            const now = Date.now()
            if (text === lastCam.current.code && now - lastCam.current.at < 1500) return
            lastCam.current = { code: text, at: now }
            add(text)
          },
          () => undefined,
        )
      })
      .catch(() => setCamera(false))
    return () => {
      disposed = true
      if (scanner?.isScanning) void scanner.stop().finally(() => scanner?.clear())
      else scanner?.clear()
    }
  }, [camera, add])

  const byId = useMemo(() => new Map((catalog ?? []).map((p) => [p.product_id, p])), [catalog])
  const rows = useMemo(() => {
    const ids = [...order]
    if (showAll) {
      for (const p of catalog ?? []) if (p.track_stock && !ids.includes(p.product_id)) ids.push(p.product_id)
    }
    return ids.map((id) => byId.get(id)).filter(Boolean) as CatalogProduct[]
  }, [order, showAll, catalog, byId])

  const summary = useMemo(() => {
    let match = 0, short = 0, over = 0, units = 0
    for (const id of order) {
      const n = counts[id] ?? 0
      units += n
      const diff = n - (byId.get(id)?.stock_quantity ?? 0)
      if (diff === 0) match++
      else if (diff < 0) short++
      else over++
    }
    return { match, short, over, units }
  }, [order, counts, byId])

  const name = (p: CatalogProduct) => (lang === "ar" && p.name_ar ? p.name_ar : p.name_en)

  const exportCsv = () => {
    const lines = [["product_code", "name", "system_stock", "counted", "difference"].join(",")]
    for (const p of rows) {
      const n = counts[p.product_id] ?? 0
      const sys = p.stock_quantity ?? 0
      lines.push([p.product_code, `"${p.name_en.replace(/"/g, '""')}"`, sys, n, n - sys].join(","))
    }
    const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `stock-count-${branchCode}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (query.trim()) add(query)
    setQuery("")
  }

  if (!catalog) {
    return (
      <div role="status" aria-busy="true" className="mx-auto max-w-4xl space-y-4">
        <span className="sr-only">{t("syncing")}</span>
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-24 w-full rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="h-20 rounded-2xl" />)}
        </div>
        <SkeletonBlock className="h-64 w-full rounded-3xl" />
      </div>
    )
  }

  const stat = (label: string, value: number, tone: string) => (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-ink2">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  )

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">{t("stockCount")}</h1>
          <p className="mt-1 text-sm text-ink2">{t("stockCountSub")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={!rows.length} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line2 bg-surface px-4 text-sm font-medium text-ink disabled:opacity-50">
            <Icon name="upload" className="size-4" /> {t("exportCount")}
          </button>
          <button
            onClick={() => {
              if (confirm(t("resetCountConfirm"))) {
                setCounts({})
                setOrder([])
              }
            }}
            disabled={!order.length}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line2 bg-surface px-4 text-sm font-medium text-ink2 hover:text-red-600 disabled:opacity-50">
            <Icon name="trash" className="size-4" /> {t("resetCount")}
          </button>
        </div>
      </div>

      <section className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
        <form onSubmit={submit} className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">{t("scanToCount")}</span>
            <Icon name="scan" className="absolute start-4 top-3.5 size-5 text-ink2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("scanToCount")} dir="ltr"
              className="h-12 w-full rounded-2xl border border-line2 bg-app ps-12 pe-4 text-ink outline-none focus:border-focus focus:ring-2 focus:ring-focus/20" />
          </label>
          <button type="button" onClick={() => setCamera((v) => !v)} aria-pressed={camera} aria-label={t("useCamera")}
            className={`grid size-12 place-items-center rounded-2xl transition ${camera ? "bg-accent text-ink" : "bg-brand text-on-brand"}`}>
            <Icon name={camera ? "x" : "camera"} className="size-5" />
          </button>
        </form>
        {camera && <div id="count-reader" className="mt-3 overflow-hidden rounded-2xl bg-black" />}
        <p className="mt-3 text-xs text-ink2">{t("hardwareHint")}</p>
        {miss && (
          <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
            <Icon name="alert" className="size-4" /> {t("notFound")} <span dir="ltr" className="font-mono">{miss}</span>
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat(t("counted"), summary.units, "text-ink")}
        {stat(t("matched"), summary.match, "text-emerald-600 dark:text-emerald-400")}
        {stat(t("shortage"), summary.short, "text-red-600 dark:text-red-400")}
        {stat(t("excess"), summary.over, "text-accent")}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink2">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="size-4" />
        {t("showUncounted")}
      </label>

      {rows.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line2 bg-surface p-10 text-center text-ink2">{t("countEmpty")}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
          {rows.map((p) => {
            const counted = p.product_id in counts
            const n = counts[p.product_id] ?? 0
            const sys = p.stock_quantity ?? 0
            const diff = n - sys
            const tone = !counted
              ? "bg-surface2 text-ink2"
              : diff === 0
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : diff < 0
                  ? "bg-red-500/15 text-red-700 dark:text-red-300"
                  : "bg-accent/15 text-accent"
            return (
              <li key={p.product_id} className={`flex items-center gap-3 p-3 transition-colors duration-500 sm:p-4 ${flash === p.product_id ? "bg-brand/10" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{name(p)}</p>
                  <p className="mt-0.5 text-xs text-ink2">
                    <span dir="ltr">{p.product_code}</span> · {t("systemStock")}: <span className="tabular-nums">{p.track_stock ? sys : t("notTracked")}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => bump(p.product_id, -1)} aria-label="-1" className="grid size-9 place-items-center rounded-lg border border-line2 text-lg text-ink2 hover:text-ink">−</button>
                  <span className="w-10 text-center font-display text-lg font-semibold tabular-nums text-ink">{n}</span>
                  <button onClick={() => bump(p.product_id, 1)} aria-label="+1" className="grid size-9 place-items-center rounded-lg border border-line2 text-lg text-ink2 hover:text-ink">+</button>
                </div>
                <span className={`w-20 shrink-0 rounded-full px-2 py-1 text-center text-xs font-semibold tabular-nums ${tone}`}>
                  {!counted ? t("notCounted") : diff === 0 ? t("matched") : `${diff > 0 ? "+" : ""}${diff}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

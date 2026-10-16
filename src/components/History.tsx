import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp, type Key } from "../lib/app-context"
import { loadContext, type BranchRow } from "../lib/products"
import { listAudit, listUsers, type AuditRow, type StaffUser } from "../lib/users"
import Icon from "./Icon"
import Skeleton from "./Skeleton"

const PAGE = 100
const actionLabel: Record<string, Key> = {
  product_created: "actProductCreated",
  product_updated: "actProductUpdated",
  branch_product_created: "actBranchCreated",
  price_or_stock_changed: "actPriceChanged",
}
const actionTone: Record<string, string> = {
  product_created: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  branch_product_created: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  product_updated: "bg-surface2 text-ink2",
  price_or_stock_changed: "bg-accent/20 text-ink",
}
const fieldLabel: Record<string, Key> = {
  purchase_price: "purchasePrice",
  wholesale_price: "wholesalePriceSar",
  retail_price: "retailPriceSar",
  stock_quantity: "stockQty",
}

type Change = { field: string; from?: unknown; to?: unknown }

function changesOf(row: AuditRow): Change[] {
  const d = row.details ?? {}
  const before = d.before as Record<string, unknown> | undefined
  const after = (d.after as Record<string, unknown> | undefined) ?? undefined
  if (before && after) {
    return Object.keys(fieldLabel)
      .filter((k) => before[k] !== after[k])
      .map((field) => ({ field, from: before[field], to: after[field] }))
  }
  return Object.keys(fieldLabel)
    .filter((k) => d[k] !== undefined && d[k] !== null)
    .map((field) => ({ field, to: d[field] }))
}

export default function History() {
  const { t, lang, sar } = useApp()
  const [data, setData] = useState<{ rows: AuditRow[]; products: Map<string, { code: string; name: string }> } | null>(null)
  const [users, setUsers] = useState<StaffUser[]>([])
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [master, setMaster] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [action, setAction] = useState("")
  const [userId, setUserId] = useState("")
  const [branchId, setBranchId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [limit, setLimit] = useState(PAGE)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const ctx = await loadContext()
      setBranches(ctx.branches)
      if (ctx.profile.role !== "master") return setMaster(false)
      const [audit, list] = await Promise.all([listAudit(), listUsers()])
      setData(audit)
      setUsers(list)
      setError("")
    } catch (err) {
      setError((err as Error).message === "NO_SESSION" ? t("signInFirst") : `${t("loadFailed")} ${(err as Error).message}`)
    } finally {
      setRefreshing(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.full_name || u.username])), [users])
  const branchName = useMemo(
    () => new Map(branches.map((b) => [b.id, lang === "ar" ? b.name_ar : b.name_en])),
    [branches, lang],
  )

  const rows = useMemo(() => {
    if (!data) return []
    const needle = query.trim().toLowerCase()
    const start = from ? new Date(`${from}T00:00:00`).getTime() : 0
    const end = to ? new Date(`${to}T23:59:59`).getTime() : Infinity
    return data.rows.filter((r) => {
      if (action && r.action !== action) return false
      if (userId && r.user_id !== userId) return false
      if (branchId && r.branch_id !== branchId) return false
      const time = new Date(r.created_at).getTime()
      if (time < start || time > end) return false
      if (!needle) return true
      const product = r.entity_id ? data.products.get(r.entity_id) : undefined
      return [product?.code, product?.name, r.user_id ? userName.get(r.user_id) : ""].some((v) => v?.toLowerCase().includes(needle))
    })
  }, [data, query, action, userId, branchId, from, to, userName])

  useEffect(() => { setLimit(PAGE) }, [query, action, userId, branchId, from, to])

  const groups = useMemo(() => {
    const result = new Map<string, AuditRow[]>()
    for (const row of rows.slice(0, limit)) {
      const date = new Date(row.created_at).toLocaleDateString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      const group = result.get(date) ?? []
      group.push(row)
      result.set(date, group)
    }
    return [...result.entries()]
  }, [rows, limit, lang])

  if (!master) return <p className="mx-auto max-w-3xl rounded-2xl border border-dashed border-line2 p-10 text-center text-ink2">{t("masterOnly")}</p>
  if (error) return <p role="alert" className="mx-auto max-w-3xl rounded-2xl border border-red-300 bg-red-50 p-5 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>
  if (!data) return <Skeleton />

  const field = "h-11 rounded-xl border border-line2 bg-surface px-3 text-sm text-ink"
  const money = (field: string, value: unknown) =>
    value === null || value === undefined ? "—" : field === "stock_quantity" ? String(value) : sar(Number(value))

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">{t("history")}</h1>
          <p className="mt-1 text-sm text-ink2">{t("historySub")} · {rows.length}</p>
        </div>
        <button onClick={() => void load()} disabled={refreshing} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line2 bg-surface px-4 text-sm font-medium text-ink disabled:opacity-50"><Icon name="history" className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`} />{refreshing ? t("syncing") : t("refresh")}</button>
      </div>

      <div className="premium-card grid gap-3 rounded-3xl p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="relative sm:col-span-2 lg:col-span-3">
          <span className="sr-only">{t("search")}</span>
          <Icon name="search" className="absolute start-4 top-3 size-5 text-ink2" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }} placeholder={t("historySearch")} className={`${field} w-full ps-12`} />
        </label>
        <select value={action} onChange={(e) => setAction(e.target.value)} className={field} aria-label={t("action")}>
          <option value="">{t("allActions")}</option>
          {Object.entries(actionLabel).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className={field} aria-label={t("user")}>
          <option value="">{t("allUsers")}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
        </select>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field} aria-label={t("branch")}>
          <option value="">{t("allBranches")}</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{branchName.get(b.id)}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-3">
          <label className="grid gap-1.5 text-xs font-medium text-ink2">
          {t("dateFrom")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} min-w-0 flex-1`} aria-label={t("dateFrom")} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-ink2">
          {t("dateTo")}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${field} min-w-0 flex-1`} aria-label={t("dateTo")} />
          </label>
        </div>
        {(query || action || userId || branchId || from || to) && (
          <button onClick={() => { setQuery(""); setAction(""); setUserId(""); setBranchId(""); setFrom(""); setTo("") }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface2 px-3 text-sm font-medium text-ink sm:col-span-2 lg:col-span-3">
            <Icon name="x" className="size-4" />{lang === "en" ? "Clear filters" : "مسح عوامل التصفية"}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line2 bg-surface p-10 text-center text-ink2">{t("noHistory")}</p>
      ) : (
        <div className="space-y-5" aria-busy={refreshing}>
          {groups.map(([date, entries]) => (
          <section key={date} className="space-y-2">
            <div className="flex items-center justify-between px-1 text-xs font-semibold text-ink2"><span>{date}</span><span className="rounded-full bg-surface2 px-2 py-1 tabular-nums">{entries.length}</span></div>
            <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
          {entries.map((r) => {
            const product = r.entity_id ? data.products.get(r.entity_id) : undefined
            const changes = changesOf(r)
            return (
              <li key={r.id} className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[5rem_1fr_1.4fr] lg:items-start">
                <div className="flex items-center gap-2 text-sm lg:flex-col lg:items-start">
                  <span className={`grid size-8 place-items-center rounded-xl ${actionTone[r.action] ?? "bg-surface2 text-ink2"}`}><Icon name={r.action.includes("created") ? "plus" : r.action === "price_or_stock_changed" ? "swap" : "pencil"} className="size-4" /></span>
                  <time dateTime={r.created_at} className="text-xs font-medium tabular-nums text-ink2" dir="ltr">{new Date(r.created_at).toLocaleTimeString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
                <div className="min-w-0 text-sm">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${actionTone[r.action] ?? "bg-surface2 text-ink2"}`}>
                    {actionLabel[r.action] ? t(actionLabel[r.action]) : r.action}
                  </span>
                  <p className="mt-1.5 truncate font-semibold text-ink">{product ? `${product.name}` : r.entity_type}</p>
                  <p className="truncate text-xs text-ink2">
                    {product && <span dir="ltr">{product.code} · </span>}
                    {r.user_id ? userName.get(r.user_id) ?? "—" : t("system")}
                    {r.branch_id && ` · ${branchName.get(r.branch_id) ?? ""}`}
                  </p>
                </div>
                <div className="space-y-1 text-sm">
                  {changes.map((c) => (
                    <div key={c.field} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-app px-3 py-1.5">
                      <span className="text-ink2">{t(fieldLabel[c.field])}</span>
                      <span className="font-medium text-ink" dir="ltr">
                        {c.from !== undefined && <><span className="text-ink2 line-through">{money(c.field, c.from)}</span> → </>}
                        {money(c.field, c.to)}
                      </span>
                    </div>
                  ))}
                  {changes.length === 0 && r.action === "product_updated" && <p className="text-xs text-ink2">{t("detailsUpdated")}</p>}
                </div>
              </li>
            )
          })}
            </ul>
          </section>
          ))}
        </div>
      )}

      {rows.length > limit && (
        <button onClick={() => setLimit(limit + PAGE)} className="mx-auto block h-11 rounded-xl border border-line2 bg-surface px-6 font-medium text-ink">
          {t("showMore")} ({rows.length - limit})
        </button>
      )}
    </div>
  )
}

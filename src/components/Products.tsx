import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "../lib/app-context"
import { getCachedCatalog, syncBranchCatalog, updateCachedProduct, type CatalogProduct } from "../lib/catalog-cache"
import {
  can,
  loadContext,
  loadDraft,
  newDraft,
  draftFromCache,
  type BranchRow,
  type CategoryRow,
  type Profile,
  type ProductDraft,
} from "../lib/products"
import Icon from "./Icon"
import ProductForm from "./ProductForm"
import StickerModal, { type StickerProduct } from "./StickerModal"
import Skeleton from "./Skeleton"
import { listQueue, onQueueChange } from "../lib/offline-queue"
import { supabase } from "../lib/supabase"

type Ctx = { profile: Profile; branches: BranchRow[]; categories: CategoryRow[] }
type Filter = "all" | "noBarcode" | "noImage" | "lowStock"
const PAGE = 60

export default function Products({ branchCode }: { branchCode: string }) {
  const { t, lang, sar } = useApp()
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [error, setError] = useState("")
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [loadedBranch, setLoadedBranch] = useState("")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [limit, setLimit] = useState(PAGE)
  const [form, setForm] = useState<{ draft: ProductDraft; original: ProductDraft | null } | null>(null)
  const [sticker, setSticker] = useState<StickerProduct | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const online = navigator.onLine
  const [pending, setPending] = useState(0)
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    const read = () => void listQueue().then((q) => setPending(q.length)).catch(() => undefined)
    read()
    return onQueueChange(read)
  }, [])

  const refreshContext = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession()
    const userId = auth.session?.user.id
    if (!userId) {
      setCtx(null)
      return
    }
    localStorage.removeItem("products-ctx")
    const contextKey = `products-ctx:${userId}`
    try {
      const next = await loadContext()
      localStorage.setItem(contextKey, JSON.stringify(next))
      setCtx(next)
      setError("")
    } catch (err) {
      const cached = localStorage.getItem(contextKey)
      if (!navigator.onLine && cached) {
        setCtx(JSON.parse(cached) as Ctx)
        return
      }
      setError((err as Error).message === "NO_SESSION" ? t("signInFirst") : t("loadFailed"))
    }
  }, [t])

  useEffect(() => { void refreshContext() }, [refreshContext])

  useEffect(() => {
    let active = true
    setCatalog([])
    setLimit(PAGE)
    void (async () => {
      try {
        const cached = await getCachedCatalog(branchCode).catch(() => null)
        if (active && cached) {
          setCatalog(cached.products)
          setLoadedBranch(branchCode)
        }
        if (!navigator.onLine) return
        const fresh = await syncBranchCatalog(branchCode)
        if (active) setCatalog(fresh.products)
      } catch {
        /* Keep the cached catalog available offline. */
      } finally {
        if (active) setLoadedBranch(branchCode)
      }
    })()
    return () => { active = false }
  }, [branchCode])

  const name = (p: CatalogProduct) => (lang === "ar" && p.name_ar ? p.name_ar : p.name_en)
  const catName = (p: CatalogProduct) =>
    (lang === "ar" ? p.category_name_ar : p.category_name_en) ?? t("uncategorized")

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return catalog.filter((p) => {
      if (category && p.category_id !== category) return false
      if (filter === "noBarcode" && p.barcodes.length) return false
      if (filter === "noImage" && p.images.length) return false
      if (filter === "lowStock" && !(p.track_stock && (p.stock_quantity ?? 0) <= 5)) return false
      if (!needle) return true
      return (
        p.product_code.toLocaleLowerCase().includes(needle) ||
        p.name_en.toLocaleLowerCase().includes(needle) ||
        (p.name_ar ?? "").toLocaleLowerCase().includes(needle) ||
        p.barcodes.some((b) => b.toLowerCase().includes(needle))
      )
    })
  }, [catalog, query, category, filter])

  const open = async (id: string | null) => {
    if (!ctx) return
    setBusy(true)
    setNotice("")
    try {
      if (!navigator.onLine) {
        const draft = await draftFromCache(id, ctx.branches, branchCode)
        setForm({ draft, original: id ? structuredClone(draft) : null })
      } else if (id === null) {
        setForm({ draft: await newDraft(ctx.branches, branchCode), original: null })
      } else {
        const draft = await loadDraft(id, ctx.branches)
        setForm({ draft, original: structuredClone(draft) })
      }
    } catch (err) {
      setError(`${t("loadFailed")} ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const afterSave = async (saved: { id: string; code: string }, draft: ProductDraft) => {
    setForm(null)
    setNotice(navigator.onLine ? t("saved") : t("queuedOffline"))
    const activeContext = ctx
    const branch = activeContext?.branches.find((item) => item.code === branchCode)
    const branchDraft = branch ? draft.branches[branch.id] : null
    if (activeContext && branch && branchDraft) {
      const cached = await getCachedCatalog(branchCode).catch(() => null)
      const previous = cached?.products.find((item) => item.product_id === saved.id)
      let core = {
        product_code: saved.code,
        name_en: draft.nameEn.trim(),
        name_ar: draft.nameAr.trim() || null,
        description_en: draft.descEn.trim() || null,
        description_ar: draft.descAr.trim() || null,
        category_id: draft.categoryId || null,
      }
      let images = previous?.images ?? []
      if (navigator.onLine) {
        const [productResult, imageResult] = await Promise.all([
          supabase.from("products").select("product_code,name_en,name_ar,description_en,description_ar,category_id").eq("id", saved.id).maybeSingle(),
          supabase.from("product_images").select("id,storage_path,image_url,is_primary").eq("product_id", saved.id).order("sort_order"),
        ])
        if (productResult.data) core = productResult.data
        if (!imageResult.error && imageResult.data) {
          images = imageResult.data.map((image) => ({ ...image, url: image.image_url }))
        }
      }
      const category = activeContext.categories.find((item) => item.id === core.category_id)
      const numberOrNull = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null
      const updated: CatalogProduct = {
        ...previous,
        product_id: saved.id,
        ...core,
        category_name_en: category?.name_en ?? (draft.newCategoryEn.trim() || null),
        category_name_ar: category?.name_ar ?? (draft.newCategoryAr.trim() || null),
        branch_code: branchDraft.branchCode.trim() || null,
        track_stock: branchDraft.trackStock,
        stock_quantity: branchDraft.trackStock ? (numberOrNull(branchDraft.stock) === null ? null : Math.round(Number(branchDraft.stock))) : null,
        purchase_price: can.view(activeContext.profile, "purchase") ? numberOrNull(branchDraft.purchase) ?? undefined : previous?.purchase_price,
        wholesale_price: can.view(activeContext.profile, "wholesale") ? numberOrNull(branchDraft.wholesale) ?? undefined : previous?.wholesale_price,
        retail_price: can.view(activeContext.profile, "retail") ? numberOrNull(branchDraft.retail) ?? undefined : previous?.retail_price,
        barcodes: draft.barcodes.map((barcode) => barcode.trim()).filter(Boolean),
        images,
      }
      await updateCachedProduct(branchCode, updated, branchDraft.available).catch(() => false)
    }
    const cached = await getCachedCatalog(branchCode)
    if (cached) setCatalog(cached.products)
    void refreshContext()
    window.scrollTo({ top: 0 })
  }

  if (error) {
    return <p role="alert" className="mx-auto max-w-3xl rounded-2xl border border-red-300 bg-red-50 p-5 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>
  }
  if (!ctx || loadedBranch !== branchCode) {
    return <Skeleton />
  }

  const { profile } = ctx
  const canEdit = can.editProducts(profile) || can.edit(profile, "retail") || can.edit(profile, "wholesale") || can.edit(profile, "purchase") || can.stock(profile)

  const chip = (id: Filter, label: string) => (
    <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
      className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium transition ${filter === id ? "bg-brand text-on-brand" : "border border-line2 bg-surface text-ink2 hover:text-ink"}`}>
      {label}
    </button>
  )

  return (
    <>
      {form ? (
        <ProductForm
          initial={form.draft}
          original={form.original}
          profile={profile}
          branches={ctx.branches}
          categories={ctx.categories}
          onCancel={() => setForm(null)}
          onSaved={(saved) => void afterSave(saved, form.draft)}
          onSticker={(draft, retail) =>
            setSticker({ name: draft.nameEn || draft.code, code: draft.code, barcodes: draft.barcodes, retail })
          }
        />
      ) : (
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold text-ink">{t("products")}</h1>
              <p className="mt-1 text-sm text-ink2">{t("productsSub")} · {catalog.length}</p>
            </div>
            {canEdit && can.editProducts(profile) && (
              <button onClick={() => void open(null)} disabled={busy}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-on-brand disabled:opacity-50">
                <Icon name="plus" className="size-5" /> {t("addProduct")}
              </button>
            )}
          </div>

          {!online && <p className="rounded-xl bg-surface2 px-4 py-3 text-sm text-ink2">{t("offlineEditOk")}</p>}
          {pending > 0 && (
            <p role="status" className="flex items-center gap-2 rounded-xl bg-accent/12 px-4 py-3 text-sm font-medium text-ink">
              <span className="size-2 rounded-full bg-accent motion-safe:animate-pulse" /> {pending} {t("pendingSync")}
            </p>
          )}
          {notice && <p role="status" className="rounded-xl bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">{notice}</p>}

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">{t("searchProduct")}</span>
              <Icon name="search" className="absolute start-4 top-3 size-5 text-ink2" />
              <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }} placeholder={t("searchPlaceholder")}
                className="h-11 w-full rounded-xl border border-line2 bg-surface ps-12 pe-4 text-ink outline-none focus:border-focus focus:ring-2 focus:ring-focus/20" />
            </label>
            <button onClick={() => setSheet(true)} className="relative inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line2 bg-surface px-4 font-medium text-ink sm:hidden">
              <Icon name="menu" className="size-5" /> {t("filters")}
              {(category || filter !== "all") && <span className="grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-ink">{(category ? 1 : 0) + (filter !== "all" ? 1 : 0)}</span>}
            </button>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setLimit(PAGE) }} aria-label={t("category")}
              className="hidden h-11 rounded-xl border border-line2 bg-surface px-3 text-ink sm:block sm:w-56">
              <option value="">{t("allCategories")}</option>
              {ctx.categories.map((c) => <option key={c.id} value={c.id}>{lang === "ar" ? c.name_ar : c.name_en}</option>)}
            </select>
          </div>

          <div className="-mx-4 hidden gap-2 overflow-x-auto px-4 sm:flex lg:mx-0 lg:px-0">
            {chip("all", t("all"))}
            {chip("noBarcode", t("noBarcode"))}
            {chip("noImage", t("noImage"))}
            {chip("lowStock", t("lowStock"))}
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line2 bg-surface p-10 text-center text-ink2">{t("noProducts")}</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {filtered.slice(0, limit).map((p) => {
                const image = p.images.find((i) => i.is_primary) ?? p.images[0]
                return (
                  <li key={p.product_id} className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
                    <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-surface2 sm:size-16">
                      {image ? (
                        <img src={image.url} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <div className="grid size-full place-items-center text-ink2"><Icon name="image" className="size-6" /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{name(p)}</p>
                      <p className="mt-0.5 truncate text-xs text-ink2">
                        <span dir="ltr">{p.product_code}</span> · {catName(p)}
                        {!p.barcodes.length && <span className="ms-2 font-medium text-accent">{t("noBarcode")}</span>}
                      </p>
                    </div>
                    <div className="hidden text-end sm:block">
                      {p.retail_price !== undefined && <p className="font-semibold text-ink">{sar(p.retail_price)}</p>}
                      {p.track_stock && (
                        <p className={`text-xs ${(p.stock_quantity ?? 0) <= 5 ? "font-semibold text-red-600" : "text-ink2"}`}>
                          {p.stock_quantity ?? 0} {t("inStock")}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button onClick={() => setSticker({ name: p.name_en, code: p.product_code, barcodes: p.barcodes, retail: p.retail_price })}
                        aria-label={t("sticker")} title={t("sticker")}
                        className="grid size-10 place-items-center rounded-lg border border-line2 text-ink2 hover:text-ink">
                        <Icon name="print" className="size-[18px]" />
                      </button>
                      {canEdit && (
                        <button onClick={() => void open(p.product_id)} disabled={busy} aria-label={t("edit")} title={t("edit")}
                          className="grid size-10 place-items-center rounded-lg bg-brand text-on-brand disabled:opacity-50">
                          <Icon name="pencil" className="size-[18px]" />
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {filtered.length > limit && (
            <button onClick={() => setLimit(limit + PAGE)} className="mx-auto block h-11 rounded-xl border border-line2 bg-surface px-6 font-medium text-ink">
              {t("showMore")} ({filtered.length - limit})
            </button>
          )}
        </div>
      )}
      {sheet && (
        <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label={t("filters")}>
          <button aria-label={t("close")} onClick={() => setSheet(false)} className="sheet-fade absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="sheet-up glass-strong absolute inset-x-0 bottom-0 rounded-t-[2rem] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line2" />
            <h2 className="font-display text-lg font-semibold text-ink">{t("filters")}</h2>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink2">{t("category")}</p>
            <div className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {[{ id: "", label: t("allCategories") }, ...ctx.categories.map((c) => ({ id: c.id, label: lang === "ar" ? c.name_ar : c.name_en }))].map((c) => (
                <button key={c.id || "all"} onClick={() => { setCategory(c.id); setLimit(PAGE) }} aria-pressed={category === c.id}
                  className={`h-9 rounded-full px-4 text-sm font-medium transition ${category === c.id ? "bg-brand text-on-brand" : "border border-line2 bg-surface text-ink2"}`}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink2">{t("filters")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {chip("all", t("all"))}
              {chip("noBarcode", t("noBarcode"))}
              {chip("noImage", t("noImage"))}
              {chip("lowStock", t("lowStock"))}
            </div>
            <button onClick={() => setSheet(false)} className="mt-6 h-12 w-full rounded-2xl bg-brand font-semibold text-on-brand">
              {t("apply")} ({filtered.length})
            </button>
          </div>
        </div>
      )}
      {sticker && <StickerModal product={sticker} onClose={() => setSticker(null)} />}
    </>
  )
}

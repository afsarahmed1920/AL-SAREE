import { useEffect, useMemo, useState } from "react"
import { useApp } from "../lib/app-context"
import { can, type BranchRow, type Profile } from "../lib/products"
import {
  getCachedCatalog,
  syncBranchCatalog,
  type CatalogProduct,
} from "../lib/catalog-cache"
import { supabase } from "../lib/supabase"
import Icon from "./Icon"
import type { StickerProduct } from "./StickerModal"

type Audit = { created_at: string | null; updated_at: string | null }

export default function ProductDetailModal({
  product,
  branches,
  profile,
  onClose,
  onEdit,
  onSticker,
}: {
  product: CatalogProduct
  branches: BranchRow[]
  profile: Profile
  onClose: () => void
  onEdit: () => void
  onSticker: (product: StickerProduct) => void
}) {
  const { t, lang, sar } = useApp()
  const [imageIndex, setImageIndex] = useState(0)
  const [branchProducts, setBranchProducts] =
    useState<Record<string, CatalogProduct | undefined>>({})
  const [audit, setAudit] = useState<Audit | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPurchase, setShowPurchase] = useState(false)
  const images = product.images

  useEffect(() => {
    let active = true
    setLoading(true)
    const load = async () => {
      const [auditResult, ...catalogResults] = await Promise.all([
        navigator.onLine
          ? supabase
              .from("products")
              .select("created_at,updated_at")
              .eq("id", product.product_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        ...branches.map(async (branch) => {
          if (!navigator.onLine)
            return getCachedCatalog(branch.code).catch(() => null)
          try {
            return await syncBranchCatalog(branch.code)
          } catch {
            return getCachedCatalog(branch.code).catch(() => null)
          }
        }),
      ])
      if (!active) return
      setAudit(auditResult.data as Audit | null)
      const next: Record<string, CatalogProduct | undefined> = {}
      branches.forEach((branch, index) => {
        next[branch.id] = catalogResults[index]?.products.find(
          (item) => item.product_id === product.product_id,
        )
      })
      setBranchProducts(next)
      setLoading(false)
    }
    void load().catch(() => {
      if (active) setLoading(false)
    })
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", escape)
    return () => {
      active = false
      window.removeEventListener("keydown", escape)
    }
  }, [branches, onClose, product.product_id])

  const availableBranches = useMemo(
    () => branches.filter((branch) => branchProducts[branch.id]),
    [branches, branchProducts],
  )
  const localizedDate = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : t("notAvailable")
  const share = () => {
    const lines = [
      product.name_en,
      product.name_ar,
      `${t("productCode")}: ${product.product_code}`,
      `${t("category")}: ${
        lang === "ar"
          ? (product.category_name_ar ?? t("uncategorized"))
          : (product.category_name_en ?? t("uncategorized"))
      }`,
      ...product.barcodes.map((barcode) => `${t("barcodeValue")}: ${barcode}`),
      ...availableBranches.map((branch) => {
        const item = branchProducts[branch.id]!
        const prices = [
          can.view(profile, "retail") && item.retail_price !== undefined
            ? `${t("retailPriceSar")}: ${sar(item.retail_price)}`
            : null,
          can.view(profile, "wholesale") && item.wholesale_price !== undefined
            ? `${t("wholesalePriceSar")}: ${sar(item.wholesale_price)}`
            : null,
        ]
          .filter(Boolean)
          .join(", ")
        return `${
          lang === "ar" ? branch.name_ar : branch.name_en
        }: ${prices || "—"}`
      }),
    ].filter(Boolean)
    window.open(
      `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`,
      "_blank",
      "noopener,noreferrer",
    )
  }

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("productDetails")}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("close")}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative z-10 flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 sm:px-6">
          <h2 className="font-display text-lg font-semibold text-ink">
            {t("productDetails")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid size-10 place-items-center rounded-full text-ink2 hover:bg-surface2"
          >
            <Icon name="x" className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-6 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="aspect-square overflow-hidden rounded-2xl bg-surface2">
                {images[imageIndex] ? (
                  <img
                    src={images[imageIndex].url}
                    alt={product.name_en}
                    className="size-full object-contain"
                  />
                ) : (
                  <div className="grid size-full place-items-center text-ink2">
                    <Icon name="image" className="size-12" />
                  </div>
                )}
              </div>
              {images.length > 1 && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {images.map((image, index) => (
                    <button
                      key={image.id}
                      type="button"
                      aria-label={`${t("imageNumber")} ${index + 1}`}
                      aria-pressed={index === imageIndex}
                      onClick={() => setImageIndex(index)}
                      className={`size-14 shrink-0 overflow-hidden rounded-lg border-2 ${
                        index === imageIndex ? "border-brand" : "border-line2"
                      }`}
                    >
                      <img
                        src={image.url}
                        alt=""
                        className="size-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-ink">
                  {product.name_en}
                </h3>
                {product.name_ar && (
                  <p className="mt-1 text-lg text-ink2" dir="rtl">
                    {product.name_ar}
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-app p-3">
                  <dt className="text-xs text-ink2">{t("productCode")}</dt>
                  <dd
                    className="mt-1 font-mono font-semibold text-ink"
                    dir="ltr"
                  >
                    {product.product_code}
                  </dd>
                </div>
                <div className="rounded-xl bg-app p-3">
                  <dt className="text-xs text-ink2">{t("category")}</dt>
                  <dd className="mt-1 font-medium text-ink">
                    {lang === "ar"
                      ? (product.category_name_ar ?? t("uncategorized"))
                      : (product.category_name_en ?? t("uncategorized"))}
                  </dd>
                </div>
              </dl>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-ink">
                    {t("barcodes")}
                  </h4>
                  <button
                    type="button"
                    onClick={() =>
                      onSticker({
                        name: product.name_en,
                        code: product.product_code,
                        barcodes: product.barcodes,
                        retail: product.retail_price,
                      })
                    }
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line2 px-3 text-xs font-semibold text-ink"
                  >
                    <Icon name="print" className="size-4" />
                    {t("printSticker")}
                  </button>
                </div>
                {product.barcodes.length ? (
                  <div className="flex flex-wrap gap-2">
                    {product.barcodes.map((barcode) => (
                      <span
                        key={barcode}
                        dir="ltr"
                        className="rounded-lg bg-app px-3 py-2 font-mono text-sm text-ink"
                      >
                        {barcode}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink2">{t("noBarcodeYet")}</p>
                )}
              </div>
            </div>
          </div>

          <section className="mt-6">
            <h3 className="mb-3 font-display text-lg font-semibold text-ink">
              {t("branchBreakdown")}
            </h3>
            {loading ? (
              <p className="rounded-xl bg-app p-4 text-sm text-ink2">
                {t("loadingBranchDetails")}
              </p>
            ) : availableBranches.length === 0 ? (
              <p className="rounded-xl bg-app p-4 text-sm text-ink2">
                {t("notAvailableInBranches")}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {availableBranches.map((branch) => {
                  const item = branchProducts[branch.id]!
                  return (
                    <article
                      key={branch.id}
                      className="rounded-2xl border border-line bg-app p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-ink">
                            {lang === "ar" ? branch.name_ar : branch.name_en}
                          </h4>
                          <p dir="ltr" className="mt-0.5 text-xs text-ink2">
                            {t("branchCode")}: {item.branch_code ?? branch.code}
                          </p>
                        </div>
                        <span className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">
                          {item.track_stock
                            ? `${item.stock_quantity ?? 0} ${t("inStock")}`
                            : t("notTracked")}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        {can.view(profile, "retail") && (
                          <div className="rounded-lg bg-surface p-2.5">
                            <dt className="text-xs text-ink2">
                              {t("retailPriceSar")}
                            </dt>
                            <dd className="mt-1 font-semibold text-ink">
                              {item.retail_price === undefined
                                ? "—"
                                : sar(item.retail_price)}
                            </dd>
                          </div>
                        )}
                        {can.view(profile, "wholesale") && (
                          <div className="rounded-lg bg-surface p-2.5">
                            <dt className="text-xs text-ink2">
                              {t("wholesalePriceSar")}
                            </dt>
                            <dd className="mt-1 font-semibold text-ink">
                              {item.wholesale_price === undefined
                                ? "—"
                                : sar(item.wholesale_price)}
                            </dd>
                          </div>
                        )}
                        {can.view(profile, "purchase") && (
                          <div className="rounded-lg bg-surface p-2.5">
                            <dt className="text-xs text-ink2">
                              {t("purchasePrice")}
                            </dt>
                            <dd className="mt-1 flex items-center gap-2">
                              <span
                                className={`font-semibold text-ink ${
                                  showPurchase ? "" : "select-none blur-sm"
                                }`}
                              >
                                {item.purchase_price === undefined
                                  ? "—"
                                  : sar(item.purchase_price)}
                              </span>
                              <button
                                type="button"
                                aria-label={
                                  showPurchase
                                    ? t("hideBuying")
                                    : t("revealBuying")
                                }
                                onClick={() =>
                                  setShowPurchase((value) => !value)
                                }
                                className="grid size-8 place-items-center rounded-md text-ink2 hover:bg-surface2"
                              >
                                <Icon
                                  name={showPurchase ? "eyeOff" : "eye"}
                                  className="size-4"
                                />
                              </button>
                            </dd>
                          </div>
                        )}
                      </dl>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <div className="mt-5 grid gap-2 rounded-xl bg-app p-3 text-xs text-ink2 sm:grid-cols-2">
            <p>
              {t("createdDate")}: {localizedDate(audit?.created_at)}
            </p>
            <p>
              {t("lastUpdated")}: {localizedDate(audit?.updated_at)}
            </p>
          </div>
        </div>
        <footer className="flex shrink-0 flex-wrap gap-2 border-t border-line bg-surface p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:p-4">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand"
          >
            <Icon name="pencil" className="size-4" />
            {t("editProduct")}
          </button>
          <button
            type="button"
            onClick={share}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line2 px-4 text-sm font-semibold text-ink"
          >
            <Icon name="share" className="size-4" />
            {t("shareWhatsApp")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-line2 px-5 text-sm font-semibold text-ink"
          >
            {t("close")}
          </button>
        </footer>
      </section>
    </div>
  )
}

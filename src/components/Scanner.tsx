import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react"
import { useApp } from "../lib/app-context"
import {
  findCatalogProduct,
  getCachedCatalog,
  syncBranchCatalog,
  type CatalogProduct,
} from "../lib/catalog-cache"
import Icon from "./Icon"
import { scanFeedback } from "../lib/feedback"
import { shareProductCard } from "../lib/share-card"
import { useCompanyName } from "./Logo"
import CameraScannerModal from "./CameraScannerModal"

type CalculatorLine = {
  id: string
  name: string
  kind: "retail" | "wholesale"
  amount: number
}

export default function Scanner({ branchCode, scanCode, onScanCodeHandled }: { branchCode: string; scanCode?: string; onScanCodeHandled?: () => void }) {
  const { t, lang, sar } = useApp()
  const company = useCompanyName()
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<CatalogProduct | null>(null)
  const [status, setStatus] =
    useState<"loading" | "synced" | "cached" | "empty">("loading")
  const [notFound, setNotFound] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [buyingRevealed, setBuyingRevealed] = useState(false)
  const [calculator, setCalculator] = useState<CalculatorLine[]>([])
  const [calculatorOpen, setCalculatorOpen] = useState(false)

  useEffect(() => {
    let active = true
    setStatus("loading")
    setResult(null)
    setBuyingRevealed(false)

    void (async () => {
      const cached = await getCachedCatalog(branchCode)
      if (!active) return
      if (cached?.products.length) {
        setCatalog(cached.products)
        setStatus("cached")
      }

      const emptyIfNoCache = () => {
        if (active && !cached?.products.length) setStatus("empty")
      }

      if (!navigator.onLine) {
        emptyIfNoCache()
        return
      }

      try {
        const fresh = await syncBranchCatalog(branchCode)
        if (!active) return
        setCatalog(fresh.products)
        setStatus(fresh.products.length ? "synced" : "empty")
      } catch {
        emptyIfNoCache()
      }
    })()

    return () => {
      active = false
    }
  }, [branchCode])

  const lookup = useCallback(
    (value: string) => {
      const match = findCatalogProduct(catalog, value)
      setResult(match)
      setNotFound(!match)
      setBuyingRevealed(false)
      scanFeedback(!!match)
      if (match) setQuery(value)
    },
    [catalog],
  )

  useEffect(() => {
    if (!scanCode || status === "loading") return
    setQuery(scanCode)
    lookup(scanCode)
    onScanCodeHandled?.()
  }, [scanCode, status, lookup, onScanCodeHandled])

  useEffect(() => {
    let buffer = ""
    let lastKeyAt = 0
    const listen = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.matches("input, textarea, select") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return
      const now = Date.now()
      if (now - lastKeyAt > 80) buffer = ""
      lastKeyAt = now
      if (event.key === "Enter" && buffer.length >= 3) {
        lookup(buffer)
        buffer = ""
      } else if (event.key.length === 1) {
        buffer += event.key
      }
    }
    window.addEventListener("keydown", listen)
    return () => window.removeEventListener("keydown", listen)
  }, [lookup])

  const scanPhoto = async (file?: File) => {
    if (!file) return
    setCameraError("")
    try {
      const { Html5Qrcode } = await import("html5-qrcode")
      const reader = new Html5Qrcode("barcode-file-reader")
      const text = await reader.scanFile(file, false)
      reader.clear()
      lookup(text)
    } catch {
      setCameraError(t("photoScanFailed"))
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    lookup(query)
  }

  const primaryImage =
    result?.images.find((image) => image.is_primary) ?? result?.images[0]
  const productName = result
    ? lang === "ar" && result.name_ar
      ? result.name_ar
      : result.name_en
    : ""
  const total = useMemo(
    () => calculator.reduce((sum, line) => sum + line.amount, 0),
    [calculator],
  )

  const addPrice = (kind: "retail" | "wholesale") => {
    if (!result) return
    const amount =
      kind === "retail" ? result.retail_price : result.wholesale_price
    if (amount === undefined) return
    setCalculator((current) => [
      ...current,
      { id: crypto.randomUUID(), name: productName, kind, amount },
    ])
    setCalculatorOpen(true)
  }

  const share = async (kind: "retail" | "wholesale") => {
    if (!result) return
    const amount =
      kind === "retail" ? result.retail_price : result.wholesale_price
    if (amount === undefined) return
    const text = `${productName}\n${result.product_code}\n${
      kind === "retail" ? t("retailPrice") : t("wholesalePrice")
    }: ${sar(amount)}${primaryImage ? `\n${primaryImage.url}` : ""}`
    await shareProductCard(
      {
        name: productName,
        code: result.product_code,
        priceLabel: kind === "retail" ? t("retailPrice") : t("wholesalePrice"),
        price: sar(amount),
        imageUrl: primaryImage?.url,
        company,
        rtl: lang === "ar",
      },
      text,
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">
              {t("scanBarcode")}
            </h1>
            <p className="mt-1 text-sm text-ink2">{t("scannerSub")}</p>
          </div>
          <span className="rounded-full bg-surface2 px-3 py-1.5 text-xs font-medium text-ink2">
            {status === "loading"
              ? t("syncing")
              : status === "synced"
                ? t("catalogReady")
                : status === "empty"
                  ? t("noProducts")
                  : t("offlineReady")}{" "}
            · {catalog.length}
          </span>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">{t("searchProduct")}</span>
            <Icon
              name="search"
              className="absolute start-4 top-3.5 size-5 text-ink2"
            />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setNotFound(false)
              }}
              className="h-12 w-full rounded-xl border border-line2 bg-app ps-12 pe-4 text-ink outline-none focus:border-focus focus:ring-2 focus:ring-focus/20"
              placeholder={t("searchPlaceholder")}
              autoFocus
            />
          </label>
          <button className="h-12 rounded-xl bg-brand px-6 font-semibold text-on-brand">
            {t("search")}
          </button>
          <button
            type="button"
            onClick={() => setCameraOpen((value) => !value)}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-brand-deep"
          >
            <Icon name="camera" />
            {t("useCamera")}
          </button>
          <label className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line2 bg-surface px-5 font-semibold text-ink">
            <Icon name="image" />
            {t("scanPhoto")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                void scanPhoto(e.target.files?.[0])
                e.target.value = ""
              }}
            />
          </label>
          <div id="barcode-file-reader" hidden />
        </form>
        {notFound && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {t("notFound")}
          </p>
        )}
        {cameraError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {cameraError}
          </p>
        )}
      </section>

      <CameraScannerModal open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={lookup} readerId="barcode-lookup-reader" />

      {!result && !cameraOpen && (
        <section className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-line2 bg-surface p-8 text-center">
          <div>
            <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-surface2 text-brand">
              <Icon name="scan" className="size-8" />
            </div>
            <p className="mt-4 font-display text-lg font-semibold text-ink">
              {t("readyToScan")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink2">
              {t("hardwareHint")}
            </p>
          </div>
        </section>
      )}

      {result && (
        <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {primaryImage ? (
              <a href={primaryImage.url} target="_blank" rel="noreferrer">
                <img
                  src={primaryImage.url}
                  alt={productName}
                  className="aspect-square w-full object-cover"
                />
              </a>
            ) : (
              <div className="grid aspect-square place-items-center bg-surface2 text-ink2">
                <div className="text-center">
                  <Icon name="image" className="mx-auto size-10" />
                  <span className="mt-2 block text-sm">
                    {t("noProductImage")}
                  </span>
                </div>
              </div>
            )}
            <div className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-brand">
                {result.category_name_en ?? t("uncategorized")}
              </div>
              <h2 className="mt-1 font-display text-2xl font-semibold text-ink">
                {productName}
              </h2>
              {result.name_ar && lang === "en" && (
                <p className="mt-1 text-ink2" dir="rtl">
                  {result.name_ar}
                </p>
              )}
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-ink2">{t("productCode")}</dt>
                  <dd className="font-semibold text-ink" dir="ltr">
                    {result.product_code}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink2">{t("branchCode")}</dt>
                  <dd className="font-semibold text-ink" dir="ltr">
                    {result.branch_code ?? "—"}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink2">{t("stock")}</dt>
                  <dd className="font-semibold text-ink">
                    {result.track_stock
                      ? `${result.stock_quantity ?? 0} ${t("inStock")}`
                      : t("notTracked")}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="space-y-4">
            {result.retail_price !== undefined && (
              <div className="rounded-2xl bg-brand p-5 text-on-brand">
                <p className="text-sm opacity-75">{t("retailPrice")}</p>
                <p className="mt-1 font-display text-3xl font-semibold break-words sm:text-4xl">
                  {sar(result.retail_price)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => addPrice("retail")}
                    className="rounded-lg bg-surface px-3 py-2 text-sm font-semibold text-brand"
                  >
                    {t("addRetail")}
                  </button>
                  <button
                    onClick={() => share("retail")}
                    className="rounded-lg border border-white/30 px-3 py-2 text-sm font-semibold"
                  >
                    {t("shareWhatsApp")}
                  </button>
                </div>
              </div>
            )}

            {result.wholesale_price !== undefined && (
              <div className="rounded-2xl border border-line bg-surface p-5">
                <span className="rounded-full bg-accent/20 px-2.5 py-1 text-xs font-semibold text-accent">
                  {t("wholesale")}
                </span>
                <p className="mt-3 font-display text-3xl font-semibold text-ink">
                  {sar(result.wholesale_price)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => addPrice("wholesale")}
                    className="rounded-lg bg-surface2 px-3 py-2 text-sm font-semibold text-ink"
                  >
                    {t("addWholesale")}
                  </button>
                  <button
                    onClick={() => share("wholesale")}
                    className="rounded-lg border border-line2 px-3 py-2 text-sm font-semibold text-ink"
                  >
                    {t("shareWhatsApp")}
                  </button>
                </div>
              </div>
            )}

            {result.purchase_price !== undefined && (
              <div className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-ink2">{t("buyingPrice")}</p>
                    <p
                      className={`mt-1 font-display text-3xl font-semibold text-ink transition ${
                        buyingRevealed ? "" : "select-none blur-md"
                      }`}
                    >
                      {sar(result.purchase_price)}
                    </p>
                  </div>
                  <button
                    onClick={() => setBuyingRevealed((value) => !value)}
                    className="grid size-11 place-items-center rounded-xl bg-surface2 text-ink"
                    aria-label={
                      buyingRevealed ? t("hideBuying") : t("revealBuying")
                    }
                  >
                    <Icon name={buyingRevealed ? "eyeOff" : "eye"} />
                  </button>
                </div>
                <p className="mt-3 text-xs text-ink2">
                  {buyingRevealed ? t("tapToHide") : t("tapToReveal")}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {calculator.length > 0 && (
        <aside className="calc-drawer fixed inset-x-3 z-40 mx-auto flex max-h-[60dvh] max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <button
            onClick={() => setCalculatorOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 p-4 text-start"
          >
            <span>
              <span className="block text-xs text-ink2">
                {t("quickCalculator")} · {calculator.length}
              </span>
              <span className="font-display text-xl font-semibold text-ink">
                {sar(total)}
              </span>
            </span>
            <Icon
              name="chevron"
              className={`transition ${calculatorOpen ? "rotate-180" : ""}`}
            />
          </button>
          {calculatorOpen && (
            <div className="border-t border-line p-4">
              <ul className="max-h-44 space-y-2 overflow-auto">
                {calculator.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate text-ink">
                      {line.name}{" "}
                      <span className="text-ink2">({t(line.kind)})</span>
                    </span>
                    <span className="shrink-0 font-semibold text-ink">
                      {sar(line.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setCalculator([])}
                className="mt-4 w-full rounded-lg border border-line2 py-2 text-sm font-semibold text-ink2"
              >
                {t("clearCalculator")}
              </button>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}

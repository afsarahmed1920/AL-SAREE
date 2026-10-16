import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useApp } from "../lib/app-context"
import { code128Bars, isCode128Text } from "../lib/code128"
import Icon from "./Icon"

export type StickerProduct = {
  name: string
  code: string
  barcodes: string[]
  retail?: number | null
}

const sizes = [
  { id: "30x20", w: 30, h: 20 },
  { id: "50x30", w: 50, h: 30 },
  { id: "40x25", w: 40, h: 25 },
  { id: "58x40", w: 58, h: 40 },
] as const

function BarcodeSvg({ value, className }: { value: string; className?: string }) {
  const { bars, total } = code128Bars(value)
  const quiet = 10
  return (
    <svg
      viewBox={`0 0 ${total + quiet * 2} 10`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label={value}
    >
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x + quiet} y={0} width={bar.w} height={10} fill="#000" />
      ))}
    </svg>
  )
}

function Label({ product, barcode, price, size, sar }: {
  product: StickerProduct
  barcode: string
  price: boolean
  size: (typeof sizes)[number]
  sar: (n: number) => string
}) {
  return (
    <div
      dir="auto"
      className="flex flex-col justify-between overflow-hidden bg-white p-[1.5mm] text-black"
      style={{ width: `${size.w}mm`, height: `${size.h}mm`, breakAfter: "page" }}
    >
      <div className="flex items-start justify-between gap-1 leading-tight">
        <span className="line-clamp-2 text-[8pt] font-bold">{product.name}</span>
        {price && product.retail != null && (
          <span className="shrink-0 text-[8pt] font-bold" dir="ltr">{sar(product.retail)}</span>
        )}
      </div>
      <div>
        <BarcodeSvg value={barcode} className="h-[10mm] w-full" />
        <div className="flex justify-between font-mono text-[6.5pt] leading-tight" dir="ltr">
          <span>{barcode}</span>
          <span>{product.code}</span>
        </div>
      </div>
    </div>
  )
}

export default function StickerModal({ product, onClose }: { product: StickerProduct; onClose: () => void }) {
  const { t, sar } = useApp()
  const usable = product.barcodes.filter(isCode128Text)
  const [barcode, setBarcode] = useState(usable[0] ?? "")
  const [sizeId, setSizeId] = useState<(typeof sizes)[number]["id"]>("50x30")
  const [price, setPrice] = useState(product.retail != null)
  const [copies, setCopies] = useState(1)
  const hasPrice = product.retail != null
  const size = sizes.find((s) => s.id === sizeId)!

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const field = "h-10 rounded-lg border border-line2 bg-app px-3 text-sm text-ink"

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("printSticker")}>
      <style>{`@media print { @page { size: ${size.w}mm ${size.h}mm; margin: 0 } }`}</style>
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line p-4">
          <h2 className="font-display text-lg font-semibold text-ink">{t("printSticker")}</h2>
          <button onClick={onClose} aria-label={t("close")} className="grid size-9 place-items-center rounded-lg text-ink2 hover:bg-surface2">
            <Icon name="x" className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {usable.length === 0 ? (
          <p className="rounded-xl bg-surface2 p-4 text-sm text-ink2">{t("noBarcodeYet")}</p>
        ) : (
          <>
            <div className="grid place-items-center overflow-auto rounded-xl bg-surface2 p-5">
              <div className="shadow-md">
                <Label product={product} barcode={barcode} price={price && hasPrice} size={size} sar={sar} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-2 grid gap-1 text-ink2">
                {t("barcodeValue")}
                <select className={field} value={barcode} onChange={(e) => setBarcode(e.target.value)} dir="ltr">
                  {usable.map((b) => <option key={b}>{b}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-ink2">
                {t("labelSize")}
                <select className={field} value={sizeId} onChange={(e) => setSizeId(e.target.value as typeof sizeId)} dir="ltr">
                  {sizes.map((s) => <option key={s.id} value={s.id}>{s.w} × {s.h} mm</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-ink2">
                {t("copies")}
                <input type="number" min={1} max={200} value={copies} className={field}
                  onChange={(e) => setCopies(Math.min(200, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
              <label className={`col-span-2 flex items-center gap-2 ${hasPrice ? "text-ink" : "text-ink2"}`}>
                <input type="checkbox" disabled={!hasPrice} checked={price && hasPrice} onChange={(e) => setPrice(e.target.checked)} className="size-4 accent-[var(--primary-main)]" />
                {t("showPrice")}
                {hasPrice ? ` (${sar(product.retail!)})` : ` — ${t("noRetailPrice")}`}
              </label>
            </div>

          </>
        )}
        </div>
        {usable.length > 0 && (
          <div className="shrink-0 border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button onClick={() => window.print()} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-on-brand">
              <Icon name="print" /> {t("print")}
            </button>
          </div>
        )}
      </div>
      {usable.length > 0 &&
        createPortal(
          <div className="print-sheet hidden print:block">
            {Array.from({ length: copies }, (_, i) => (
              <Label key={i} product={product} barcode={barcode} price={price && hasPrice} size={size} sar={sar} />
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

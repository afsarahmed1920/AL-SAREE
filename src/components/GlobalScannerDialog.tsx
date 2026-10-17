import { useEffect, useState } from "react"
import { useApp } from "../lib/app-context"
import Icon from "./Icon"

export default function GlobalScannerDialog({ open, onClose, onScan }: {
  open: boolean
  onClose: () => void
  onScan: (barcode: string) => void
}) {
  const { t } = useApp()
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    let scanner: import("html5-qrcode").Html5Qrcode | null = null
    let startPromise: Promise<unknown> | null = null
    let disposed = false
    let found = false
    setError("")
    void import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (disposed) return
        scanner = new Html5Qrcode("global-barcode-reader")
        startPromise = scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (text) => {
            if (found) return
            found = true
            onScan(text)
            onClose()
          },
          () => undefined,
        )
      })
      .catch((cause: unknown) => {
        if (disposed) return
        const message = String((cause as Error)?.message ?? cause ?? "").toLowerCase()
        setError(!window.isSecureContext
          ? t("cameraHttpsHelp")
          : /permission|denied|notallowed/.test(message)
            ? t("cameraPermissionHelp")
            : t("cameraError"))
      })
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", escape)
    return () => {
      disposed = true
      window.removeEventListener("keydown", escape)
      if (startPromise) {
        void startPromise.then(() => scanner?.isScanning ? scanner.stop() : undefined)
          .catch(() => undefined)
          .finally(() => scanner?.clear())
      } else scanner?.clear()
    }
  }, [open, onClose, onScan, t, attempt])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("scanBarcode")}>
      <section className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/15 bg-surface shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 font-semibold text-ink"><Icon name="camera" className="size-5 text-brand" />{t("scanBarcode")}</div>
          <button type="button" onClick={onClose} aria-label={t("closeCamera")} className="grid size-10 shrink-0 place-items-center rounded-full text-ink2 hover:bg-surface2"><Icon name="x" className="size-5" /></button>
        </header>
        <div id="global-barcode-reader" className="mx-auto min-h-48 max-w-xl overflow-hidden bg-black" />
        {error ? (
          <div className="space-y-3 p-4">
            <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">{error}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setError(""); setAttempt((value) => value + 1) }} className="h-10 rounded-xl bg-brand px-4 font-semibold text-on-brand">{t("retryCamera")}</button>
              <button type="button" onClick={onClose} className="h-10 rounded-xl border border-line2 px-4 font-semibold text-ink">{t("closeCamera")}</button>
            </div>
          </div>
        ) : <p className="p-4 text-center text-sm text-ink2">{t("cameraHint")}</p>}
      </section>
    </div>
  )
}

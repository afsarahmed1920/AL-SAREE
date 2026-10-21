import { useEffect, useRef, useState } from "react"
import { useApp } from "../lib/app-context"
import { scanFeedback } from "../lib/feedback"
import Icon from "./Icon"

export default function CameraScannerModal({ open, onClose, onScan, mode = "single", readerId = "camera-scanner-reader", playFeedback = true }: {
  open: boolean
  onClose: () => void
  onScan: (barcode: string) => void
  mode?: "single" | "continuous"
  readerId?: string
  playFeedback?: boolean
}) {
  const { t } = useApp()
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null)
  const callbacks = useRef({ onClose, onScan })
  callbacks.current = { onClose, onScan }

  useEffect(() => {
    if (!open) return
    let scanner: import("html5-qrcode").Html5Qrcode | null = null
    let startPromise: Promise<unknown> | null = null
    let disposed = false
    let found = false
    setError("")
    setTorchSupported(false)
    setTorchOn(false)
    void import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (disposed) return
        scanner = new Html5Qrcode(readerId)
        scannerRef.current = scanner
        startPromise = scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (text) => {
            if (mode === "single" && found) return
            found = true
            if (playFeedback) scanFeedback(true)
            callbacks.current.onScan(text)
            if (mode === "single") callbacks.current.onClose()
          },
          () => undefined,
        ).then(() => {
          if (!disposed) setTorchSupported(scanner?.getRunningTrackCameraCapabilities().torchFeature().isSupported() ?? false)
        }).catch((cause: unknown) => {
          if (disposed) return
          const message = String((cause as Error)?.message ?? cause ?? "").toLowerCase()
          setError(!window.isSecureContext
            ? t("cameraHttpsHelp")
            : /permission|denied|notallowed|not found|requested device/i.test(message)
              ? t("cameraPermissionHelp")
              : t("cameraError"))
        })
      })
      .catch((cause: unknown) => {
        if (disposed) return
        const message = String((cause as Error)?.message ?? cause ?? "").toLowerCase()
        setError(!window.isSecureContext
          ? t("cameraHttpsHelp")
          : /permission|denied|notallowed|not found/i.test(message)
            ? t("cameraPermissionHelp")
            : t("cameraError"))
      })

    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") callbacks.current.onClose() }
    window.addEventListener("keydown", escape)
    return () => {
      disposed = true
      window.removeEventListener("keydown", escape)
      const current = scanner
      if (!current) return
      const stop = () => current.isScanning ? current.stop() : Promise.resolve()
      void (startPromise ? startPromise.then(stop) : stop()).catch(() => undefined).finally(() => {
        current.clear()
        if (scannerRef.current === current) scannerRef.current = null
      })
    }
  }, [open, mode, readerId, playFeedback, t, attempt])

  const toggleTorch = async () => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      const capability = scanner.getRunningTrackCameraCapabilities().torchFeature()
      await capability.apply(!torchOn)
      setTorchOn(!torchOn)
    } catch {
      setTorchSupported(false)
      setTorchOn(false)
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("scanBarcode")}>
      <section className="w-full max-w-xl overflow-hidden rounded-t-3xl border border-white/15 bg-surface shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl sm:pb-0">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 pt-[max(.75rem,env(safe-area-inset-top))] sm:pt-3">
          <div className="flex min-w-0 items-center gap-2 font-semibold text-ink"><Icon name="camera" className="size-5 text-brand" />{t("scanBarcode")}</div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { if (torchSupported) void toggleTorch() }} disabled={!torchSupported} aria-pressed={torchOn} aria-label={torchSupported ? t("toggleTorch") : t("torchUnavailable")} title={torchSupported ? t("toggleTorch") : t("torchUnavailable")} className={`grid size-11 place-items-center rounded-full ${torchOn ? "bg-accent text-brand-deep" : "text-ink2 hover:bg-surface2 disabled:opacity-40"}`}><Icon name="sparkle" className="size-5" /></button>
            <button type="button" onClick={onClose} aria-label={t("closeCamera")} className="grid size-11 place-items-center rounded-full text-ink2 hover:bg-surface2"><Icon name="x" className="size-5" /></button>
          </div>
        </header>
        <div id={readerId} className="mx-auto min-h-52 w-full overflow-hidden bg-black sm:min-h-64" />
        {error ? (
          <div className="space-y-3 p-4">
            <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">{error}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setError(""); setAttempt((value) => value + 1) }} className="h-11 rounded-xl bg-brand px-4 font-semibold text-on-brand">{t("retryCamera")}</button>
              <button type="button" onClick={onClose} className="h-11 rounded-xl border border-line2 px-4 font-semibold text-ink">{t("closeCamera")}</button>
            </div>
          </div>
        ) : <p className="p-4 text-center text-sm text-ink2">{t(mode === "continuous" ? "cameraContinuousHint" : "cameraHint")}</p>}
      </section>
    </div>
  )
}

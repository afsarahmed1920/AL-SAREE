import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useApp } from "../lib/app-context"
import { scanFeedback } from "../lib/feedback"
import Icon from "./Icon"

type Scanner = import("html5-qrcode").Html5Qrcode
type Translate = ReturnType<typeof useApp>["t"]

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
  const [fallbackActive, setFallbackActive] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const scannerRef = useRef<Scanner | null>(null)
  const callbacks = useRef({ onClose, onScan })
  callbacks.current = { onClose, onScan }

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let scanner: Scanner | null = null
    let disposed = false
    let found = false
    setError("")
    setFallbackActive(false)
    setTorchSupported(false)
    setTorchOn(false)

    const startScanner = async () => {
      try {
        await nextFrame()
        const { Html5Qrcode } = await import("html5-qrcode")
        if (disposed) return
        await nextFrame()
        scanner = new Html5Qrcode(readerId, { verbose: false })
        scannerRef.current = scanner
        const scanConfig = { fps: 10, qrbox: { width: 260, height: 140 } }
        const onSuccess = (text: string) => {
          if (mode === "single" && found) return
          found = true
          if (playFeedback) scanFeedback(true)
          callbacks.current.onScan(text)
          if (mode === "single") callbacks.current.onClose()
        }
        const onDecodeError = () => undefined

        try {
          await scanner.start({ facingMode: "environment" }, scanConfig, onSuccess, onDecodeError)
        } catch (rearError) {
          if (disposed || isPermissionFailure(rearError)) throw rearError
          await releaseCamera(scanner, readerId)
          if (disposed) return
          const cameras = await Html5Qrcode.getCameras()
          if (!cameras.length) throw rearError
          scanner = new Html5Qrcode(readerId, { verbose: false })
          scannerRef.current = scanner
          await scanner.start(cameras[0].id, scanConfig, onSuccess, onDecodeError)
          if (!disposed) setFallbackActive(true)
        }

        if (disposed) {
          await releaseCamera(scanner, readerId)
          return
        }
        await nextFrame()
        const video = document.getElementById(readerId)?.querySelector("video")
        if (video) {
          video.playsInline = true
          video.autoplay = true
          video.muted = true
          video.defaultMuted = true
          video.setAttribute("playsinline", "true")
          video.setAttribute("autoplay", "true")
          video.setAttribute("muted", "true")
          if (video.paused) await video.play().catch(() => undefined)
        }
        try {
          const torch = scanner.getRunningTrackCameraCapabilities().torchFeature()
          setTorchSupported(torch.isSupported())
        } catch {
          setTorchSupported(false)
        }
      } catch (cause) {
        if (disposed) return
        setError(cameraMessage(cause, t))
      }
    }

    const frame = requestAnimationFrame(() => { void startScanner() })
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") callbacks.current.onClose() }
    window.addEventListener("keydown", escape)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.removeEventListener("keydown", escape)
      const current = scanner
      if (current) void releaseCamera(current, readerId)
      if (scannerRef.current === current) scannerRef.current = null
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
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex h-screen w-screen items-center justify-center px-4 py-4"
      style={{ height: "100dvh", backgroundColor: "rgba(0, 0, 0, 0.75)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("scanBarcode")}
    >
      <section className="mx-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/15 bg-surface shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 pt-[max(.75rem,env(safe-area-inset-top))] sm:pt-3">
          <div className="flex min-w-0 items-center gap-2 font-semibold text-ink"><Icon name="camera" className="size-5 text-brand" />{t("scanBarcode")}</div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { if (torchSupported) void toggleTorch() }} disabled={!torchSupported} aria-pressed={torchOn} aria-label={torchSupported ? t("toggleTorch") : t("torchUnavailable")} title={torchSupported ? t("toggleTorch") : t("torchUnavailable")} className={"grid size-11 place-items-center rounded-full " + (torchOn ? "bg-accent text-brand-deep" : "text-ink2 hover:bg-surface2 disabled:opacity-40")}><Icon name="sparkle" className="size-5" /></button>
            <button type="button" onClick={onClose} aria-label={t("closeCamera")} className="grid size-12 place-items-center rounded-full text-ink2 hover:bg-surface2"><Icon name="x" className="size-5" /></button>
          </div>
        </header>
        <div id={readerId} className="mx-auto min-h-52 w-full overflow-hidden bg-black sm:min-h-64" />
        {fallbackActive && !error && <p role="status" className="px-4 pt-3 text-center text-sm text-ink2">{t("cameraFallbackInfo")}</p>}
        {error ? (
          <div className="space-y-3 p-4">
            <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">{error}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setError(""); setFallbackActive(false); setAttempt((value) => value + 1) }} className="h-11 rounded-xl bg-brand px-4 font-semibold text-on-brand">{t("retryCamera")}</button>
              <button type="button" onClick={onClose} className="h-11 rounded-xl border border-line2 px-4 font-semibold text-ink">{t("closeCamera")}</button>
            </div>
          </div>
        ) : <p className="p-4 text-center text-sm text-ink2">{t(mode === "continuous" ? "cameraContinuousHint" : "cameraHint")}</p>}
      </section>
    </div>,
    document.body,
  )
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

async function releaseCamera(scanner: Scanner, readerId: string) {
  try {
    if (scanner.isScanning) await scanner.stop()
  } catch {}
  const reader = document.getElementById(readerId)
  reader?.querySelectorAll("video").forEach((video) => {
    try { video.pause() } catch {}
    const stream = video.srcObject
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  })
  try { scanner.clear() } catch {}
}

function isPermissionFailure(cause: unknown) {
  const message = String((cause as Error)?.message ?? cause ?? "").toLowerCase()
  return /permission|denied|notallowed|not allowed|securityerror/.test(message)
}

function cameraMessage(cause: unknown, t: Translate) {
  const message = String((cause as Error)?.message ?? cause ?? "").toLowerCase()
  if (!window.isSecureContext) return t("cameraHttpsHelp")
  if (isPermissionFailure(cause)) return t("cameraPermissionHelp")
  return t("cameraRetryHelp")
}

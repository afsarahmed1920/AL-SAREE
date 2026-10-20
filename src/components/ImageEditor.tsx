import { useEffect, useRef, useState, type PointerEvent } from "react"
import { useApp } from "../lib/app-context"
import Icon from "./Icon"

const PREVIEW_SIZE = 640
const OUTPUT_SIZE = 800

export default function ImageEditor({ file, onCancel, onApply }: {
  file: File
  onCancel: () => void
  onApply: (image: Blob) => Promise<void>
}) {
  const { t } = useApp()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [rotation, setRotation] = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [zoom, setZoom] = useState(100)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [mode, setMode] = useState<"crop" | "adjust">("crop")

  useEffect(() => {
    let active = true
    setReady(false)
    void createImageBitmap(file, { imageOrientation: "from-image" }).then((bitmap) => {
      if (!active) { bitmap.close(); return }
      bitmapRef.current = bitmap
      setRotation(0)
      setBrightness(100)
      setContrast(100)
      setZoom(100)
      setOffset({ x: 0, y: 0 })
      setReady(true)
    }).catch(() => {
      if (active) setError(t("imageEditFailed"))
    })
    return () => {
      active = false
      bitmapRef.current?.close()
      bitmapRef.current = null
    }
  }, [file, t])

  useEffect(() => {
    const canvas = canvasRef.current
    const bitmap = bitmapRef.current
    if (!canvas || !bitmap || !ready) return
    const context = canvas.getContext("2d")
    if (!context) return
    renderCrop(context, bitmap, PREVIEW_SIZE, rotation, brightness, contrast, zoom / 100, offset)
  }, [ready, rotation, brightness, contrast, zoom, offset])

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY }
  }
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const previous = dragRef.current
    if (!previous) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const scale = PREVIEW_SIZE / Math.max(1, bounds.width)
    const dx = (event.clientX - previous.x) * scale
    const dy = (event.clientY - previous.y) * scale
    dragRef.current = { x: event.clientX, y: event.clientY }
    setOffset((current) => ({ x: current.x + dx, y: current.y + dy }))
  }

  const apply = async () => {
    const bitmap = bitmapRef.current
    if (!bitmap) return
    setBusy(true)
    setError("")
    try {
      const canvas = document.createElement("canvas")
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Canvas unavailable")
      renderCrop(context, bitmap, OUTPUT_SIZE, rotation, brightness, contrast, zoom / 100, {
        x: offset.x * OUTPUT_SIZE / PREVIEW_SIZE,
        y: offset.y * OUTPUT_SIZE / PREVIEW_SIZE,
      })
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Image encoding failed")), "image/webp", 0.88))
      await onApply(blob)
    } catch {
      setError(t("imageEditFailed"))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("imageEditorTitle")}>
      <section className="my-auto w-full max-w-lg rounded-3xl border border-line bg-surface p-4 shadow-2xl sm:p-5">
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-ink">{t("imageEditorTitle")}</h2>
          <button type="button" disabled={busy} onClick={onCancel} aria-label={t("cancel")} className="grid size-10 place-items-center rounded-full text-ink2 hover:bg-surface2"><Icon name="x" /></button>
        </header>
        <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-black">
          <canvas
            ref={canvasRef}
            width={PREVIEW_SIZE}
            height={PREVIEW_SIZE}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => { dragRef.current = null }}
            onPointerCancel={() => { dragRef.current = null }}
            className="absolute inset-0 size-full touch-none object-contain"
          />
          {mode === "crop" && (
            <div className="pointer-events-none absolute inset-0 border-2 border-white/80 shadow-[inset_0_0_0_999px_rgba(0,0,0,0.08)]" aria-hidden="true">
              <span className="absolute inset-y-0 left-1/3 border-s border-white/40" />
              <span className="absolute inset-y-0 left-2/3 border-s border-white/40" />
              <span className="absolute inset-x-0 top-1/3 border-t border-white/40" />
              <span className="absolute inset-x-0 top-2/3 border-t border-white/40" />
            </div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface2 p-1">
          <button type="button" aria-pressed={mode === "crop"} onClick={() => setMode("crop")}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${mode === "crop" ? "bg-surface text-ink shadow-sm" : "text-ink2"}`}>
            <Icon name="scan" className="size-4" /> {t("squareCrop")}
          </button>
          <button type="button" aria-pressed={mode === "adjust"} onClick={() => setMode("adjust")}
            className={`inline-flex h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold ${mode === "adjust" ? "bg-surface text-ink shadow-sm" : "text-ink2"}`}>
            {t("adjustImage")}
          </button>
        </div>
        {mode === "crop" ? (
          <>
            <p className="mt-2 text-center text-xs text-ink2">{t("cropFrameHint")}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => setRotation((value) => value - 90)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line2 px-3 text-sm font-medium text-ink"><Icon name="left" className="size-4" />{t("rotateLeft")}</button>
              <button type="button" onClick={() => setRotation((value) => value + 90)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line2 px-3 text-sm font-medium text-ink"><Icon name="right" className="size-4" />{t("rotateRight")}</button>
            </div>
            <div className="mt-3">
              <Range label={t("zoom")} value={zoom} min={100} max={300} onChange={setZoom} />
            </div>
          </>
        ) : (
          <div className="mt-4 grid gap-3">
            <Range label={t("brightness")} value={brightness} min={60} max={140} onChange={setBrightness} />
            <Range label={t("contrast")} value={contrast} min={60} max={160} onChange={setContrast} />
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="h-11 rounded-xl border border-line2 px-4 text-sm font-semibold text-ink">{t("cancel")}</button>
          <button type="button" disabled={busy || !ready} onClick={() => void apply()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50">
            {busy && <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
            {t("applyImage")}
          </button>
        </div>
      </section>
    </div>
  )
}

function Range({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-ink2">
      <span className="flex justify-between gap-2"><span>{label}</span><span>{value}%</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-brand" />
    </label>
  )
}

function renderCrop(context: CanvasRenderingContext2D, bitmap: ImageBitmap, side: number, rotation: number, brightness: number, contrast: number, zoom: number, offset: { x: number; y: number }) {
  context.clearRect(0, 0, side, side)
  context.fillStyle = "#111827"
  context.fillRect(0, 0, side, side)
  const radians = rotation * Math.PI / 180
  const rotatedWidth = Math.abs(bitmap.width * Math.cos(radians)) + Math.abs(bitmap.height * Math.sin(radians))
  const rotatedHeight = Math.abs(bitmap.width * Math.sin(radians)) + Math.abs(bitmap.height * Math.cos(radians))
  const scale = side / Math.min(rotatedWidth, rotatedHeight) * zoom
  context.save()
  context.filter = `brightness(${brightness}%) contrast(${contrast}%)`
  context.translate(side / 2 + offset.x, side / 2 + offset.y)
  context.rotate(radians)
  context.scale(scale, scale)
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  context.restore()
}

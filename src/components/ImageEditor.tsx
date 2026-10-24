import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { useApp } from "../lib/app-context"
import Icon from "./Icon"

const PREVIEW_SIZE = 640
const OUTPUT_SIZE = 800
const MIN_CROP_SIZE = 96
type CropRect = { x: number; y: number; size: number }
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
type Drag = { kind: "move" | Handle; x: number; y: number; crop: CropRect }
type TranslationKey = Parameters<ReturnType<typeof useApp>["t"]>[0]

const handleLabels: Record<Handle, TranslationKey> = {
  n: "cropResizeNorth",
  s: "cropResizeSouth",
  e: "cropResizeEast",
  w: "cropResizeWest",
  ne: "cropResizeNorthEast",
  nw: "cropResizeNorthWest",
  se: "cropResizeSouthEast",
  sw: "cropResizeSouthWest",
}

const handlePosition: Record<Handle, string> = {
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 h-11 w-12 cursor-ns-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 h-11 w-12 cursor-ns-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 h-12 w-11 cursor-ew-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-11 cursor-ew-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 size-11 cursor-nesw-resize",
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 size-11 cursor-nwse-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 size-11 cursor-nwse-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 size-11 cursor-nesw-resize",
}

export default function ImageEditor({ source, onCancel, onApply }: {
  source: File | string
  onCancel: () => void
  onApply: (image: Blob) => Promise<void>
}) {
  const { t } = useApp()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [rotation, setRotation] = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [mode, setMode] = useState<"crop" | "adjust">("crop")

  useEffect(() => {
    let active = true
    setReady(false)
    setError("")
    setCrop(null)
    void loadBitmap(source).then((bitmap) => {
      if (!active) { bitmap.close(); return }
      bitmapRef.current = bitmap
      setRotation(0)
      setBrightness(100)
      setContrast(100)
      setCrop(createInitialCrop(bitmap, 0))
      setReady(true)
    }).catch(() => {
      if (active) setError(t("imageEditFailed"))
    })
    return () => {
      active = false
      bitmapRef.current?.close()
      bitmapRef.current = null
    }
  }, [source, t])

  useEffect(() => {
    const canvas = canvasRef.current
    const bitmap = bitmapRef.current
    if (!canvas || !bitmap || !ready) return
    const context = canvas.getContext("2d")
    if (!context) return
    drawImage(context, bitmap, PREVIEW_SIZE, rotation, brightness, contrast)
  }, [ready, rotation, brightness, contrast])

  const changeRotation = (next: number) => {
    const bitmap = bitmapRef.current
    if (bitmap) setCrop((current) => fitCrop(current, bitmap, next))
    setRotation(next)
  }

  const beginDrag = (event: PointerEvent<HTMLElement>, kind: Drag["kind"]) => {
    if (!crop || !stageRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { kind, x: event.clientX, y: event.clientY, crop }
  }

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const bitmap = bitmapRef.current
    const stage = stageRef.current
    if (!drag || !bitmap || !stage) return
    const bounds = imageBounds(bitmap, rotation)
    const scale = PREVIEW_SIZE / Math.max(1, stage.getBoundingClientRect().width)
    setCrop(resizeOrMoveCrop(drag.crop, drag.kind, (event.clientX - drag.x) * scale, (event.clientY - drag.y) * scale, bounds))
  }

  const stopDrag = () => { dragRef.current = null }

  const moveByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) || !crop || !bitmapRef.current) return
    event.preventDefault()
    const step = event.shiftKey ? 16 : 4
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
    setCrop(resizeOrMoveCrop(crop, "move", dx, dy, imageBounds(bitmapRef.current, rotation)))
  }

  const resizeByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, handle: Handle) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) || !crop || !bitmapRef.current) return
    event.preventDefault()
    const dx = event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0
    const dy = event.key === "ArrowUp" ? -8 : event.key === "ArrowDown" ? 8 : 0
    setCrop(resizeOrMoveCrop(crop, handle, dx, dy, imageBounds(bitmapRef.current, rotation)))
  }

  const apply = async () => {
    const bitmap = bitmapRef.current
    if (!bitmap || !crop) return
    setBusy(true)
    setError("")
    try {
      const output = document.createElement("canvas")
      output.width = OUTPUT_SIZE
      output.height = OUTPUT_SIZE
      const outputContext = output.getContext("2d")
      if (!outputContext) throw new Error("Canvas unavailable")
      outputContext.imageSmoothingQuality = "high"
      drawCroppedImage(outputContext, bitmap, crop, rotation, brightness, contrast)
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((result) => result ? resolve(result) : reject(new Error("Image encoding failed")), "image/webp", 0.9))
      await onApply(blob)
    } catch {
      setError(t(typeof source === "string" ? "imageUpdateFailed" : "imageEditFailed"))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="image-editor-title">
      <section className="my-auto w-full max-w-lg rounded-3xl border border-line bg-surface p-4 shadow-2xl sm:p-5">
        <header className="mb-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line2 px-3 text-sm font-semibold text-ink disabled:opacity-50">
            <Icon name="x" className="size-4" />{t("cancel")}
          </button>
          <button type="button" disabled={busy || !ready || !crop} onClick={() => void apply()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-on-brand disabled:opacity-50">
            {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="check" className="size-4" />}
            {t("applyCrop")}
          </button>
          <h2 id="image-editor-title" className="col-span-2 text-center font-display text-base font-semibold text-ink">{t("imageEditorTitle")}</h2>
        </header>
        <div ref={stageRef} className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-black">
          <canvas ref={canvasRef} width={PREVIEW_SIZE} height={PREVIEW_SIZE} className="absolute inset-0 size-full" />
          {mode === "crop" && crop && (
            <div
              className="absolute touch-none border-2 border-white shadow-[0_0_0_999px_rgba(0,0,0,0.48)]"
              style={{ left: (crop.x / PREVIEW_SIZE * 100) + "%", top: (crop.y / PREVIEW_SIZE * 100) + "%", width: (crop.size / PREVIEW_SIZE * 100) + "%", height: (crop.size / PREVIEW_SIZE * 100) + "%" }}
              onPointerDown={(event) => beginDrag(event, "move")}
              onPointerMove={moveDrag}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
              onKeyDown={moveByKeyboard}
              tabIndex={0}
              aria-label={t("cropMove")}
              role="group"
            >
              {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as Handle[]).map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-label={t(handleLabels[handle])}
                  onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, handle) }}
                  onPointerMove={moveDrag}
                  onPointerUp={stopDrag}
                  onPointerCancel={stopDrag}
                  onKeyDown={(event) => resizeByKeyboard(event, handle)}
                  className={"absolute z-10 rounded-full border-2 border-brand-deep bg-white shadow " + handlePosition[handle]}
                />
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface2 p-1">
          <button type="button" aria-pressed={mode === "crop"} onClick={() => setMode("crop")}
            className={"inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold " + (mode === "crop" ? "bg-surface text-ink shadow-sm" : "text-ink2")}>
            <Icon name="scan" className="size-4" /> {t("squareCrop")}
          </button>
          <button type="button" aria-pressed={mode === "adjust"} onClick={() => setMode("adjust")}
            className={"inline-flex h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold " + (mode === "adjust" ? "bg-surface text-ink shadow-sm" : "text-ink2")}>
            {t("adjustImage")}
          </button>
        </div>
        {mode === "crop" ? (
          <>
            <p className="mt-2 text-center text-xs text-ink2">{t("cropFrameHint")}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => changeRotation(rotation - 90)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line2 px-3 text-sm font-medium text-ink"><Icon name="left" className="size-4" />{t("rotateLeft")}</button>
              <button type="button" onClick={() => changeRotation(rotation + 90)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line2 px-3 text-sm font-medium text-ink"><Icon name="right" className="size-4" />{t("rotateRight")}</button>
            </div>
          </>
        ) : (
          <div className="mt-4 grid gap-3">
            <Range label={t("brightness")} value={brightness} min={60} max={140} onChange={setBrightness} />
            <Range label={t("contrast")} value={contrast} min={60} max={160} onChange={setContrast} />
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      </section>
    </div>
  )
}

async function loadBitmap(source: File | string) {
  if (typeof source !== "string") return createImageBitmap(source, { imageOrientation: "from-image" })
  const image = new Image()
  image.crossOrigin = "anonymous"
  image.decoding = "async"
  image.src = source
  await image.decode()
  return createImageBitmap(image)
}

function rotatedSize(bitmap: ImageBitmap, rotation: number) {
  const radians = rotation * Math.PI / 180
  return {
    width: Math.abs(bitmap.width * Math.cos(radians)) + Math.abs(bitmap.height * Math.sin(radians)),
    height: Math.abs(bitmap.width * Math.sin(radians)) + Math.abs(bitmap.height * Math.cos(radians)),
  }
}

function imageBounds(bitmap: ImageBitmap, rotation: number) {
  const rotated = rotatedSize(bitmap, rotation)
  const scale = PREVIEW_SIZE / Math.max(rotated.width, rotated.height)
  const width = rotated.width * scale
  const height = rotated.height * scale
  const x = Math.max(0, (PREVIEW_SIZE - width) / 2)
  const y = Math.max(0, (PREVIEW_SIZE - height) / 2)
  return { x, y, right: Math.min(PREVIEW_SIZE, (PREVIEW_SIZE + width) / 2), bottom: Math.min(PREVIEW_SIZE, (PREVIEW_SIZE + height) / 2) }
}

function createInitialCrop(bitmap: ImageBitmap, rotation: number): CropRect {
  const bounds = imageBounds(bitmap, rotation)
  const size = Math.max(Math.min(MIN_CROP_SIZE, bounds.right - bounds.x, bounds.bottom - bounds.y), Math.min(bounds.right - bounds.x, bounds.bottom - bounds.y) * 0.82)
  return { x: bounds.x + (bounds.right - bounds.x - size) / 2, y: bounds.y + (bounds.bottom - bounds.y - size) / 2, size }
}

function fitCrop(crop: CropRect | null, bitmap: ImageBitmap, rotation: number): CropRect {
  const bounds = imageBounds(bitmap, rotation)
  if (!crop) return createInitialCrop(bitmap, rotation)
  const maxSize = Math.min(bounds.right - bounds.x, bounds.bottom - bounds.y)
  const size = Math.min(crop.size, maxSize)
  return { size, x: clamp(crop.x, bounds.x, bounds.right - size), y: clamp(crop.y, bounds.y, bounds.bottom - size) }
}

function resizeOrMoveCrop(crop: CropRect, kind: Drag["kind"], dx: number, dy: number, bounds: ReturnType<typeof imageBounds>): CropRect {
  const maxSize = Math.min(bounds.right - bounds.x, bounds.bottom - bounds.y)
  if (kind === "move") return {
    ...crop,
    x: clamp(crop.x + dx, bounds.x, bounds.right - crop.size),
    y: clamp(crop.y + dy, bounds.y, bounds.bottom - crop.size),
  }

  const east = kind.includes("e")
  const west = kind.includes("w")
  const north = kind.includes("n")
  const south = kind.includes("s")
  const horizontal = east || west
  const vertical = north || south
  const deltaX = east ? dx : west ? -dx : 0
  const deltaY = south ? dy : north ? -dy : 0
  const sizeDelta = horizontal && vertical ? (deltaX + deltaY) / 2 : horizontal ? deltaX : deltaY
  const size = clamp(crop.size + sizeDelta, Math.min(MIN_CROP_SIZE, maxSize), maxSize)
  let x = horizontal ? (west ? crop.x + crop.size - size : crop.x) : crop.x + (crop.size - size) / 2
  let y = vertical ? (north ? crop.y + crop.size - size : crop.y) : crop.y + (crop.size - size) / 2
  x = clamp(x, bounds.x, bounds.right - size)
  y = clamp(y, bounds.y, bounds.bottom - size)
  return { x, y, size }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function drawImage(context: CanvasRenderingContext2D, bitmap: ImageBitmap, side: number, rotation: number, brightness: number, contrast: number) {
  context.clearRect(0, 0, side, side)
  context.fillStyle = "#111827"
  context.fillRect(0, 0, side, side)
  const rotated = rotatedSize(bitmap, rotation)
  const scale = side / Math.max(rotated.width, rotated.height)
  context.save()
  context.filter = "brightness(" + brightness + "%) contrast(" + contrast + "%)"
  context.translate(side / 2, side / 2)
  context.rotate(rotation * Math.PI / 180)
  context.scale(scale, scale)
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  context.restore()
}

function drawCroppedImage(context: CanvasRenderingContext2D, bitmap: ImageBitmap, crop: CropRect, rotation: number, brightness: number, contrast: number) {
  const factor = OUTPUT_SIZE / crop.size
  const rotated = rotatedSize(bitmap, rotation)
  const scale = PREVIEW_SIZE / Math.max(rotated.width, rotated.height) * factor
  context.fillStyle = "#111827"
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  context.save()
  context.filter = "brightness(" + brightness + "%) contrast(" + contrast + "%)"
  context.translate((PREVIEW_SIZE / 2 - crop.x) * factor, (PREVIEW_SIZE / 2 - crop.y) * factor)
  context.rotate(rotation * Math.PI / 180)
  context.scale(scale, scale)
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  context.restore()
}

function Range({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-ink2">
      <span className="flex justify-between gap-2"><span>{label}</span><span>{value}%</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-brand" />
    </label>
  )
}

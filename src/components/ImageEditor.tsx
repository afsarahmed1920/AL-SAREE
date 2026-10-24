import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { useApp } from "../lib/app-context"
import Icon from "./Icon"

const PREVIEW_SIZE = 640
const OUTPUT_SIZE = 800
const MIN_CROP_SIZE = 32
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
  const cropRef = useRef<CropRect | null>(null)
  const frameRef = useRef<number | null>(null)
  const edgeRef = useRef<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [dragging, setDragging] = useState(false)
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
      const initialCrop = createInitialCrop(bitmap, 0)
      cropRef.current = initialCrop
      setCrop(initialCrop)
      setReady(true)
    }).catch(() => {
      if (active) setError(t("imageEditFailed"))
    })
    return () => {
      active = false
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
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
    if (bitmap) {
      const nextCrop = fitCrop(cropRef.current, bitmap, next)
      cropRef.current = nextCrop
      setCrop(nextCrop)
    }
    setRotation(next)
  }

  const beginDrag = (event: PointerEvent<HTMLElement>, kind: Drag["kind"]) => {
    const activeCrop = cropRef.current
    const bitmap = bitmapRef.current
    if (!activeCrop || !bitmap || !stageRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { kind, x: event.clientX, y: event.clientY, crop: activeCrop }
    edgeRef.current = touchedEdges(activeCrop, imageBounds(bitmap, rotation))
    setDragging(true)
  }

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const bitmap = bitmapRef.current
    const stage = stageRef.current
    if (!drag || !bitmap || !stage) return
    const bounds = imageBounds(bitmap, rotation)
    const scale = PREVIEW_SIZE / Math.max(1, stage.getBoundingClientRect().width)
    const next = resizeOrMoveCrop(drag.crop, drag.kind, (event.clientX - drag.x) * scale, (event.clientY - drag.y) * scale, bounds)
    cropRef.current = next
    if (drag.kind !== "move") {
      const nextEdges = touchedEdges(next, bounds)
      if ([...nextEdges].some((edge) => !edgeRef.current.has(edge))) navigator.vibrate?.(10)
      edgeRef.current = nextEdges
    }
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        setCrop(cropRef.current)
        frameRef.current = null
      })
    }
  }

  const stopDrag = () => {
    dragRef.current = null
    edgeRef.current.clear()
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    setCrop(cropRef.current)
    setDragging(false)
  }

  const moveByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) || !crop || !bitmapRef.current) return
    event.preventDefault()
    const step = event.shiftKey ? 16 : 4
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
    const next = resizeOrMoveCrop(crop, "move", dx, dy, imageBounds(bitmapRef.current, rotation))
    cropRef.current = next
    setCrop(next)
  }

  const resizeByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, handle: Handle) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) || !crop || !bitmapRef.current) return
    event.preventDefault()
    const dx = event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0
    const dy = event.key === "ArrowUp" ? -8 : event.key === "ArrowDown" ? 8 : 0
    const next = resizeOrMoveCrop(crop, handle, dx, dy, imageBounds(bitmapRef.current, rotation))
    cropRef.current = next
    setCrop(next)
  }

  const apply = async () => {
    const bitmap = bitmapRef.current
    const finalCrop = cropRef.current ?? crop
    if (!bitmap || !finalCrop) return
    setBusy(true)
    setError("")
    try {
      const output = document.createElement("canvas")
      output.width = OUTPUT_SIZE
      output.height = OUTPUT_SIZE
      const outputContext = output.getContext("2d")
      if (!outputContext) throw new Error("Canvas unavailable")
      outputContext.imageSmoothingQuality = "high"
      drawCroppedImage(outputContext, bitmap, finalCrop, rotation, brightness, contrast)
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((result) => result ? resolve(result) : reject(new Error("Image encoding failed")), "image/webp", 0.9))
      await onApply(blob)
    } catch {
      setError(t(typeof source === "string" ? "imageUpdateFailed" : "imageEditFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/65 text-white backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="image-editor-title">
      <section className="flex min-h-0 flex-1 flex-col px-4 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]">
        <header className="mx-auto grid w-full max-w-2xl grid-cols-[1fr_auto_1fr] items-center gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="inline-flex h-12 min-w-12 items-center justify-center gap-2 justify-self-start rounded-full bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur-md disabled:opacity-50">
            <Icon name="x" className="size-5" />{t("cancel")}
          </button>
          <button type="button" disabled={busy} onClick={() => changeRotation(rotation + 90)} className="grid size-12 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md disabled:opacity-50" aria-label={t("rotateRight")} title={t("rotateRight")}>
            <Icon name="rotate" className="size-5" />
          </button>
          <button type="button" disabled={busy || !ready || !crop} onClick={() => void apply()} className="inline-flex h-12 min-w-12 items-center justify-center gap-2 justify-self-end rounded-full bg-brand px-4 text-sm font-bold text-on-brand shadow-lg shadow-brand/20 disabled:opacity-50">
            {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="check" className="size-5" />}
            {t("applyCrop")}
          </button>
        </header>
        <h2 id="image-editor-title" className="mt-4 shrink-0 text-center font-display text-sm font-semibold text-white/80">{t("imageEditorTitle")}</h2>
        <div className="flex min-h-0 flex-1 items-center justify-center py-4">
          <div ref={stageRef} className="relative aspect-square max-h-full w-[min(92vw,64svh)] max-w-[640px] overflow-hidden rounded-2xl bg-[#111827] shadow-2xl shadow-black/30">
            <canvas ref={canvasRef} width={PREVIEW_SIZE} height={PREVIEW_SIZE} className="absolute inset-0 size-full" />
            {mode === "crop" && crop && (
              <div
                className="absolute touch-none border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]"
                style={{ left: (crop.x / PREVIEW_SIZE * 100) + "%", top: (crop.y / PREVIEW_SIZE * 100) + "%", width: (crop.size / PREVIEW_SIZE * 100) + "%", height: (crop.size / PREVIEW_SIZE * 100) + "%" }}
                onPointerDown={(event) => beginDrag(event, "move")}
                onPointerMove={moveDrag}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
                onLostPointerCapture={stopDrag}
                onKeyDown={moveByKeyboard}
                tabIndex={0}
                aria-label={t("cropMove")}
                role="group"
              >
                <div aria-hidden="true" className={"pointer-events-none absolute inset-0 transition-opacity duration-200 " + (dragging ? "opacity-100" : "opacity-0")}>
                  <span className="absolute inset-y-0 left-1/3 border-s border-white/55" />
                  <span className="absolute inset-y-0 left-2/3 border-s border-white/55" />
                  <span className="absolute inset-x-0 top-1/3 border-t border-white/55" />
                  <span className="absolute inset-x-0 top-2/3 border-t border-white/55" />
                </div>
                {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as Handle[]).map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    aria-label={t(handleLabels[handle])}
                    onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, handle) }}
                    onKeyDown={(event) => resizeByKeyboard(event, handle)}
                    className={"absolute z-10 grid touch-none place-items-center bg-transparent p-0 " + handlePosition[handle]}
                  >
                    {isCornerHandle(handle) ? <CornerBracket corner={handle} /> : <span aria-hidden="true" className={"rounded-full bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.4)] " + ((handle === "n" || handle === "s") ? "h-1 w-8" : "h-8 w-1")} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <footer className="mx-auto w-full max-w-lg shrink-0">
          <div className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/10 p-1 backdrop-blur-lg">
            <button type="button" aria-pressed={mode === "crop"} onClick={() => setMode("crop")}
              className={"inline-flex h-12 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors " + (mode === "crop" ? "bg-white text-slate-950" : "text-white/70")}>
              <Icon name="scan" className="size-4" /> {t("squareCrop")}
            </button>
            <button type="button" aria-pressed={mode === "adjust"} onClick={() => setMode("adjust")}
              className={"inline-flex h-12 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors " + (mode === "adjust" ? "bg-white text-slate-950" : "text-white/70")}>
              {t("adjustImage")}
            </button>
          </div>
          {mode === "crop" ? (
            <p className="mt-3 text-center text-xs text-white/65">{t("cropFrameHint")}</p>
          ) : (
            <div className="mt-3 grid gap-3 rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-lg">
              <Range dark label={t("brightness")} value={brightness} min={60} max={140} onChange={setBrightness} />
              <Range dark label={t("contrast")} value={contrast} min={60} max={160} onChange={setContrast} />
            </div>
          )}
          {error && <p role="alert" className="mt-3 rounded-xl bg-red-500/15 p-3 text-sm text-red-100">{error}</p>}
        </footer>
      </section>
    </div>
  )
}

function CornerBracket({ corner }: { corner: Extract<Handle, "ne" | "nw" | "se" | "sw"> }) {
  const paths = {
    nw: "M22 6H6v16",
    ne: "M26 6h16v16",
    sw: "M6 26v16h16",
    se: "M42 26v16H26",
  }
  return (
    <svg viewBox="0 0 48 48" className="size-full drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]" aria-hidden="true">
      <path d={paths[corner]} fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function isCornerHandle(handle: Handle): handle is Extract<Handle, "ne" | "nw" | "se" | "sw"> {
  return handle.length === 2
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

function touchedEdges(crop: CropRect, bounds: ReturnType<typeof imageBounds>) {
  const edges = new Set<string>()
  if (crop.x <= bounds.x + 0.5) edges.add("left")
  if (crop.y <= bounds.y + 0.5) edges.add("top")
  if (crop.x + crop.size >= bounds.right - 0.5) edges.add("right")
  if (crop.y + crop.size >= bounds.bottom - 0.5) edges.add("bottom")
  return edges
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

function Range({ label, value, min, max, onChange, dark = false }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; dark?: boolean }) {
  return (
    <label className={"grid gap-1 text-xs font-medium " + (dark ? "text-white/80" : "text-ink2")}>
      <span className="flex justify-between gap-2"><span>{label}</span><span>{value}%</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-brand" />
    </label>
  )
}

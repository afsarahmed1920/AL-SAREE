type CardInput = {
  name: string
  code: string
  priceLabel: string
  price: string
  imageUrl?: string
  company: string
  rtl: boolean
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Safari < 16 / older Android WebViews lack CanvasRenderingContext2D.roundRect.
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof g.roundRect === "function") return g.roundRect(x, y, w, h, r)
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

async function renderCard(input: CardInput): Promise<Blob> {
  const W = 1080
  const H = 1350
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext("2d")!
  const bg = g.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, "#0b1430")
  bg.addColorStop(1, "#1e3a8a")
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)

  const pad = 60
  const photoH = 860
  g.save()
  g.beginPath()
  roundRect(g, pad, pad, W - pad * 2, photoH, 48)
  g.clip()
  g.fillStyle = "#ffffff"
  g.fillRect(pad, pad, W - pad * 2, photoH)
  if (input.imageUrl) {
    try {
      const img = await loadImage(input.imageUrl)
      const bw = W - pad * 2
      const s = Math.max(bw / img.width, photoH / img.height)
      const w = img.width * s
      const h = img.height * s
      g.drawImage(img, pad + (bw - w) / 2, pad + (photoH - h) / 2, w, h)
    } catch {}
  }
  g.restore()

  if ("direction" in g) g.direction = input.rtl ? "rtl" : "ltr"
  g.textAlign = input.rtl ? "right" : "left"
  const x = input.rtl ? W - pad : pad
  const font = "'Readex Pro', 'IBM Plex Sans Arabic', system-ui, sans-serif"

  g.fillStyle = "#ffffff"
  g.font = `600 56px ${font}`
  let name = input.name
  while (g.measureText(name).width > W - pad * 2 && name.length > 4) name = name.slice(0, -2)
  if (name !== input.name) name += "…"
  g.fillText(name, x, photoH + pad + 100)

  g.fillStyle = "rgba(255,255,255,.6)"
  g.font = `400 34px ${font}`
  g.fillText(`${input.code} · ${input.company}`, x, photoH + pad + 155)

  g.fillStyle = "#ff8a00"
  g.beginPath()
  roundRect(g, pad, H - pad - 150, W - pad * 2, 150, 36)
  g.fill()
  g.fillStyle = "#0d1426"
  const px = input.rtl ? W - pad - 40 : pad + 40
  g.font = `500 32px ${font}`
  g.fillText(input.priceLabel, px, H - pad - 92)
  g.font = `700 62px ${font}`
  g.fillText(input.price, px, H - pad - 30)

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.9),
  )
}

/** Shares an image card via the native share sheet (WhatsApp appears there); falls back to wa.me text. */
export async function shareProductCard(input: CardInput, fallbackText: string) {
  try {
    const blob = await renderCard(input)
    const file = new File([blob], `${input.code}.jpg`, { type: "image/jpeg" })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: fallbackText })
      return
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(fallbackText)}`, "_blank", "noopener,noreferrer")
}

const MAX_SIDE = 800
const MAX_BYTES = 70 * 1024

function toBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image encode failed"))),
      "image/webp",
      quality,
    ),
  )
}

export async function compressToWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    let best: Blob | null = null

    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Canvas unavailable")
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of [0.76, 0.68, 0.6, 0.52, 0.45]) {
        best = await toBlob(canvas, quality)
        if (best.size <= MAX_BYTES) return best
      }
      scale *= 0.85
    }
    if (!best) throw new Error("Image encode failed")
    return best
  } finally {
    bitmap.close()
  }
}

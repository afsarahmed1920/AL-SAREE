import { useRef, useState } from "react"
import { useApp } from "../lib/app-context"
import { makeDraftImage, replaceStoredProductImage, type DraftImage } from "../lib/products"
import { compressToWebp } from "../lib/images"
import Icon from "./Icon"
import ImageEditor from "./ImageEditor"
import { useFeedback } from "./FeedbackProvider"

const tool =
  "grid size-8 place-items-center rounded-md bg-black/60 text-white backdrop-blur transition hover:bg-black/80 disabled:opacity-30"
const imageActionTool =
  "grid size-11 place-items-center rounded-lg bg-black/60 text-white backdrop-blur transition hover:bg-black/80 disabled:opacity-30"

export default function ImageManager({ images, onChange, productId, disabled }: {
  images: DraftImage[]
  onChange: (next: DraftImage[]) => void
  productId: string
  disabled?: boolean
}) {
  const { t } = useApp()
  const { confirm, toast } = useFeedback()
  const gallery = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const replaceKey = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [cropImage, setCropImage] = useState<DraftImage | null>(null)

  const normalise = (list: DraftImage[]) =>
    list.map((image, index) => ({
      ...image,
      is_primary: list.some((i) => i.is_primary) ? image.is_primary : index === 0,
    }))

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    replaceKey.current = null
    setPendingFiles([...files])
  }

  const replace = async (files: FileList | null) => {
    const key = replaceKey.current
    if (!files?.[0] || !key) return
    setPendingFiles([files[0]])
  }

  const applyEditedImage = async (blob: Blob) => {
    if (cropImage?.id) {
      const file = new File([blob], `product-${productId}.webp`, { type: "image/webp" })
      const optimized = await compressToWebp(file)
      const stored = await replaceStoredProductImage(productId, cropImage.id, optimized)
      onChange(images.map((image) => image.id === cropImage.id ? {
        ...image,
        storage_path: stored.storage_path,
        url: stored.url,
        blob: undefined,
      } : image))
      toast("success", t("imageUpdated"))
      if (!stored.oldFileRemoved) toast("info", t("imageOldFileCleanupFailed"))
      setCropImage(null)
      return
    }

    const file = pendingFiles[0]
    if (!file) return
    setBusy(true)
    try {
      const fresh = await makeDraftImage(new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" }))
      const key = replaceKey.current
      if (key) {
        const previous = images.find((image) => image.key === key)
        if (previous?.blob) URL.revokeObjectURL(previous.url)
        onChange(images.map((image) => image.key === key ? { ...fresh, is_primary: image.is_primary } : image))
      }
      else onChange(normalise([...images, fresh]))
      setPendingFiles((files) => files.slice(1))
      if (key) replaceKey.current = null
    } finally {
      setBusy(false)
    }
  }

  const move = (index: number, delta: number) => {
    const next = [...images]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    onChange(next)
  }

  const remove = async (key: string) => {
    if (!await confirm({ title: t("removeImageTitle"), message: t("removeImageMessage"), confirmLabel: t("remove") })) return
    const target = images.find((i) => i.key === key)
    if (target?.blob) URL.revokeObjectURL(target.url)
    onChange(normalise(images.filter((i) => i.key !== key)))
  }

  const primary = (key: string) => onChange(images.map((i) => ({ ...i, is_primary: i.key === key })))

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((image, index) => (
          <figure key={image.key} className="group relative overflow-hidden rounded-xl border border-line bg-surface2">
            <button type="button" onClick={() => setPreview(image.url)} className="block w-full" aria-label={t("preview")}>
              <img src={image.url} alt="" className="aspect-square w-full object-cover" />
            </button>
            {image.is_primary && (
              <span className="absolute start-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-brand-deep">
                {t("primary")}
              </span>
            )}
            {!disabled && (
              <figcaption className="absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-1 bg-gradient-to-t from-black/50 to-transparent p-2">
                <button type="button" className={tool} disabled={index === 0} onClick={() => move(index, -1)} title={t("moveEarlier")} aria-label={t("moveEarlier")}>
                  <Icon name="left" className="size-4 rtl:-scale-x-100" />
                </button>
                <button type="button" className={tool} disabled={index === images.length - 1} onClick={() => move(index, 1)} title={t("moveLater")} aria-label={t("moveLater")}>
                  <Icon name="right" className="size-4 rtl:-scale-x-100" />
                </button>
                <button type="button" className={tool} disabled={image.is_primary} onClick={() => primary(image.key)} title={t("makePrimary")} aria-label={t("makePrimary")}>
                  <Icon name="star" className="size-4" />
                </button>
                <button type="button" className={tool} onClick={() => { replaceKey.current = image.key; replaceInput.current?.click() }} title={t("replace")} aria-label={t("replace")}>
                  <Icon name="upload" className="size-4" />
                </button>
                {image.id && image.storage_path && (
                  <button type="button" className={imageActionTool} disabled={busy} onClick={() => setCropImage(image)} title={t("editCrop")} aria-label={t("editCrop")}>
                    <Icon name="pencil" className="size-4" />
                  </button>
                )}
                <button type="button" className={imageActionTool} onClick={() => remove(image.key)} title={t("remove")} aria-label={t("remove")}>
                  <Icon name="trash" className="size-4" />
                </button>
              </figcaption>
            )}
          </figure>
        ))}

        {!disabled && (
          <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-line2 bg-app p-3">
            <div className="flex flex-col gap-2">
              <button type="button" disabled={busy} onClick={() => gallery.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-on-brand disabled:opacity-50">
                <Icon name="image" className="size-4" /> {t("addPhotos")}
              </button>
              <button type="button" disabled={busy} onClick={() => camera.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-line2 bg-surface px-3 text-sm font-medium text-ink disabled:opacity-50">
                <Icon name="camera" className="size-4" /> {t("takePhoto")}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-ink2">{busy ? t("processing") : t("imagesHint")}</p>

      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = "" }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void add(e.target.files); e.target.value = "" }} />
      <input ref={replaceInput} type="file" accept="image/*" hidden onChange={(e) => { void replace(e.target.files); e.target.value = "" }} />

      {preview && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={() => setPreview(null)} role="dialog" aria-modal="true">
          <img src={preview} alt="" className="max-h-full max-w-full rounded-xl" />
          <button className="absolute end-4 top-4 grid size-10 place-items-center rounded-full bg-white/15 text-white" aria-label={t("close")}>
            <Icon name="x" />
          </button>
        </div>
      )}
      {(cropImage || pendingFiles[0]) && (
        <ImageEditor
          source={cropImage?.url ?? pendingFiles[0]}
          onCancel={() => {
            if (cropImage) setCropImage(null)
            else { setPendingFiles([]); replaceKey.current = null }
          }}
          onApply={applyEditedImage}
        />
      )}
    </div>
  )
}

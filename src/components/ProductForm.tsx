import { useCallback, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useApp } from "../lib/app-context"
import { generateEan13 } from "../lib/code128"
import {
  can,
  nextProductCode,
  saveDraft,
  type BranchDraft,
  type BranchRow,
  type CategoryRow,
  type Profile,
  type ProductDraft,
} from "../lib/products"
import ImageManager from "./ImageManager"
import Icon from "./Icon"
import GlobalScannerDialog from "./GlobalScannerDialog"

const input =
  "h-11 w-full rounded-xl border border-line2 bg-app px-3.5 text-ink outline-none focus:border-focus focus:ring-2 focus:ring-focus/20 disabled:opacity-60"
const card = "rounded-2xl border border-line bg-surface p-5 sm:p-6"

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium text-ink2 ${className}`}>
      {label}
      {children}
    </label>
  )
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 text-sm font-medium text-ink ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      {label}
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-brand" : "bg-line2"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? "start-[22px]" : "start-0.5"}`} />
      </button>
    </label>
  )
}

function PriceField({ label, value, onChange, editable, secret }: {
  label: string
  value: string
  onChange: (v: string) => void
  editable: boolean
  secret?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const { t } = useApp()
  const hidden = secret && !revealed
  return (
    <Field label={label}>
      <div className="relative">
        <input
          type="number" min={0} step="0.01" inputMode="decimal" dir="ltr"
          value={value} disabled={!editable}
          onChange={(e) => onChange(e.target.value)}
          className={`${input} ${hidden ? "select-none blur-md" : ""} ${secret ? "pe-12" : ""}`}
          tabIndex={hidden ? -1 : 0}
        />
        {secret && (
          <button type="button" onClick={() => setRevealed(!revealed)}
            aria-label={revealed ? t("hideBuying") : t("revealBuying")}
            className="absolute end-1.5 top-1.5 grid size-8 place-items-center rounded-lg text-ink2 hover:bg-surface2">
            <Icon name={revealed ? "eyeOff" : "eye"} className="size-4" />
          </button>
        )}
      </div>
      {!editable && <span className="text-xs font-normal">{t("readOnly")}</span>}
    </Field>
  )
}

export default function ProductForm({ initial, original, profile, branches, categories, onCancel, onSaved, onSticker }: {
  initial: ProductDraft
  original: ProductDraft | null
  profile: Profile
  branches: BranchRow[]
  categories: CategoryRow[]
  onCancel: () => void
  onSaved: (saved: { id: string; code: string }) => void
  onSticker: (draft: ProductDraft, retail: number | null) => void
}) {
  const { t, lang } = useApp()
  const [draft, setDraft] = useState(initial)
  const [tab, setTab] = useState(
    () => branches.find((b) => initial.branches[b.id]?.available)?.id ?? branches[0]?.id ?? "",
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [newCategory, setNewCategory] = useState(false)
  const [barcodeCameraOpen, setBarcodeCameraOpen] = useState(false)
  const [barcodeNotice, setBarcodeNotice] = useState("")
  const barcodesRef = useRef(draft.barcodes)
  barcodesRef.current = draft.barcodes
  const editProducts = can.editProducts(profile)
  const closeBarcodeCamera = useCallback(() => setBarcodeCameraOpen(false), [])

  const patch = (changes: Partial<ProductDraft>) => setDraft((d) => ({ ...d, ...changes }))
  const patchBranch = (id: string, changes: Partial<BranchDraft>) =>
    setDraft((d) => ({ ...d, branches: { ...d.branches, [id]: { ...d.branches[id], ...changes, touched: true } } }))

  const selected = branches.filter((b) => draft.branches[b.id]?.available)
  const allSelected = branches.length > 0 && selected.length === branches.length
  const effectiveTab = selected.some((b) => b.id === tab) ? tab : selected[0]?.id ?? ""

  const toggleBranch = (id: string) => {
    const on = !draft.branches[id]?.available
    patchBranch(id, { available: on })
    if (on) setTab(id)
  }
  const toggleAll = () => {
    const on = !allSelected
    setDraft((d) => ({
      ...d,
      branches: Object.fromEntries(
        Object.entries(d.branches).map(([id, b]) => [id, b.available === on ? b : { ...b, available: on, touched: true }]),
      ),
    }))
  }
  const copyPrices = (fromId: string) => {
    const src = draft.branches[fromId]
    patchBranch(effectiveTab, {
      ...(can.edit(profile, "purchase") ? { purchase: src.purchase } : {}),
      ...(can.edit(profile, "wholesale") ? { wholesale: src.wholesale } : {}),
      ...(can.edit(profile, "retail") ? { retail: src.retail } : {}),
    })
  }

  const tab_ = effectiveTab
  const branch = draft.branches[tab_]
  const activeBranch = branches.find((b) => b.id === tab_)
  const retailNumber = useMemo(() => {
    const n = Number(branch?.retail)
    return branch?.retail && Number.isFinite(n) ? n : null
  }, [branch?.retail])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    if (editProducts && (!draft.nameEn.trim() || !draft.code.trim())) {
      setError(t("nameRequired"))
      return
    }
    if (branches.length > 0 && selected.length === 0) {
      setError(t("selectBranch"))
      return
    }
    setSaving(true)
    try {
      if (!navigator.onLine) {
        const { enqueueSave } = await import("../lib/offline-queue")
        await enqueueSave({ draft, original, profile, branches })
        onSaved({ id: draft.id, code: draft.code })
      } else {
        onSaved(await saveDraft(draft, original, profile, branches))
      }
    } catch (err) {
      const message = (err as { message?: string })?.message ?? ""
      setError(
        message === "INVALID_NUMBER" ? t("invalidNumber")
        : message === "DUPLICATE_BARCODE" ? t("duplicateBarcode")
        : (err as { code?: string })?.code === "23505" ? `${t("saveFailed")}: ${draft.code}`
        : `${t("saveFailed")}: ${message}`,
      )
    } finally {
      setSaving(false)
    }
  }

  const setBarcode = (index: number, value: string) =>
    patch({ barcodes: draft.barcodes.length === 0 && index === 0 ? [value] : draft.barcodes.map((b, i) => (i === index ? value : b)) })

  const receiveBarcode = useCallback((value: string) => {
    const barcode = value.trim()
    if (!barcode) return
    if (barcodesRef.current.some((existing) => existing.trim() === barcode)) {
      setBarcodeNotice(t("barcodeAlreadyInProduct"))
      return
    }
    setBarcodeNotice("")
    setDraft((current) => {
      const emptyIndex = current.barcodes.findIndex((existing) => !existing.trim())
      const barcodes = [...current.barcodes]
      if (emptyIndex >= 0) barcodes[emptyIndex] = barcode
      else barcodes.push(barcode)
      return { ...current, barcodes }
    })
  }, [t])

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-5">
      <div className="sticky top-16 z-20 -mx-4 flex items-center justify-between gap-3 border-b border-line bg-app/90 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onCancel} aria-label={t("cancel")}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-line2 bg-surface text-ink">
            <Icon name="left" className="rtl:-scale-x-100" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold text-ink">
              {draft.isNew ? t("newProduct") : t("editProduct")}
            </h1>
            <p className="truncate text-xs text-ink2" dir="ltr">{draft.code}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!draft.isNew && (
            <button type="button" onClick={() => onSticker(draft, retailNumber)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-line2 bg-surface px-3 text-sm font-medium text-ink">
              <Icon name="print" className="size-4" />
              <span className="hidden sm:inline">{t("sticker")}</span>
            </button>
          )}
          <button disabled={saving} className="h-10 rounded-xl bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-60">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <section className={card}>
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">{t("sharedInfo")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("productCode")}>
            <div className="flex gap-2">
              <input dir="ltr" value={draft.code} disabled={!editProducts || draft.codeAuto}
                onChange={(e) => patch({ code: e.target.value })} className={input} />
              {draft.isNew && editProducts && (
                <button type="button" className="h-11 shrink-0 rounded-xl border border-line2 px-3 text-sm font-medium text-ink"
                  onClick={async () => {
                    const auto = !draft.codeAuto
                    patch({ codeAuto: auto, code: auto ? await nextProductCode() : draft.code })
                  }}>
                  {draft.codeAuto ? t("manualCode") : t("autoCode")}
                </button>
              )}
            </div>
          </Field>
          <Field label={t("category")}>
            <div className="flex gap-2">
              <select value={draft.categoryId} disabled={!editProducts || newCategory}
                onChange={(e) => patch({ categoryId: e.target.value })} className={input}>
                <option value="">{t("uncategorized")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{lang === "ar" ? c.name_ar : c.name_en}</option>
                ))}
              </select>
              {editProducts && (
                <button type="button" onClick={() => { setNewCategory(!newCategory); patch({ newCategoryEn: "", newCategoryAr: "" }) }}
                  aria-label={t("newCategory")} title={t("newCategory")}
                  className={`grid size-11 shrink-0 place-items-center rounded-xl border border-line2 ${newCategory ? "bg-brand text-on-brand" : "text-ink"}`}>
                  <Icon name={newCategory ? "x" : "plus"} className="size-4" />
                </button>
              )}
            </div>
          </Field>
          {newCategory && (
            <>
              <Field label={t("newCategoryEn")}>
                <input value={draft.newCategoryEn} onChange={(e) => patch({ newCategoryEn: e.target.value })} className={input} />
              </Field>
              <Field label={t("newCategoryAr")}>
                <input dir="rtl" value={draft.newCategoryAr} onChange={(e) => patch({ newCategoryAr: e.target.value })} className={input} />
              </Field>
            </>
          )}
          <Field label={t("nameEn")}>
            <input value={draft.nameEn} disabled={!editProducts} onChange={(e) => patch({ nameEn: e.target.value })} className={input} />
          </Field>
          <Field label={t("nameAr")}>
            <input dir="rtl" value={draft.nameAr} disabled={!editProducts} onChange={(e) => patch({ nameAr: e.target.value })} className={input} />
          </Field>
          <Field label={t("descEn")}>
            <textarea rows={3} value={draft.descEn} disabled={!editProducts} onChange={(e) => patch({ descEn: e.target.value })} className={`${input} h-auto py-2.5`} />
          </Field>
          <Field label={t("descAr")}>
            <textarea dir="rtl" rows={3} value={draft.descAr} disabled={!editProducts} onChange={(e) => patch({ descAr: e.target.value })} className={`${input} h-auto py-2.5`} />
          </Field>
        </div>
      </section>

      <section className={card}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-ink">{t("barcodes")}</h2>
          {editProducts && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => patch({ barcodes: [...draft.barcodes, generateEan13()] })}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-brand-deep">
                <Icon name="sparkle" className="size-4" /> {t("generateBarcode")}
              </button>
              <button type="button" onClick={() => patch({ barcodes: [...draft.barcodes, ""] })}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line2 px-3 text-sm font-medium text-ink">
                <Icon name="plus" className="size-4" /> {t("addBarcode")}
              </button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          {draft.barcodes.length === 0 && !editProducts ? (
            <p className="text-sm text-ink2">{t("noBarcodeYet")}</p>
          ) : (draft.barcodes.length ? draft.barcodes : [""]).map((value, index) => (
            <div key={index} className="flex gap-2">
              <input dir="ltr" value={value} disabled={!editProducts} placeholder={t("barcodePlaceholder")}
                onChange={(e) => setBarcode(index, e.target.value)} className={`${input} font-mono`} />
              {editProducts && (
                <>
                  <button type="button" aria-label={t("scanIntoProduct")} title={t("scanIntoProduct")}
                    onClick={() => { setBarcodeNotice(""); setBarcodeCameraOpen(true) }}
                    className="grid size-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border border-line2 bg-surface text-ink hover:bg-surface2">
                    <Icon name="camera" className="size-5" />
                  </button>
                  {draft.barcodes.length > 0 && (
                    <button type="button" aria-label={t("remove")}
                      onClick={() => patch({ barcodes: draft.barcodes.filter((_, i) => i !== index) })}
                      className="grid size-11 shrink-0 place-items-center rounded-xl border border-line2 text-ink2 hover:text-red-600">
                      <Icon name="trash" className="size-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        {barcodeNotice && <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{barcodeNotice}</p>}
      </section>

      <GlobalScannerDialog
        open={barcodeCameraOpen}
        onClose={closeBarcodeCamera}
        onScan={receiveBarcode}
        readerId="product-barcode-reader"
      />

      <section className={card}>
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">{t("images")}</h2>
        <ImageManager images={draft.images} onChange={(images) => patch({ images })} disabled={!editProducts} />
      </section>

      <section className={card}>
        {branches.length === 0 ? (
          <p className="text-sm text-ink2">{t("noBranchAccess")}</p>
        ) : (
          <>
            <div className="mb-5">
              <div className="mb-2 text-sm font-medium text-ink2">{t("soldIn")}</div>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => {
                  const on = !!draft.branches[b.id]?.available
                  return (
                    <button key={b.id} type="button" aria-pressed={on} disabled={!editProducts} onClick={() => toggleBranch(b.id)}
                      className={`h-11 rounded-xl border px-4 text-sm font-semibold transition disabled:opacity-60 ${on ? "border-brand bg-brand text-on-brand" : "border-line2 bg-app text-ink2"}`}>
                      {lang === "ar" ? b.name_ar : b.name_en}
                    </button>
                  )
                })}
                {branches.length > 1 && (
                  <button type="button" aria-pressed={allSelected} disabled={!editProducts} onClick={toggleAll}
                    className={`h-11 rounded-xl border px-4 text-sm font-semibold transition disabled:opacity-60 ${allSelected ? "border-brand bg-brand text-on-brand" : "border-line2 bg-app text-ink2"}`}>
                    {t("bothBranches")}
                  </button>
                )}
              </div>
              {selected.length === 0 && <p className="mt-2 text-sm text-red-500">{t("selectBranch")}</p>}
            </div>

            {selected.length > 0 && (
              <div role="tablist" className="mb-5 inline-flex rounded-xl bg-surface2 p-1">
                {selected.map((b) => (
                  <button key={b.id} type="button" role="tab" aria-selected={tab_ === b.id} onClick={() => setTab(b.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${tab_ === b.id ? "bg-surface text-ink shadow-sm" : "text-ink2"}`}>
                    {lang === "ar" ? b.name_ar : b.name_en}
                  </button>
                ))}
              </div>
            )}

            {branch && activeBranch && (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("branchCode")}>
                    <input dir="ltr" value={branch.branchCode} disabled={!editProducts}
                      onChange={(e) => patchBranch(tab_, { branchCode: e.target.value })} className={input} />
                  </Field>
                </div>

                {selected.filter((b) => b.id !== tab_).map((b) => (
                  <button key={b.id} type="button" onClick={() => copyPrices(b.id)}
                    className="inline-flex h-10 items-center rounded-lg border border-line2 px-3 text-sm font-medium text-ink hover:bg-surface2">
                    {t("copyPricesFrom")} {lang === "ar" ? b.name_ar : b.name_en}
                  </button>
                ))}

                <div className="grid gap-4 sm:grid-cols-3">
                  {can.view(profile, "purchase") && (
                    <PriceField secret label={t("purchasePrice")} value={branch.purchase} editable={can.edit(profile, "purchase")}
                      onChange={(v) => patchBranch(tab_, { purchase: v })} />
                  )}
                  {can.view(profile, "wholesale") && (
                    <PriceField label={t("wholesalePriceSar")} value={branch.wholesale} editable={can.edit(profile, "wholesale")}
                      onChange={(v) => patchBranch(tab_, { wholesale: v })} />
                  )}
                  {can.view(profile, "retail") && (
                    <PriceField label={t("retailPriceSar")} value={branch.retail} editable={can.edit(profile, "retail")}
                      onChange={(v) => patchBranch(tab_, { retail: v })} />
                  )}
                </div>

                <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
                  <Toggle label={t("trackStock")} checked={branch.trackStock} disabled={!can.stock(profile)}
                    onChange={(v) => patchBranch(tab_, { trackStock: v })} />
                  {branch.trackStock && (
                    <Field label={t("stockQty")}>
                      <input type="number" min={0} step={1} dir="ltr" value={branch.stock} disabled={!can.stock(profile)}
                        onChange={(e) => patchBranch(tab_, { stock: e.target.value })} className={input} />
                    </Field>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </form>
  )
}

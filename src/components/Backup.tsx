import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useApp } from "../lib/app-context"
import {
  buildBackup, buildExport, downloadGrid, download, extractRows, fieldsFor, guessMapping, parseBackup,
  readGrid, restoreBackup, runImport, templateRows, validateRows,
  type Grid, type ImportResult, type Validation,
} from "../lib/bulk"
import { can, loadContext, type BranchRow, type CategoryRow, type Profile } from "../lib/products"
import Icon from "./Icon"
import { useFeedback } from "./FeedbackProvider"

const card = "rounded-2xl border border-line bg-surface p-5 sm:p-6"
const btn =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line2 bg-surface px-4 text-sm font-medium text-ink hover:bg-surface2 disabled:opacity-50"
const primary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-50"
const select =
  "h-10 w-full rounded-lg border border-line2 bg-app px-2 text-sm text-ink outline-none focus:border-focus"

const stamp = () => new Date().toISOString().slice(0, 10)

function Banner({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-red-500/30 bg-red-500/10 text-red-500"}`}>
      {children}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-app p-3">
      <div className={`font-display text-xl font-semibold ${tone ?? "text-ink"}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-ink2">{label}</div>
    </div>
  )
}

export default function Backup() {
  const { t } = useApp()
  const [ctx, setCtx] = useState<{ profile: Profile; branches: BranchRow[]; categories: CategoryRow[] } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    loadContext().then(setCtx).catch(() => setError(t("loadFailed")))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <div className="mx-auto max-w-4xl"><Banner ok={false}>{error}</Banner></div>
  if (!ctx) return <div className="mx-auto max-w-4xl text-ink2">{t("processing")}</div>

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{t("backup")}</h1>
        <p className="mt-1 text-sm text-ink2">{t("backupSub")}</p>
      </div>
      <ImportWizard {...ctx} />
      <ExportCard {...ctx} />
      {ctx.profile.role === "master" && <BackupCard branches={ctx.branches} />}
    </div>
  )
}

/* ---------------- Export ---------------- */

function ExportCard({ profile, branches }: { profile: Profile; branches: BranchRow[] }) {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (format: "csv" | "xlsx") => {
    setBusy(true)
    setMsg(null)
    try {
      const { header, rows, count } = await buildExport(profile, branches)
      if (!count) return setMsg({ ok: false, text: t("exportEmpty") })
      await downloadGrid([header, ...rows], `products-${stamp()}`, format)
      setMsg({ ok: true, text: `${t("exportDone")} (${count.toLocaleString()})` })
    } catch {
      setMsg({ ok: false, text: t("saveFailed") })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={card}>
      <h2 className="font-display text-lg font-semibold text-ink">{t("exportData")}</h2>
      <p className="mb-4 mt-1 text-sm text-ink2">{t("exportSub")}</p>
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={busy} onClick={() => void run("csv")}><Icon name="upload" className="size-4 rotate-180" /> CSV</button>
        <button className={btn} disabled={busy} onClick={() => void run("xlsx")}><Icon name="upload" className="size-4 rotate-180" /> Excel (.xlsx)</button>
      </div>
      {msg && <div className="mt-4"><Banner ok={msg.ok}>{msg.text}</Banner></div>}
    </section>
  )
}

/* ---------------- Import wizard ---------------- */

function ImportWizard({ profile, branches, categories }: { profile: Profile; branches: BranchRow[]; categories: CategoryRow[] }) {
  const { t } = useApp()
  const fields = useMemo(() => fieldsFor(profile, branches, "import"), [profile, branches])
  const [step, setStep] = useState(1)
  const [grid, setGrid] = useState<Grid>([])
  const [fileName, setFileName] = useState("")
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [existing, setExisting] = useState<"skip" | "update">("skip")
  const [validation, setValidation] = useState<Validation | null>(null)
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const allowed = can.editProducts(profile) || fields.some((f) => f.key.includes("|"))
  const headers = grid[0] ?? []
  const steps = [t("stepUpload"), t("stepMapping"), t("stepValidate"), t("stepImport")]

  const reset = () => {
    setStep(1); setGrid([]); setFileName(""); setMapping({}); setValidation(null); setResult(null); setError(""); setProgress([0, 0])
  }

  const onFile = async (file?: File) => {
    if (!file) return
    setError("")
    try {
      const g = await readGrid(file)
      if (g.length < 2) return setError(t("fileEmpty"))
      setGrid(g)
      setFileName(file.name)
      setMapping(guessMapping(fields, g[0]))
      setStep(2)
    } catch {
      setError(t("fileReadFailed"))
    }
  }

  const needsName = !can.editProducts(profile) ? !("product_code" in mapping) : !("name_en" in mapping)

  const validate = async () => {
    setBusy(true)
    setError("")
    try {
      const rows = extractRows(grid, mapping)
      setValidation(await validateRows(rows, existing, (k) => t(k)))
      setStep(3)
    } catch {
      setError(t("loadFailed"))
    } finally {
      setBusy(false)
    }
  }

  const revalidate = async (mode: "skip" | "update") => {
    setExisting(mode)
    setBusy(true)
    try {
      setValidation(await validateRows(extractRows(grid, mapping), mode, (k) => t(k)))
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (!validation) return
    setStep(4)
    setBusy(true)
    setError("")
    try {
      setResult(await runImport(validation, profile, branches, categories, (d, tot) => setProgress([d, tot])))
    } catch (e) {
      setError(`${t("saveFailed")} ${(e as { message?: string })?.message ?? ""}`)
    } finally {
      setBusy(false)
    }
  }

  const issueRows = validation?.rows.filter((r) => r.status === "error" || r.status === "skip") ?? []
  const importable = (validation?.newCount ?? 0) + (validation?.rows.filter((r) => r.status === "update").length ?? 0)

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{t("importProducts")}</h2>
          <p className="mt-1 text-sm text-ink2">{t("importSub")}</p>
        </div>
        <div className="flex gap-2">
          <button className={btn} onClick={() => void downloadGrid(templateRows(fields, branches), "products-template", "csv")}>
            <Icon name="upload" className="size-4 rotate-180" /> {t("downloadTemplate")} CSV
          </button>
          <button className={btn} onClick={() => void downloadGrid(templateRows(fields, branches), "products-template", "xlsx")}>
            XLSX
          </button>
        </div>
      </div>

      {!allowed ? (
        <div className="mt-4"><Banner ok={false}>{t("noImportPermission")}</Banner></div>
      ) : (
        <>
          <ol className="my-5 grid grid-cols-4 gap-2">
            {steps.map((label, i) => (
              <li key={label} className="min-w-0">
                <div className={`h-1.5 rounded-full ${step > i ? "bg-brand" : "bg-line2"}`} />
                <div className={`mt-1.5 truncate text-xs ${step === i + 1 ? "font-semibold text-ink" : "text-ink2"}`}>{i + 1}. {label}</div>
              </li>
            ))}
          </ol>

          {error && <div className="mb-4"><Banner ok={false}>{error}</Banner></div>}

          {step === 1 && (
            <button type="button" onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files[0]) }}
              className="grid w-full place-items-center gap-2 rounded-2xl border-2 border-dashed border-line2 bg-app px-4 py-12 text-center hover:border-focus">
              <Icon name="upload" className="size-8 text-brand" />
              <span className="font-medium text-ink">{t("chooseFile")}</span>
              <span className="text-xs text-ink2">{t("fileHint")}</span>
              <input ref={fileRef} type="file" hidden accept=".csv,.xlsx,text/csv" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = "" }} />
            </button>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-ink2"><span className="font-medium text-ink" dir="ltr">{fileName}</span> · {(grid.length - 1).toLocaleString()} {t("rowsFound")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => (
                  <label key={f.key} className="grid gap-1 text-xs font-medium text-ink2">
                    <span dir="ltr" className="font-mono">{f.header}{f.required ? " *" : ""}</span>
                    <select className={select} value={mapping[f.key] ?? ""}
                      onChange={(e) => setMapping((m) => {
                        const n = { ...m }
                        if (e.target.value === "") delete n[f.key]; else n[f.key] = Number(e.target.value)
                        return n
                      })}>
                      <option value="">{t("columnNotMapped")}</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-ink">{t("previewRows")}</div>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full min-w-max text-xs">
                    <thead className="bg-surface2 text-ink2">
                      <tr>{headers.map((h, i) => <th key={i} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {grid.slice(1, 6).map((r, i) => (
                        <tr key={i} className="border-t border-line text-ink">
                          {headers.map((_, c) => <td key={c} className="px-3 py-1.5">{r[c]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {needsName && <Banner ok={false}>{t("requiredField")}</Banner>}
              <div className="flex flex-wrap justify-between gap-2">
                <button className={btn} onClick={reset}>{t("startOver")}</button>
                <button className={primary} disabled={busy || needsName} onClick={() => void validate()}>
                  {busy ? t("processing") : t("validate")}
                </button>
              </div>
            </div>
          )}

          {step === 3 && validation && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label={t("newProducts")} value={validation.newCount} tone="text-emerald-600" />
                <Stat label={t("existingFound")} value={validation.existingCount} />
                <Stat label={t("blockedRows")} value={validation.errorCount} tone={validation.errorCount ? "text-red-500" : undefined} />
                <Stat label={t("rowsFound")} value={validation.rows.length} />
              </div>
              {can.editProducts(profile) && (
                <fieldset className="grid gap-2 rounded-xl border border-line bg-app p-4 text-sm">
                  <legend className="px-1 text-xs font-medium text-ink2">{t("existingProducts")}</legend>
                  {(["skip", "update"] as const).map((m) => (
                    <label key={m} className="flex items-center gap-2 text-ink">
                      <input type="radio" name="existing" checked={existing === m} onChange={() => void revalidate(m)} />
                      {t(m === "skip" ? "existingSkip" : "existingUpdate")}
                    </label>
                  ))}
                  <p className="text-xs text-ink2">{t("existingNote")}</p>
                </fieldset>
              )}
              {issueRows.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface2 text-ink2">
                      <tr><th className="px-3 py-2 text-start">{t("line")}</th><th className="px-3 py-2 text-start">{t("productCode")}</th><th className="px-3 py-2 text-start">{t("issues")}</th></tr>
                    </thead>
                    <tbody>
                      {issueRows.slice(0, 200).map((r) => (
                        <tr key={r.line} className="border-t border-line align-top">
                          <td className="px-3 py-1.5 text-ink">{r.line}</td>
                          <td className="px-3 py-1.5 text-ink" dir="ltr">{r.values.product_code || r.values.name_en}</td>
                          <td className={`px-3 py-1.5 ${r.status === "error" ? "text-red-500" : "text-ink2"}`}>{r.issues.join(" · ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap justify-between gap-2">
                <button className={btn} onClick={() => setStep(2)}>{t("back")}</button>
                <button className={primary} disabled={busy || importable === 0} onClick={() => void start()}>
                  {t("importNow")} ({importable.toLocaleString()})
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              {busy && (
                <div>
                  <div className="mb-1 text-sm text-ink2">{t("importing")} {progress[0].toLocaleString()} / {progress[1].toLocaleString()}</div>
                  <div className="h-2 overflow-hidden rounded-full bg-line2">
                    <div className="h-full bg-brand transition-all" style={{ width: `${progress[1] ? (progress[0] / progress[1]) * 100 : 5}%` }} />
                  </div>
                </div>
              )}
              {result && (
                <>
                  <Banner ok={result.failed.length === 0}>{t("importDone")}</Banner>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label={t("createdN")} value={result.created} tone="text-emerald-600" />
                    <Stat label={t("updatedN")} value={result.updated} />
                    <Stat label={t("failedN")} value={result.failed.length} tone={result.failed.length ? "text-red-500" : undefined} />
                  </div>
                  {result.failed.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-line p-3 text-xs text-red-500">
                      {result.failed.slice(0, 100).map((f, i) => <div key={i}>{t("line")} {f.line}: {f.message}</div>)}
                    </div>
                  )}
                </>
              )}
              {!busy && <button className={btn} onClick={reset}>{t("startOver")}</button>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/* ---------------- JSON backup ---------------- */

function BackupCard({ branches }: { branches: BranchRow[] }) {
  const { t } = useApp()
  const { confirm, toast } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const backup = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const data = await buildBackup(branches)
      download(new Blob([JSON.stringify(data)], { type: "application/json" }), `al-saree-backup-${stamp()}.json`)
      setMsg({ ok: true, text: `${t("exportDone")} (${data.products.length.toLocaleString()})` })
    } catch {
      setMsg({ ok: false, text: t("saveFailed") })
    } finally {
      setBusy(false)
    }
  }

  const restore = async (file?: File) => {
    if (!file) return
    setMsg(null)
    try {
      const data = parseBackup(await file.text())
      if (!await confirm({ title: t("restoreConfirmTitle"), message: t("restoreConfirm"), confirmLabel: t("restoreBackup") })) return
      setBusy(true)
      const r = await restoreBackup(data, branches, () => undefined)
      setMsg({ ok: r.errors.length === 0, text: `${t("restoreDone")} (${r.products.toLocaleString()})${r.errors.length ? ` · ${t("failedN")}: ${r.errors.length}` : ""}` })
      if (r.errors.length === 0) toast("success", t("restoreDone"))
      else toast("error", t("restorePartialFailed"))
    } catch (e) {
      const message = e instanceof Error && e.message === "INVALID_BACKUP" ? t("invalidBackup") : t("restoreFailed")
      setMsg({ ok: false, text: message })
      toast("error", message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={card}>
      <h2 className="font-display text-lg font-semibold text-ink">{t("fullBackup")}</h2>
      <p className="mb-4 mt-1 text-sm text-ink2">{t("fullBackupSub")}</p>
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy} onClick={() => void backup()}>
          <Icon name="upload" className="size-4 rotate-180" /> {t("downloadBackup")}
        </button>
        <button className={btn} disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" className="size-4" /> {t("restoreBackup")}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = "" }} />
      </div>
      <p className="mt-3 text-xs text-ink2">{t("restoreWarn")}</p>
      {busy && <p className="mt-3 text-sm text-ink2">{t("processing")}</p>}
      {msg && <div className="mt-4"><Banner ok={msg.ok}>{msg.text}</Banner></div>}
    </section>
  )
}

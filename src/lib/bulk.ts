import { supabase } from "./supabase"
import { syncBranchCatalog, type CatalogProduct } from "./catalog-cache"
import { can, nextProductCode, type BranchRow, type CategoryRow, type Profile } from "./products"

export type Grid = string[][]
export type FieldDef = { key: string; header: string; required?: boolean; aliases?: string[] }

const PRICE_KINDS = ["purchase", "wholesale", "retail"] as const
const BASE: FieldDef[] = [
  { key: "product_code", header: "product_code", aliases: ["code", "sku", "itemcode"] },
  { key: "name_en", header: "name_en", required: true, aliases: ["name", "productname", "nameenglish"] },
  { key: "name_ar", header: "name_ar", aliases: ["namearabic", "arabicname"] },
  { key: "category", header: "category", aliases: ["categoryname", "categoryen"] },
  { key: "description_en", header: "description_en", aliases: ["description"] },
  { key: "description_ar", header: "description_ar" },
  { key: "barcodes", header: "barcodes", aliases: ["barcode", "ean", "upc"] },
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "")

export function fieldsFor(profile: Profile, branches: BranchRow[], mode: "import" | "export"): FieldDef[] {
  const allow = mode === "import" ? can.edit : can.view
  const out = [...BASE]
  for (const b of branches) {
    for (const k of PRICE_KINDS) {
      if (allow(profile, k)) out.push({ key: `${b.code}|${k}`, header: `${b.code}_${k}_price` })
    }
    if (mode === "export" ? true : can.stock(profile)) {
      out.push({ key: `${b.code}|stock`, header: `${b.code}_stock` })
    }
  }
  return out
}

export function guessMapping(fields: FieldDef[], headers: string[]) {
  const map: Record<string, number> = {}
  const used = new Set<number>()
  for (const f of fields) {
    const names = [f.header, f.key.replace("|", ""), ...(f.aliases ?? [])].map(norm)
    const idx = headers.findIndex((h, i) => !used.has(i) && names.includes(norm(h)))
    if (idx >= 0) {
      map[f.key] = idx
      used.add(idx)
    }
  }
  return map
}

/* ---------- files ---------- */

export function parseCsv(text: string): Grid {
  const rows: Grid = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const src = text.replace(/^﻿/, "")
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === "," || c === ";" || c === "\t") { row.push(cell); cell = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++
      row.push(cell); cell = ""
      rows.push(row); row = []
    } else cell += c
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ""))
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows
    .map((r) => r.map((c) => {
      const s = c === null || c === undefined ? "" : String(c)
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(","))
    .join("\r\n")
}

export async function readGrid(file: File): Promise<Grid> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser")
    const result = (await readSheet(file)) as unknown
    const rows = (Array.isArray(result) && result[0] && !Array.isArray(result[0]) && "data" in (result[0] as object)
      ? (result[0] as { data: unknown[][] }).data
      : result) as unknown[][]
    return rows
      .map((r) => r.map((c) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim())))
      .filter((r) => r.some((c) => c !== ""))
  }
  return parseCsv(await file.text())
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function downloadGrid(rows: (string | number | null)[][], name: string, format: "csv" | "xlsx") {
  if (format === "csv") {
    download(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" }), `${name}.csv`)
    return
  }
  const { default: writeExcelFile } = await import("write-excel-file/browser")
  const blob = await writeExcelFile(rows.map((r) => r.map((c) => (c === "" ? null : c)))).toBlob()
  download(blob, `${name}.xlsx`)
}

export function templateRows(fields: FieldDef[], branches: BranchRow[]) {
  const header = fields.map((f) => f.header)
  const sample = (n: number) =>
    fields.map((f) => {
      switch (f.key) {
        case "product_code": return ""
        case "name_en": return n === 1 ? "Polarized Sunglasses - Black" : "Leather Wallet - Brown"
        case "name_ar": return n === 1 ? "نظارة شمسية - أسود" : "محفظة جلد - بني"
        case "category": return n === 1 ? "Sunglasses" : "Wallets"
        case "description_en": return "Optional"
        case "description_ar": return ""
        case "barcodes": return n === 1 ? "6281000000011;6281000000028" : "6281000000035"
        default: return f.key.endsWith("stock") ? 10 * n : f.key.endsWith("purchase") ? 120 * n : f.key.endsWith("wholesale") ? 150 * n : 199 * n
      }
    })
  void branches
  return [header, sample(1), sample(2)]
}

/* ---------- export ---------- */

export async function loadVisibleCatalogs(branches: BranchRow[]) {
  const results = await Promise.all(
    branches.map(async (b) => {
      const { data, error } = await supabase.rpc("get_branch_catalog_secure", { p_branch_id: b.id })
      return error ? null : { branch: b, rows: ((data ?? []) as CatalogProduct[]).filter((product) => !product.setup_incomplete) }
    }),
  )
  return results.filter((r): r is { branch: BranchRow; rows: CatalogProduct[] } => !!r)
}

export async function buildExport(profile: Profile, branches: BranchRow[]) {
  const catalogs = await loadVisibleCatalogs(branches)
  const allowed = catalogs.map((c) => c.branch)
  const fields = fieldsFor(profile, allowed, "export")
  const products = new Map<string, Record<string, string | number | null>>()
  for (const { branch, rows } of catalogs) {
    for (const p of rows) {
      const rec = products.get(p.product_id) ?? {
        product_code: p.product_code,
        name_en: p.name_en,
        name_ar: p.name_ar ?? "",
        category: p.category_name_en ?? "",
        description_en: p.description_en ?? "",
        description_ar: p.description_ar ?? "",
        barcodes: (p.barcodes ?? []).join(";"),
      }
      for (const k of PRICE_KINDS) {
        if (can.view(profile, k)) rec[`${branch.code}|${k}`] = p[`${k}_price`] ?? ""
      }
      rec[`${branch.code}|stock`] = p.track_stock ? (p.stock_quantity ?? "") : ""
      products.set(p.product_id, rec)
    }
  }
  const rows = [...products.values()]
    .sort((a, b) => String(a.product_code).localeCompare(String(b.product_code)))
    .map((r) => fields.map((f) => r[f.key] ?? ""))
  return { header: fields.map((f) => f.header), rows, count: rows.length }
}

/* ---------- import ---------- */

export type ParsedRow = {
  line: number
  values: Record<string, string>
  status: "ok" | "update" | "skip" | "error"
  issues: string[]
  id?: string
}

export type Validation = {
  rows: ParsedRow[]
  newCount: number
  existingCount: number
  errorCount: number
}

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

export function extractRows(grid: Grid, mapping: Record<string, number>): { line: number; values: Record<string, string> }[] {
  return grid.slice(1).map((cells, i) => {
    const values: Record<string, string> = {}
    for (const [key, col] of Object.entries(mapping)) values[key] = (cells[col] ?? "").trim()
    return { line: i + 2, values }
  })
}

export const splitBarcodes = (s: string) => [...new Set((s ?? "").split(/[;|\n]/).map((b) => b.trim()).filter(Boolean))]

export async function validateRows(
  raw: { line: number; values: Record<string, string> }[],
  existingMode: "skip" | "update",
  t: (key: "rowNameMissing" | "rowDupCodeFile" | "rowDupBarcodeFile" | "rowBarcodeTaken" | "rowBadNumber" | "rowExistsSkipped") => string,
): Promise<Validation> {
  const [products, barcodes] = await Promise.all([
    fetchAll<{ id: string; product_code: string }>("products", "id,product_code"),
    fetchAll<{ barcode: string; product_id: string }>("product_barcodes", "barcode,product_id"),
  ])
  const byCode = new Map(products.map((p) => [p.product_code.toLowerCase(), p.id]))
  const barcodeOwner = new Map(barcodes.map((b) => [b.barcode, b.product_id]))
  const seenCodes = new Set<string>()
  const seenBarcodes = new Set<string>()

  const rows = raw.map<ParsedRow>(({ line, values }) => {
    const issues: string[] = []
    let status: ParsedRow["status"] = "ok"
    const code = values.product_code?.toLowerCase() ?? ""
    const existingId = code ? byCode.get(code) : undefined

    if (!values.name_en && !existingId) issues.push(t("rowNameMissing"))
    if (code) {
      if (seenCodes.has(code)) issues.push(t("rowDupCodeFile"))
      seenCodes.add(code)
    }
    for (const bc of splitBarcodes(values.barcodes ?? "")) {
      if (seenBarcodes.has(bc)) issues.push(`${t("rowDupBarcodeFile")}: ${bc}`)
      seenBarcodes.add(bc)
      const owner = barcodeOwner.get(bc)
      if (owner && owner !== existingId) issues.push(`${t("rowBarcodeTaken")}: ${bc}`)
    }
    for (const [k, v] of Object.entries(values)) {
      if (k.includes("|") && v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0)) issues.push(`${t("rowBadNumber")}: ${k}`)
    }
    if (issues.length) status = "error"
    else if (existingId) {
      status = existingMode === "update" ? "update" : "skip"
      if (status === "skip") issues.push(t("rowExistsSkipped"))
    }
    return { line, values, status, issues, id: existingId }
  })

  return {
    rows,
    newCount: rows.filter((r) => r.status === "ok").length,
    existingCount: rows.filter((r) => r.status === "update" || r.status === "skip").length,
    errorCount: rows.filter((r) => r.status === "error").length,
  }
}

export async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>, tick?: () => void) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]
        await worker(item)
        tick?.()
      }
    }),
  )
}

export type ImportResult = { created: number; updated: number; failed: { line: number; message: string }[] }

const msg = (e: unknown) => (e as { message?: string })?.message ?? String(e)
const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

export async function runImport(
  validation: Validation,
  profile: Profile,
  branches: BranchRow[],
  categories: CategoryRow[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, failed: [] }
  const rows = validation.rows.filter((r) => r.status === "ok" || r.status === "update")
  let total = rows.length
  let done = 0
  const bump = (n = 1) => onProgress((done += n), total)
  const canProducts = can.editProducts(profile)

  // categories
  const catIds = new Map(categories.map((c) => [c.name_en.toLowerCase(), c.id]))
  if (canProducts) {
    const missing = [...new Set(rows.map((r) => r.values.category).filter((c) => c && !catIds.has(c.toLowerCase())))]
    for (const part of chunk(missing, 100)) {
      const { data, error } = await supabase
        .from("categories")
        .insert(part.map((n) => ({ name_en: n, name_ar: n })))
        .select("id,name_en")
      if (error) throw error
      data?.forEach((c) => catIds.set(c.name_en.toLowerCase(), c.id))
    }
  }

  // product rows
  const failed = new Set<number>()
  const fail = (line: number, m: string) => { failed.add(line); result.failed.push({ line, message: m }) }
  const ids = new Map<number, string>()

  if (canProducts) {
    let counter = Number((await nextProductCode()).replace(/\D/g, ""))
    const fresh = rows.filter((r) => r.status === "ok").map((r) => {
      const id = crypto.randomUUID()
      ids.set(r.line, id)
      const code = r.values.product_code || `PRD-${String(counter++).padStart(5, "0")}`
      return { r, record: {
        id, product_code: code, name_en: r.values.name_en,
        name_ar: r.values.name_ar || null,
        description_en: r.values.description_en || null,
        description_ar: r.values.description_ar || null,
        category_id: r.values.category ? catIds.get(r.values.category.toLowerCase()) ?? null : null,
      } }
    })
    for (const part of chunk(fresh, 100)) {
      const { error } = await supabase.from("products").insert(part.map((p) => p.record))
      if (!error) { result.created += part.length; bump(part.length); continue }
      for (const p of part) {
        const { error: single } = await supabase.from("products").insert(p.record)
        if (single) fail(p.r.line, msg(single)); else result.created++
        bump()
      }
    }
    await pool(rows.filter((r) => r.status === "update"), 6, async (r) => {
      ids.set(r.line, r.id!)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      const v = r.values
      if (v.name_en) patch.name_en = v.name_en
      if (v.name_ar) patch.name_ar = v.name_ar
      if (v.description_en) patch.description_en = v.description_en
      if (v.description_ar) patch.description_ar = v.description_ar
      if (v.category) patch.category_id = catIds.get(v.category.toLowerCase()) ?? null
      const { error } = await supabase.from("products").update(patch).eq("id", r.id!)
      if (error) fail(r.line, msg(error)); else result.updated++
    }, () => bump())

    // barcodes
    const barcodeRows = rows.filter((r) => !failed.has(r.line)).flatMap((r) =>
      splitBarcodes(r.values.barcodes ?? "").map((barcode) => ({ line: r.line, product_id: ids.get(r.line)!, barcode, is_generated: false })),
    )
    for (const part of chunk(barcodeRows, 200)) {
      const payload = part.map(({ product_id, barcode, is_generated }) => ({ product_id, barcode, is_generated }))
      const { error } = await supabase.from("product_barcodes").upsert(payload, { onConflict: "barcode", ignoreDuplicates: true })
      if (!error) continue
      for (const b of part) {
        const { error: one } = await supabase.from("product_barcodes").insert({ product_id: b.product_id, barcode: b.barcode, is_generated: false })
        if (one && one.code !== "23505") fail(b.line, `${b.barcode}: ${msg(one)}`)
      }
    }
  } else {
    rows.forEach((r) => { if (r.id) ids.set(r.line, r.id) })
  }

  // branch prices & stock (existing products only when the user cannot create products)
  const jobs = rows.flatMap((r) => {
    const productId = ids.get(r.line)
    if (!productId || failed.has(r.line)) return []
    return branches.flatMap((b) => {
      const g = (k: string) => r.values[`${b.code}|${k}`]
      const vals = ["purchase", "wholesale", "retail", "stock"].map(g)
      if (vals.every((v) => v === undefined || v === "")) return []
      const num = (k: "purchase" | "wholesale" | "retail") =>
        can.edit(profile, k) && g(k) ? Number(g(k)) : null
      return [{ line: r.line, args: {
        p_branch_id: b.id, p_product_id: productId, p_is_available: true, p_branch_code: null,
        p_purchase_price: num("purchase"), p_wholesale_price: num("wholesale"), p_retail_price: num("retail"),
        p_track_stock: can.stock(profile) && !!g("stock"),
        p_stock_quantity: can.stock(profile) && g("stock") ? Math.round(Number(g("stock"))) : null,
      } }]
    })
  })
  total = done + jobs.length
  await pool(jobs, 8, async (j) => {
    const { error } = await supabase.rpc("upsert_branch_product", j.args)
    if (error) fail(j.line, msg(error))
  }, () => bump())
  onProgress(total, total)

  await Promise.allSettled(branches.map((b) => syncBranchCatalog(b.code)))
  return result
}

/* ---------- JSON backup / restore ---------- */

const BACKUP_VERSION = 1

export async function buildBackup(branches: BranchRow[]) {
  const [categories, products, barcodes, images, settings, catalogs] = await Promise.all([
    fetchAll("categories", "*"),
    fetchAll("products", "*"),
    fetchAll("product_barcodes", "*"),
    fetchAll("product_images", "*"),
    supabase.from("app_settings").select("*").eq("id", 1).maybeSingle().then((r) => r.data ?? null),
    loadVisibleCatalogs(branches),
  ])
  return {
    app: "al-saree-inventory",
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    branches,
    categories,
    products,
    product_barcodes: barcodes,
    product_images: images,
    app_settings: settings,
    branch_catalog: Object.fromEntries(
      catalogs.map((c) => [c.branch.code, c.rows.map((p) => ({
        product_id: p.product_id, branch_code: p.branch_code, track_stock: p.track_stock, stock_quantity: p.stock_quantity,
        purchase_price: p.purchase_price ?? null, wholesale_price: p.wholesale_price ?? null, retail_price: p.retail_price ?? null,
      }))]),
    ),
  }
}

type Backup = Awaited<ReturnType<typeof buildBackup>>

export function parseBackup(text: string): Backup {
  const data = JSON.parse(text)
  if (data?.app !== "al-saree-inventory" || !Array.isArray(data.products)) throw new Error("INVALID_BACKUP")
  return data as Backup
}

export async function restoreBackup(
  data: Backup,
  branches: BranchRow[],
  onStep: (label: string, done: number, total: number) => void,
) {
  const steps = 6
  let step = 0
  const next = (l: string) => onStep(l, ++step, steps)
  const up = async (table: string, rows: unknown[], conflict: string, size = 200) => {
    for (const part of chunk(rows, size)) {
      const { error } = await supabase.from(table).upsert(part as never[], { onConflict: conflict })
      if (error) throw error
    }
  }
  next("categories")
  await up("categories", data.categories as unknown[], "id")
  next("products")
  await up("products", data.products as unknown[], "id")
  next("barcodes")
  await up("product_barcodes", data.product_barcodes as unknown[], "id")
  next("images")
  await up("product_images", data.product_images as unknown[], "id")
  next("settings")
  if (data.app_settings) await up("app_settings", [data.app_settings], "id")
  next("prices")
  const idByCode = new Map(branches.map((b) => [b.code, b.id]))
  const jobs = Object.entries(data.branch_catalog ?? {}).flatMap(([code, rows]) =>
    idByCode.has(code) ? (rows as Record<string, unknown>[]).map((r) => ({ code, r })) : [],
  )
  const errors: string[] = []
  await pool(jobs, 8, async ({ code, r }) => {
    const { error } = await supabase.rpc("upsert_branch_product", {
      p_branch_id: idByCode.get(code), p_product_id: r.product_id, p_is_available: true, p_branch_code: r.branch_code ?? null,
      p_purchase_price: r.purchase_price ?? null, p_wholesale_price: r.wholesale_price ?? null, p_retail_price: r.retail_price ?? null,
      p_track_stock: !!r.track_stock, p_stock_quantity: r.stock_quantity ?? null,
    })
    if (error) errors.push(msg(error))
  })
  await Promise.allSettled(branches.map((b) => syncBranchCatalog(b.code)))
  return { products: data.products.length, errors }
}

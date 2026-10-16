import { supabase } from "./supabase"
import { compressToWebp } from "./images"
import { getCachedCatalog, syncBranchCatalog } from "./catalog-cache"

export const BUCKET = "product-images"

export type Profile = {
  id: string
  role: "master" | "branch_manager" | "staff"
  full_name: string
  can_view_purchase_price: boolean
  can_edit_purchase_price: boolean
  can_view_wholesale_price: boolean
  can_edit_wholesale_price: boolean
  can_view_retail_price: boolean
  can_edit_retail_price: boolean
  can_edit_products: boolean
  can_manage_stock: boolean
}

export type BranchRow = { id: string; code: string; name_en: string; name_ar: string }
export type CategoryRow = { id: string; name_en: string; name_ar: string }

export type DraftImage = {
  key: string
  id?: string
  storage_path?: string
  url: string
  blob?: Blob
  is_primary: boolean
}

export type BranchDraft = {
  available: boolean
  branchCode: string
  purchase: string
  wholesale: string
  retail: string
  trackStock: boolean
  stock: string
  touched: boolean
}

export type ProductDraft = {
  id: string
  isNew: boolean
  code: string
  codeAuto: boolean
  nameEn: string
  nameAr: string
  descEn: string
  descAr: string
  categoryId: string
  newCategoryEn: string
  newCategoryAr: string
  barcodes: string[]
  images: DraftImage[]
  branches: Record<string, BranchDraft>
}

export const emptyBranch = (available = true): BranchDraft => ({
  available,
  branchCode: "",
  purchase: "",
  wholesale: "",
  retail: "",
  trackStock: false,
  stock: "",
  touched: false,
})

export const can = {
  view: (p: Profile, kind: "purchase" | "wholesale" | "retail") =>
    p.role === "master" || p[`can_view_${kind}_price`],
  edit: (p: Profile, kind: "purchase" | "wholesale" | "retail") =>
    p.role === "master" || (p[`can_edit_${kind}_price`] && p[`can_view_${kind}_price`]),
  editProducts: (p: Profile) => p.role === "master" || p.can_edit_products,
  stock: (p: Profile) => p.role === "master" || p.can_manage_stock,
}

export async function loadContext() {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error("NO_SESSION")
  const [profile, branches, categories] = await Promise.all([
    supabase.from("user_profiles").select("*").eq("id", auth.user.id).single(),
    supabase.from("branches").select("id,code,name_en,name_ar").eq("is_active", true).order("code"),
    supabase.from("categories").select("id,name_en,name_ar").order("name_en"),
  ])
  if (profile.error) throw profile.error
  if (branches.error) throw branches.error
  return {
    profile: profile.data as Profile,
    branches: (branches.data ?? []) as BranchRow[],
    categories: (categories.data ?? []) as CategoryRow[],
  }
}

export async function nextProductCode() {
  const { data } = await supabase
    .from("products")
    .select("product_code")
    .ilike("product_code", "PRD-%")
    .order("product_code", { ascending: false })
    .limit(1)
  const last = Number(data?.[0]?.product_code?.replace(/\D/g, "")) || 0
  return `PRD-${String(last + 1).padStart(5, "0")}`
}

export async function newDraft(branches: BranchRow[], activeCode?: string): Promise<ProductDraft> {
  const first = branches.find((b) => b.code === activeCode) ?? branches[0]
  return {
    id: crypto.randomUUID(),
    isNew: true,
    code: await nextProductCode(),
    codeAuto: true,
    nameEn: "",
    nameAr: "",
    descEn: "",
    descAr: "",
    categoryId: "",
    newCategoryEn: "",
    newCategoryAr: "",
    barcodes: [],
    images: [],
    branches: Object.fromEntries(branches.map((b) => [b.id, emptyBranch(b.id === first?.id)])),
  }
}

type RpcRow = {
  product_id: string
  branch_code?: string | null
  track_stock?: boolean
  stock_quantity?: number | null
  purchase_price?: number | null
  wholesale_price?: number | null
  retail_price?: number | null
}

export async function loadDraft(productId: string, branches: BranchRow[]): Promise<ProductDraft> {
  const [product, barcodes, images, ...catalogs] = await Promise.all([
    supabase.from("products").select("*").eq("id", productId).single(),
    supabase.from("product_barcodes").select("barcode").eq("product_id", productId).order("created_at"),
    supabase
      .from("product_images")
      .select("id,storage_path,image_url,is_primary,sort_order")
      .eq("product_id", productId)
      .order("sort_order"),
    ...branches.map(async (branch) => {
      const cached = await getCachedCatalog(branch.code)
      if (cached) return cached.products
      const fresh = await syncBranchCatalog(branch.code)
      return fresh.products
    }),
  ])
  if (product.error) throw product.error
  const p = product.data

  const branchDrafts: Record<string, BranchDraft> = {}
  branches.forEach((b, index) => {
    const row = catalogs[index].find((r) => r.product_id === productId) as RpcRow | undefined
    const text = (n?: number | null) => (n === null || n === undefined ? "" : String(n))
    branchDrafts[b.id] = row
      ? {
          available: true,
          branchCode: row.branch_code ?? "",
          purchase: text(row.purchase_price),
          wholesale: text(row.wholesale_price),
          retail: text(row.retail_price),
          trackStock: !!row.track_stock,
          stock: text(row.stock_quantity),
          touched: false,
        }
      : emptyBranch(false)
  })

  return {
    id: p.id,
    isNew: false,
    code: p.product_code,
    codeAuto: false,
    nameEn: p.name_en ?? "",
    nameAr: p.name_ar ?? "",
    descEn: p.description_en ?? "",
    descAr: p.description_ar ?? "",
    categoryId: p.category_id ?? "",
    newCategoryEn: "",
    newCategoryAr: "",
    barcodes: (barcodes.data ?? []).map((b) => b.barcode),
    images: (images.data ?? []).map((i) => ({
      key: i.id,
      id: i.id,
      storage_path: i.storage_path,
      url: i.image_url,
      is_primary: i.is_primary,
    })),
    branches: branchDrafts,
  }
}

export async function makeDraftImage(file: File): Promise<DraftImage> {
  const blob = await compressToWebp(file)
  return { key: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), is_primary: false }
}

function num(value: string) {
  if (value.trim() === "") return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_NUMBER")
  return n
}

export async function saveDraft(
  draft: ProductDraft,
  original: ProductDraft | null,
  profile: Profile,
  branches: BranchRow[],
) {
  let categoryId = draft.categoryId || null
  if (draft.newCategoryEn.trim() && can.editProducts(profile)) {
    const { data, error } = await supabase
      .from("categories")
      .insert({
        name_en: draft.newCategoryEn.trim(),
        name_ar: draft.newCategoryAr.trim() || draft.newCategoryEn.trim(),
      })
      .select("id")
      .single()
    if (error) throw error
    categoryId = data.id
  }

  let id = draft.id
  let code = draft.code.trim()
  if (can.editProducts(profile)) {
    const fields = {
      name_en: draft.nameEn.trim(),
      name_ar: draft.nameAr.trim() || null,
      description_en: draft.descEn.trim() || null,
      description_ar: draft.descAr.trim() || null,
      category_id: categoryId,
    }
    if (draft.isNew) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { error } = await supabase.from("products").insert({ id, product_code: code, ...fields })
        if (!error) break
        if (error.code === "23505" && draft.codeAuto && attempt < 3) {
          code = await nextProductCode()
          continue
        }
        throw error
      }
    } else {
      const { error } = await supabase
        .from("products")
        .update({ product_code: code, ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
      if (error) throw error
    }

    await commitBarcodes(id, draft.barcodes, original?.barcodes ?? [])
    await commitImages(id, draft.images, original?.images ?? [], profile)
  }

  for (const branch of branches) {
    const b = draft.branches[branch.id]
    if (!b) continue
    const loaded = original?.branches[branch.id]
    const untouchedEmpty =
      !b.available && !b.purchase && !b.wholesale && !b.retail && !b.stock && !b.branchCode
    if (untouchedEmpty && !loaded?.available) continue
    if (!b.touched && !draft.isNew) continue

    const { error } = await supabase.rpc("upsert_branch_product", {
      p_branch_id: branch.id,
      p_product_id: id,
      p_is_available: b.available,
      p_branch_code: b.branchCode.trim() || null,
      p_purchase_price: can.edit(profile, "purchase") ? num(b.purchase) : null,
      p_wholesale_price: can.edit(profile, "wholesale") ? num(b.wholesale) : null,
      p_retail_price: can.edit(profile, "retail") ? num(b.retail) : null,
      p_track_stock: b.trackStock,
      p_stock_quantity: b.trackStock && b.stock.trim() !== "" ? Math.round(Number(b.stock)) : null,
    })
    if (error) throw error
  }

  return id
}

async function commitBarcodes(productId: string, next: string[], previous: string[]) {
  const cleaned = [...new Set(next.map((b) => b.trim()).filter(Boolean))]
  const removed = previous.filter((b) => !cleaned.includes(b))
  const added = cleaned.filter((b) => !previous.includes(b))
  if (removed.length) {
    const { error } = await supabase
      .from("product_barcodes")
      .delete()
      .eq("product_id", productId)
      .in("barcode", removed)
    if (error) throw error
  }
  if (added.length) {
    const { error } = await supabase.from("product_barcodes").insert(
      added.map((barcode) => ({ product_id: productId, barcode, is_generated: /^20\d{11}$/.test(barcode) })),
    )
    if (error) {
      if (error.code === "23505") throw new Error("DUPLICATE_BARCODE")
      throw error
    }
  }
}

async function commitImages(
  productId: string,
  next: DraftImage[],
  previous: DraftImage[],
  profile: Profile,
) {
  const storage = supabase.storage.from(BUCKET)
  const kept = new Set(next.map((i) => i.id).filter(Boolean))
  const removed = previous.filter((i) => i.id && !kept.has(i.id))

  if (removed.length) {
    const paths = removed.map((i) => i.storage_path).filter(Boolean) as string[]
    if (paths.length) {
      const { error } = await storage.remove(paths)
      if (error) throw error
    }
    const { error } = await supabase.from("product_images").delete().in("id", removed.map((i) => i.id!))
    if (error) throw error
  }

  const primaryKey = (next.find((i) => i.is_primary) ?? next[0])?.key
  for (const [index, image] of next.entries()) {
    const is_primary = image.key === primaryKey
    if (image.id) {
      const before = previous.find((p) => p.id === image.id)
      const beforeIndex = previous.filter((p) => p.id && kept.has(p.id)).findIndex((p) => p.id === image.id)
      if (before?.is_primary === is_primary && beforeIndex === index) continue
      const { error } = await supabase
        .from("product_images")
        .update({ is_primary, sort_order: index })
        .eq("id", image.id)
      if (error) throw error
    } else if (image.blob) {
      const path = `products/${productId}/${crypto.randomUUID()}.webp`
      const { error: uploadError } = await storage.upload(path, image.blob, {
        contentType: "image/webp",
        upsert: false,
      })
      if (uploadError) throw uploadError
      const { error } = await supabase.from("product_images").insert({
        product_id: productId,
        storage_path: path,
        image_url: storage.getPublicUrl(path).data.publicUrl,
        is_primary,
        sort_order: index,
        uploaded_by: profile.id,
      })
      if (error) throw error
    }
  }
}

/** Builds an editable draft from the offline catalog cache (used when there is no connection). */
export async function draftFromCache(
  productId: string | null,
  branches: BranchRow[],
  activeCode: string,
): Promise<ProductDraft> {
  const { getCachedCatalog } = await import("./catalog-cache")
  const caches = await Promise.all(branches.map((b) => getCachedCatalog(b.code).catch(() => null)))
  const text = (n?: number | null) => (n === null || n === undefined ? "" : String(n))
  const rows = caches.map((c) => c?.products.find((p) => p.product_id === productId))
  const base = rows.find(Boolean)
  const draft: ProductDraft = {
    id: productId ?? crypto.randomUUID(),
    isNew: !productId,
    code: base?.product_code ?? "PRD-PENDING",
    codeAuto: !productId,
    nameEn: base?.name_en ?? "",
    nameAr: base?.name_ar ?? "",
    descEn: base?.description_en ?? "",
    descAr: base?.description_ar ?? "",
    categoryId: base?.category_id ?? "",
    newCategoryEn: "",
    newCategoryAr: "",
    barcodes: base?.barcodes ?? [],
    images: (base?.images ?? []).map((i) => ({ key: i.id, id: i.id, storage_path: i.storage_path, url: i.url, is_primary: i.is_primary })),
    branches: {},
  }
  branches.forEach((b, i) => {
    const row = rows[i]
    draft.branches[b.id] = row
      ? {
          available: true,
          branchCode: row.branch_code ?? "",
          purchase: text(row.purchase_price),
          wholesale: text(row.wholesale_price),
          retail: text(row.retail_price),
          trackStock: !!row.track_stock,
          stock: text(row.stock_quantity),
          touched: false,
        }
      : emptyBranch(!productId && b.code === activeCode)
  })
  return draft
}

import { supabase } from "./supabase"

export type CatalogProduct = {
  product_id: string
  product_code: string
  name_en: string
  name_ar: string | null
  description_en?: string | null
  description_ar?: string | null
  category_id?: string | null
  category_name_en?: string | null
  category_name_ar?: string | null
  branch_code: string | null
  track_stock: boolean
  stock_quantity: number | null
  setup_incomplete?: boolean
  purchase_price?: number
  wholesale_price?: number
  retail_price?: number
  barcodes: string[]
  images: { id: string; storage_path: string; url: string; is_primary: boolean }[]
}

type CacheRecord = {
  cacheKey: string
  userId: string
  branchCode: string
  syncedAt: string
  products: CatalogProduct[]
}

const DB_NAME = "al-saree-inventory"
const STORE_NAME = "catalogs"
const DB_VERSION = 2
const fallbackKey = (userId: string, branchCode: string) => `al-saree-catalog:${userId}:${branchCode}`
const recordKey = (userId: string, branchCode: string) => `${userId}:${branchCode}`

async function currentUserId() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

function sanitizeProduct(value: unknown): CatalogProduct {
  const raw = value as Record<string, unknown>
  const product = Object.fromEntries(
    Object.entries(raw).filter(([, item]) => item !== null),
  )
  return {
    ...product as CatalogProduct,
    barcodes: Array.isArray(product.barcodes)
      ? product.barcodes as string[]
      : [],
    images: Array.isArray(product.images)
      ? product.images as CatalogProduct["images"]
      : [],
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      // Version 1 catalogs were shared across accounts. Discard that local cache
      // rather than risk exposing one user's branch prices to another account.
      if (request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.deleteObjectStore(STORE_NAME)
      }
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "cacheKey" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function writeIndexedDb(record: CacheRecord) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

async function readIndexedDb(userId: string, branchCode: string) {
  const database = await openDatabase()
  const record = await new Promise<CacheRecord | undefined>(
    (resolve, reject) => {
      const request = database
        .transaction(STORE_NAME)
        .objectStore(STORE_NAME)
        .get(recordKey(userId, branchCode))
      request.onsuccess = () =>
        resolve(request.result as CacheRecord | undefined)
      request.onerror = () => reject(request.error)
    },
  )
  database.close()
  return record
}

export async function setCachedCatalog(
  branchCode: string,
  products: CatalogProduct[],
) {
  const userId = await currentUserId()
  if (!userId) throw new Error("NO_SESSION")
  const record = {
    cacheKey: recordKey(userId, branchCode),
    userId,
    branchCode,
    syncedAt: new Date().toISOString(),
    products: products.map(sanitizeProduct),
  }
  try {
    await writeIndexedDb(record)
  } catch {
    localStorage.setItem(fallbackKey(userId, branchCode), JSON.stringify(record))
  }
  return record
}

export async function getCachedCatalog(
  branchCode: string,
): Promise<CacheRecord | null> {
  const userId = await currentUserId()
  if (!userId) return null
  try {
    const record = await readIndexedDb(userId, branchCode)
    if (record) return record
  } catch {}

  const value = localStorage.getItem(fallbackKey(userId, branchCode))
  return value ? (JSON.parse(value) as CacheRecord) : null
}

export async function updateCachedProduct(
  branchCode: string,
  product: CatalogProduct,
  available: boolean,
) {
  const cached = await getCachedCatalog(branchCode)
  if (!cached) return false
  const exists = cached.products.some((item) => item.product_id === product.product_id)
  const products = !available
    ? cached.products.filter((item) => item.product_id !== product.product_id)
    : exists
      ? cached.products.map((item) => item.product_id === product.product_id ? product : item)
      : [...cached.products, product]
  await setCachedCatalog(branchCode, products)
  return true
}

export async function clearUserCatalogs(userId: string) {
  const database = await openDatabase().catch(() => null)
  try {
    if (database) {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite")
        const request = transaction.objectStore(STORE_NAME).openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          if ((cursor.value as CacheRecord).userId === userId) cursor.delete()
          cursor.continue()
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
    }
  } finally {
    database?.close()
    const prefix = `al-saree-catalog:${userId}:`
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) localStorage.removeItem(key)
    }
  }
}

export async function syncBranchCatalog(branchCode: string) {
  const { data: branch, error: branchError } = await supabase
    .from("branches")
    .select("id")
    .eq("code", branchCode)
    .single()

  if (branchError) throw branchError

  const [{ data, error }, { data: categories }] = await Promise.all([
    supabase.rpc("get_branch_catalog_secure", { p_branch_id: branch.id }),
    supabase.from("categories").select("id,name_en,name_ar"),
  ])

  if (error) throw error
  const categoryMap = new Map(
    (categories ?? []).map((category) => [category.id, category]),
  )
  const products = (Array.isArray(data) ? data : []).map((value) => {
    const product = sanitizeProduct(value)
    const category = product.category_id
      ? categoryMap.get(product.category_id)
      : undefined
    return {
      ...product,
      category_name_en: product.category_name_en ?? category?.name_en,
      category_name_ar: product.category_name_ar ?? category?.name_ar,
    }
  })
  return setCachedCatalog(branchCode, products)
}

export function findCatalogProduct(products: CatalogProduct[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return null
  const configured = products.filter((product) => !product.setup_incomplete)

  return (
    configured.find(
      (product) =>
        product.product_code.toLocaleLowerCase() === needle ||
        product.barcodes.some(
          (barcode) => barcode.toLocaleLowerCase() === needle,
        ),
    ) ??
    configured.find(
      (product) =>
        product.product_code.toLocaleLowerCase().includes(needle) ||
        product.name_en.toLocaleLowerCase().includes(needle) ||
        product.name_ar?.toLocaleLowerCase().includes(needle),
    ) ??
    null
  )
}

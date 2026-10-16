import type { BranchRow, Profile, ProductDraft } from "./products"

export type QueuedSave = {
  id: string
  createdAt: string
  draft: ProductDraft
  original: ProductDraft | null
  profile: Profile
  userId: string
  branches: BranchRow[]
  error?: string
}

const DB = "al-saree-queue"
const STORE = "saves"
const EVENT = "offline-queue-change"

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const notify = () => window.dispatchEvent(new Event(EVENT))

export async function listQueue(): Promise<QueuedSave[]> {
  const { data } = await (await import("./supabase")).supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) return []
  const all = await tx<QueuedSave[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedSave[]>)
  // profile.id is used for entries created by the previous queue schema.
  return all.filter((item) => (item.userId ?? item.profile.id) === userId)
}

export async function enqueueSave(item: Omit<QueuedSave, "id" | "createdAt" | "userId">) {
  const { data } = await (await import("./supabase")).supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId || userId !== item.profile.id) throw new Error("NO_SESSION")
  // Image blobs are structured-cloned into IndexedDB; object URLs are not durable.
  const draft = { ...item.draft, images: item.draft.images.map((i) => ({ ...i, url: i.blob ? "" : i.url })) }
  // One pending entry per product: keep the first original so the diff stays correct.
  const existing = (await listQueue()).find((q) => q.draft.id === draft.id)
  await tx("readwrite", (s) =>
    s.put({
      ...item,
      userId,
      draft,
      original: existing ? existing.original : item.original,
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }),
  )
  notify()
}

export const onQueueChange = (fn: () => void) => {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

let flushing: Promise<{ ok: number; failed: number }> | null = null

export function flushQueue() {
  if (flushing) return flushing
  flushing = (async () => {
    const { saveDraft, nextProductCode } = await import("./products")
    const { data } = await (await import("./supabase")).supabase.auth.getSession()
    const userId = data.session?.user.id
    if (!userId) return { ok: 0, failed: 0 }
    let ok = 0
    let failed = 0
    const all = await tx<QueuedSave[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedSave[]>)
    const items = all
      .filter((item) => (item.userId ?? item.profile.id) === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const item of items) {
      try {
        const draft = { ...item.draft }
        if (draft.isNew && draft.codeAuto) draft.code = await nextProductCode()
        await saveDraft(draft, item.original, item.profile, item.branches)
        await tx("readwrite", (s) => s.delete(item.id))
        ok++
      } catch (err) {
        failed++
        await tx("readwrite", (s) => s.put({ ...item, error: (err as Error)?.message ?? "error" }))
      }
    }
    notify()
    return { ok, failed }
  })().finally(() => {
    flushing = null
  })
  return flushing
}

let started = false
let runQueueSync: (() => void) | null = null
export function startQueueSync() {
  if (started) {
    runQueueSync?.()
    return
  }
  started = true
  runQueueSync = () => {
    if (navigator.onLine) void flushQueue()
  }
  window.addEventListener("online", runQueueSync)
  runQueueSync()
}

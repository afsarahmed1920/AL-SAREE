import { useSyncExternalStore } from "react"
import { hasSupabaseConfig } from "./config"
import { supabase } from "./supabase"
import { compressToWebp } from "./images"
import { BUCKET } from "./products"
import { branches as staticBranches, company } from "./data"

export type Bilingual = { en: string; ar: string }

export type AppSettings = {
  company_name_en: string
  company_name_ar: string
  logo_url: string | null
  contact_numbers: string[]
  branch_addresses: Record<string, Bilingual>
  privacy_en: string
  privacy_ar: string
  terms_en: string
  terms_ar: string
}

export const LOGO_PATH = "branding/logo.webp"
const CACHE_KEY = "al-saree-settings"

export const defaultSettings: AppSettings = {
  company_name_en: company.name_en,
  company_name_ar: company.name_ar,
  logo_url: null,
  contact_numbers: company.phones,
  branch_addresses: Object.fromEntries(
    staticBranches.map((b) => [b.id, { en: b.address_en, ar: b.address_ar }]),
  ),
  privacy_en: "",
  privacy_ar: "",
  terms_en: "",
  terms_ar: "",
}

function read(): AppSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return defaultSettings
}

let current = read()
const listeners = new Set<() => void>()
const publish = (next: AppSettings) => {
  current = next
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

function normalize(row: Record<string, unknown>): AppSettings {
  const s = { ...defaultSettings }
  const str = (k: keyof AppSettings) => {
    const v = row[k]
    if (typeof v === "string" && v.trim()) (s as Record<string, unknown>)[k] = v
  }
  ;(["company_name_en", "company_name_ar", "privacy_en", "privacy_ar", "terms_en", "terms_ar"] as const).forEach(str)
  if (typeof row.logo_url === "string" && row.logo_url) s.logo_url = row.logo_url
  if (Array.isArray(row.contact_numbers) && row.contact_numbers.length)
    s.contact_numbers = row.contact_numbers.map(String)
  if (row.branch_addresses && typeof row.branch_addresses === "object")
    s.branch_addresses = { ...s.branch_addresses, ...(row.branch_addresses as Record<string, Bilingual>) }
  return s
}

export async function refreshSettings() {
  if (!hasSupabaseConfig) return false
  const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle()
  if (!error && data) publish(normalize(data))
  return !error
}

export async function saveSettings(next: AppSettings) {
  const payload = {
    id: 1,
    company_name_en: next.company_name_en.trim(),
    company_name_ar: next.company_name_ar.trim(),
    logo_url: next.logo_url,
    contact_numbers: next.contact_numbers.map((n) => n.trim()).filter(Boolean),
    branch_addresses: next.branch_addresses,
    privacy_en: next.privacy_en,
    privacy_ar: next.privacy_ar,
    terms_en: next.terms_en,
    terms_ar: next.terms_ar,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from("app_settings").upsert(payload)
  if (error) throw error
  publish(normalize(payload))
}

export async function uploadLogo(file: File) {
  const blob = await compressToWebp(file)
  const storage = supabase.storage.from(BUCKET)
  const { error } = await storage.upload(LOGO_PATH, blob, { contentType: "image/webp", upsert: true })
  if (error) throw error
  return `${storage.getPublicUrl(LOGO_PATH).data.publicUrl}?v=${Date.now()}`
}

export async function removeLogo() {
  const { error } = await supabase.storage.from(BUCKET).remove([LOGO_PATH])
  if (error) throw error
}

export function useSettings() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

void refreshSettings()

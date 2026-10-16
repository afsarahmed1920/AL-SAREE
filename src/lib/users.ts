import { supabaseAnonKey, supabaseUrl } from "./config"
import { supabase } from "./supabase"
import type { Profile } from "./products"

export const permissionKeys = [
  "can_view_purchase_price",
  "can_edit_purchase_price",
  "can_view_wholesale_price",
  "can_edit_wholesale_price",
  "can_view_retail_price",
  "can_edit_retail_price",
  "can_edit_products",
  "can_manage_stock",
] as const
export type PermissionKey = (typeof permissionKeys)[number]
export type Permissions = Record<PermissionKey, boolean>
export type Role = Profile["role"]

export type StaffUser = {
  id: string
  username: string
  full_name: string
  role: Role
  is_active: boolean
  branch_ids: string[]
} & Permissions

const none: Permissions = {
  can_view_purchase_price: false,
  can_edit_purchase_price: false,
  can_view_wholesale_price: false,
  can_edit_wholesale_price: false,
  can_view_retail_price: false,
  can_edit_retail_price: false,
  can_edit_products: false,
  can_manage_stock: false,
}

export const rolePresets: Record<Role, Permissions> = {
  master: Object.fromEntries(permissionKeys.map((k) => [k, true])) as Permissions,
  branch_manager: {
    ...none,
    can_view_wholesale_price: true,
    can_edit_wholesale_price: true,
    can_view_retail_price: true,
    can_edit_retail_price: true,
    can_edit_products: true,
    can_manage_stock: true,
  },
  staff: { ...none, can_view_wholesale_price: true, can_view_retail_price: true },
}

export async function listUsers(): Promise<StaffUser[]> {
  const [profiles, access] = await Promise.all([
    supabase.from("user_profiles").select("*").order("created_at"),
    supabase.from("user_branch_access").select("user_id,branch_id"),
  ])
  if (profiles.error) throw profiles.error
  if (access.error) throw access.error
  return (profiles.data ?? []).map((p) => ({
    ...p,
    branch_ids: (access.data ?? []).filter((a) => a.user_id === p.id).map((a) => a.branch_id),
  })) as StaffUser[]
}

export async function callAdmin(path: string, body: unknown) {
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error("NO_SESSION")
  const response = await fetch(
    `${supabaseUrl}/functions/v1/make-server-8a5f868b/admin/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
  )
  const json = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`)
  return json
}

export async function saveUserAccess(user: StaffUser) {
  const permissions = Object.fromEntries(permissionKeys.map((k) => [k, user[k]]))
  const { error } = await supabase
    .from("user_profiles")
    .update({ full_name: user.full_name.trim(), role: user.role, ...permissions })
    .eq("id", user.id)
  if (error) throw error

  const { error: clearError } = await supabase.from("user_branch_access").delete().eq("user_id", user.id)
  if (clearError) throw clearError
  if (user.branch_ids.length) {
    const { error: insertError } = await supabase
      .from("user_branch_access")
      .insert(user.branch_ids.map((branch_id) => ({ user_id: user.id, branch_id })))
    if (insertError) throw insertError
  }
}

export type AuditRow = {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  branch_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export async function listAudit(limit = 1000) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = (data ?? []) as AuditRow[]
  const ids = [...new Set(rows.filter((r) => r.entity_type === "product" || r.entity_type === "branch_product").map((r) => r.entity_id).filter(Boolean))] as string[]
  const products = new Map<string, { code: string; name: string }>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data: found } = await supabase.from("products").select("id,product_code,name_en").in("id", ids.slice(i, i + 100))
    found?.forEach((p) => products.set(p.id, { code: p.product_code, name: p.name_en }))
  }
  return { rows, products }
}

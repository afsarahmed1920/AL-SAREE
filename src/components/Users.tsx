import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useApp, type Key } from "../lib/app-context"
import { loadContext, type BranchRow, type Profile } from "../lib/products"
import {
  callAdmin,
  listUsers,
  permissionKeys,
  rolePresets,
  saveUserAccess,
  type PermissionKey,
  type Role,
  type StaffUser,
} from "../lib/users"
import Icon from "./Icon"

const input =
  "h-11 w-full rounded-xl border border-line2 bg-app px-3.5 text-ink outline-none focus:border-focus focus:ring-2 focus:ring-focus/20 disabled:opacity-60"
const card = "rounded-2xl border border-line bg-surface p-5 sm:p-6"

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${checked ? "bg-brand" : "bg-line2"}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? "start-[22px]" : "start-0.5"}`} />
    </button>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium text-ink2">{label}{children}</label>
}

const emptyUser = (branches: BranchRow[]): StaffUser => ({
  id: "",
  username: "",
  full_name: "",
  role: "staff",
  is_active: true,
  branch_ids: branches.slice(0, 1).map((b) => b.id),
  ...rolePresets.staff,
})

function Editor({ initial, branches, self, onCancel, onSaved }: {
  initial: StaffUser
  branches: BranchRow[]
  self: boolean
  onCancel: () => void
  onSaved: () => void
}) {
  const { t, lang } = useApp()
  const isNew = !initial.id
  const [user, setUser] = useState(initial)
  const [password, setPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const patch = (changes: Partial<StaffUser>) => setUser((u) => ({ ...u, ...changes }))
  const roleValue =
    user.role === "branch_manager"
      ? `manager:${user.branch_ids[0] ?? branches[0]?.id}`
      : user.role
  const branchName = (b: BranchRow) => (lang === "ar" ? b.name_ar : b.name_en)

  const chooseRole = (value: string) => {
    if (value === "master") {
      patch({ role: "master", branch_ids: branches.map((b) => b.id), ...rolePresets.master })
    } else if (value === "staff") {
      patch({ role: "staff", ...rolePresets.staff })
    } else {
      patch({ role: "branch_manager", branch_ids: [value.slice(8)], ...rolePresets.branch_manager })
    }
  }

  const setPermission = (key: PermissionKey, value: boolean) => {
    const changes: Partial<StaffUser> = { [key]: value }
    if (key.startsWith("can_edit_") && key.endsWith("_price") && value) changes[key.replace("edit", "view") as PermissionKey] = true
    if (key.startsWith("can_view_") && !value) changes[key.replace("view", "edit") as PermissionKey] = false
    patch(changes)
  }

  const toggleBranch = (id: string) =>
    patch({ branch_ids: user.branch_ids.includes(id) ? user.branch_ids.filter((b) => b !== id) : [...user.branch_ids, id] })

  const run = async (task: () => Promise<void>) => {
    setError("")
    setNotice("")
    setSaving(true)
    try {
      await task()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const save = () =>
    run(async () => {
      if (!user.full_name.trim()) throw new Error(t("fullNameRequired"))
      if (isNew) {
        if (password.length < 8) throw new Error("Password must be at least 8 characters")
        await callAdmin("users", {
          username: user.username,
          password,
          full_name: user.full_name,
          role: user.role,
          branch_ids: user.branch_ids,
          permissions: Object.fromEntries(permissionKeys.map((k) => [k, user[k]])),
        })
      } else {
        await saveUserAccess(user)
        if (user.is_active !== initial.is_active) await callAdmin(`users/${user.id}/active`, { active: user.is_active })
      }
      onSaved()
    })

  const resetPassword = () =>
    run(async () => {
      await callAdmin(`users/${user.id}/password`, { password })
      setPassword("")
      setNotice(t("passwordUpdated"))
    })

  const matrix: { label: Key; view: PermissionKey; edit: PermissionKey }[] = [
    { label: "purchasePrice", view: "can_view_purchase_price", edit: "can_edit_purchase_price" },
    { label: "wholesalePriceSar", view: "can_view_wholesale_price", edit: "can_edit_wholesale_price" },
    { label: "retailPriceSar", view: "can_view_retail_price", edit: "can_edit_retail_price" },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="sticky top-16 z-20 -mx-4 flex items-center justify-between gap-3 border-b border-line bg-app/90 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onCancel} aria-label={t("cancel")} className="grid size-10 shrink-0 place-items-center rounded-xl border border-line2 bg-surface text-ink">
            <Icon name="left" className="rtl:-scale-x-100" />
          </button>
          <h1 className="truncate font-display text-xl font-semibold text-ink">{isNew ? t("addUser") : user.full_name || user.username}</h1>
        </div>
        <button onClick={() => void save()} disabled={saving} className="h-10 shrink-0 rounded-xl bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-60">
          {saving ? t("saving") : t("saveUser")}
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">{notice}</p>}

      <section className={card}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("username")}>
            <input dir="ltr" value={user.username} disabled={!isNew} autoCapitalize="none" onChange={(e) => patch({ username: e.target.value.toLowerCase() })} className={input} />
          </Field>
          <Field label={t("fullName")}>
            <input value={user.full_name} onChange={(e) => patch({ full_name: e.target.value })} className={input} />
          </Field>
          <Field label={t("role")}>
            <select value={roleValue} disabled={self} onChange={(e) => chooseRole(e.target.value)} className={input}>
              <option value="master">{t("roleMaster")}</option>
              {branches.map((b) => <option key={b.id} value={`manager:${b.id}`}>{t("roleManager")} · {branchName(b)}</option>)}
              <option value="staff">{t("roleStaff")}</option>
            </select>
          </Field>
          <Field label={isNew ? t("password") : t("newPassword")}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input type={showPassword ? "text" : "password"} dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} pe-12`} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={t("revealBuying")} className="absolute end-1.5 top-1.5 grid size-8 place-items-center rounded-lg text-ink2 hover:bg-surface2">
                  <Icon name={showPassword ? "eyeOff" : "eye"} className="size-4" />
                </button>
              </div>
              {!isNew && (
                <button type="button" disabled={saving || password.length < 8} onClick={() => void resetPassword()} className="h-11 shrink-0 rounded-xl border border-line2 px-3 text-sm font-medium text-ink disabled:opacity-50">
                  {t("resetPassword")}
                </button>
              )}
            </div>
          </Field>
        </div>
        {!isNew && (
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-5 text-sm font-medium text-ink">
            <span>{t("accountActive")}</span>
            <Switch label={t("accountActive")} checked={user.is_active} disabled={self} onChange={(v) => patch({ is_active: v })} />
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">{t("branchAccess")}</h2>
        <div className="flex flex-wrap gap-3">
          {branches.map((b) => (
            <label key={b.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium ${user.branch_ids.includes(b.id) ? "border-brand bg-brand/10 text-ink" : "border-line2 text-ink2"}`}>
              <input type="checkbox" checked={user.branch_ids.includes(b.id)} disabled={self && user.role === "master"} onChange={() => toggleBranch(b.id)} className="size-4 accent-[var(--primary-main)]" />
              {branchName(b)}
            </label>
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-1 font-display text-lg font-semibold text-ink">{t("permissions")}</h2>
        <p className="mb-4 text-sm text-ink2">{user.role === "master" ? t("masterAll") : t("permissionsHint")}</p>
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-[1fr_4.5rem_4.5rem] bg-surface2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink2">
            <span>{t("priceType")}</span><span className="text-center">{t("canView")}</span><span className="text-center">{t("canEdit")}</span>
          </div>
          {matrix.map((row) => (
            <div key={row.view} className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center border-t border-line px-4 py-3 text-sm font-medium text-ink">
              <span>{t(row.label)}</span>
              <span className="grid place-items-center"><Switch label={`${t(row.label)} ${t("canView")}`} checked={user[row.view]} disabled={user.role === "master"} onChange={(v) => setPermission(row.view, v)} /></span>
              <span className="grid place-items-center"><Switch label={`${t(row.label)} ${t("canEdit")}`} checked={user[row.edit]} disabled={user.role === "master"} onChange={(v) => setPermission(row.edit, v)} /></span>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {([["can_edit_products", "canEditProducts"], ["can_manage_stock", "canManageStock"]] as const).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4 text-sm font-medium text-ink">
              <span>{t(label)}</span>
              <Switch label={t(label)} checked={user[key]} disabled={user.role === "master"} onChange={(v) => setPermission(key, v)} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default function Users() {
  const { t, lang } = useApp()
  const [state, setState] = useState<{ profile: Profile; branches: BranchRow[]; users: StaffUser[] } | null>(null)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState<StaffUser | null>(null)
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    try {
      const ctx = await loadContext()
      if (ctx.profile.role !== "master") return setState({ profile: ctx.profile, branches: ctx.branches, users: [] })
      setState({ profile: ctx.profile, branches: ctx.branches, users: await listUsers() })
      setError("")
    } catch (err) {
      setError((err as Error).message === "NO_SESSION" ? t("signInFirst") : `${t("loadFailed")} ${(err as Error).message}`)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  if (error) return <p role="alert" className="mx-auto max-w-3xl rounded-2xl border border-red-300 bg-red-50 p-5 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>
  if (!state) return <p className="p-8 text-center text-ink2">{t("syncing")}…</p>
  if (state.profile.role !== "master")
    return <p className="mx-auto max-w-3xl rounded-2xl border border-dashed border-line2 p-10 text-center text-ink2">{t("masterOnly")}</p>

  if (editing)
    return (
      <Editor
        key={editing.id || "new"}
        initial={editing}
        branches={state.branches}
        self={editing.id === state.profile.id}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); setNotice(t("userSaved")); void load(); window.scrollTo({ top: 0 }) }}
      />
    )

  const roleLabel = (u: StaffUser) =>
    u.role === "master" ? t("roleMaster") : u.role === "branch_manager" ? t("roleManager") : t("roleStaff")
  const branchName = (id: string) => {
    const b = state.branches.find((x) => x.id === id)
    return b ? (lang === "ar" ? b.name_ar : b.name_en) : ""
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">{t("users")}</h1>
          <p className="mt-1 text-sm text-ink2">{t("usersSub")}</p>
        </div>
        <button onClick={() => setEditing(emptyUser(state.branches))} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-on-brand">
          <Icon name="plus" className="size-5" /> {t("addUser")}
        </button>
      </div>
      {notice && <p role="status" className="rounded-xl bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">{notice}</p>}

      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {state.users.map((u) => (
          <li key={u.id}>
            <button onClick={() => setEditing(u)} className="flex w-full items-center gap-4 p-4 text-start transition hover:bg-surface2">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand font-display font-semibold text-on-brand">{(u.full_name || u.username)[0]?.toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{u.full_name}</span>
                <span className="block truncate text-xs text-ink2"><span dir="ltr">@{u.username}</span> · {roleLabel(u)} · {u.branch_ids.map(branchName).join(", ") || "—"}</span>
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${u.is_active ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-surface2 text-ink2"}`}>
                {u.is_active ? t("active") : t("disabled")}
              </span>
              <Icon name="right" className="size-4 text-ink2 rtl:-scale-x-100" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

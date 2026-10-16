import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"
import { createClient } from "@supabase/supabase-js"

const functionSlug = "make-server-8a5f868b"
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
}

const permissionKeys = [
  "can_view_purchase_price",
  "can_edit_purchase_price",
  "can_view_wholesale_price",
  "can_edit_wholesale_price",
  "can_view_retail_price",
  "can_edit_retail_price",
  "can_edit_products",
  "can_manage_stock",
] as const

type PermissionKey = (typeof permissionKeys)[number]
type Role = "master" | "branch_manager" | "staff"
type Profile = {
  id: string
  username: string
  full_name: string
  role: Role
  is_active: boolean
}
type PasskeyConfig = { rpId: string; origin: string }

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const env = (name: string) => Deno.env.get(name)?.trim() ?? ""

function serviceClient() {
  const url = env("SUPABASE_URL")
  const key = env("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new HttpError(503, "Function service is not configured")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  })
}

function bearer(request: Request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") ?? "")
  if (!match) throw new HttpError(401, "Authentication required")
  return match[1]
}

async function requireUser(request: Request) {
  const service = serviceClient()
  const token = bearer(request)
  const { data: auth, error: authError } = await service.auth.getUser(token)
  if (authError || !auth.user) throw new HttpError(401, "Invalid session")

  const { data: profile, error } = await service
    .from("user_profiles")
    .select("id,username,full_name,role,is_active")
    .eq("id", auth.user.id)
    .maybeSingle()
  if (error) throw new HttpError(503, "Could not verify account permissions")
  if (!profile || !profile.is_active) throw new HttpError(403, "Account is inactive")
  return { service, authUser: auth.user, profile: profile as Profile }
}

async function requireMaster(request: Request) {
  const actor = await requireUser(request)
  if (actor.profile.role !== "master") throw new HttpError(403, "Master access required")
  return actor
}

async function bodyJson(request: Request) {
  try {
    const value = await request.json()
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new HttpError(400, "Invalid request body")
  }
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

function permissionsFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Invalid permissions")
  }
  const source = value as Record<string, unknown>
  const permissions = {} as Record<PermissionKey, boolean>
  for (const key of permissionKeys) {
    if (typeof source[key] !== "boolean") throw new HttpError(400, "Invalid permissions")
    permissions[key] = source[key] as boolean
  }
  if (
    (permissions.can_edit_purchase_price && !permissions.can_view_purchase_price) ||
    (permissions.can_edit_wholesale_price && !permissions.can_view_wholesale_price) ||
    (permissions.can_edit_retail_price && !permissions.can_view_retail_price)
  ) {
    throw new HttpError(400, "Price edit permission requires view permission")
  }
  return permissions
}

async function createStaffUser(request: Request) {
  const { service } = await requireMaster(request)
  const input = await bodyJson(request)
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : ""
  const password = typeof input.password === "string" ? input.password : ""
  const fullName = typeof input.full_name === "string" ? input.full_name.trim() : ""
  const role = input.role
  if (!/^[a-z0-9][a-z0-9._-]{1,38}$/.test(username)) {
    throw new HttpError(400, "Username must be 2–39 characters using letters, numbers, dot, underscore, or hyphen")
  }
  if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters")
  if (!fullName || fullName.length > 120) throw new HttpError(400, "A valid full name is required")
  if (role !== "master" && role !== "branch_manager" && role !== "staff") {
    throw new HttpError(400, "Invalid role")
  }
  const permissions = permissionsFrom(input.permissions)
  if (!Array.isArray(input.branch_ids) || input.branch_ids.some((id) => !isUuid(id))) {
    throw new HttpError(400, "Invalid branch access list")
  }
  const branchIds = [...new Set(input.branch_ids as string[])]
  if (role === "branch_manager" && branchIds.length !== 1) {
    throw new HttpError(400, "A branch manager must have exactly one branch")
  }
  const { data: branches, error: branchError } = await service
    .from("branches")
    .select("id")
    .eq("is_active", true)
    .in("id", branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"])
  if (branchError) throw new HttpError(503, "Could not verify branch access")
  if ((branches ?? []).length !== branchIds.length) throw new HttpError(400, "Branch access contains an inactive or unknown branch")

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: `${username}@store.local`,
    password,
    email_confirm: true,
  })
  if (createError || !created.user) {
    throw new HttpError(400, createError?.message ?? "Could not create account")
  }

  const userId = created.user.id
  try {
    const { error: profileError } = await service.from("user_profiles").insert({
      id: userId,
      username,
      full_name: fullName,
      role,
      is_active: true,
      ...permissions,
    })
    if (profileError) throw profileError
    if (branchIds.length) {
      const { error: accessError } = await service.from("user_branch_access").insert(
        branchIds.map((branch_id) => ({ user_id: userId, branch_id })),
      )
      if (accessError) throw accessError
    }
  } catch (error) {
    await service.from("user_branch_access").delete().eq("user_id", userId)
    await service.from("user_profiles").delete().eq("id", userId)
    await service.auth.admin.deleteUser(userId)
    console.error("New staff account setup was rolled back", error)
    throw new HttpError(400, "Could not finish setting up the account")
  }
  return json({ id: userId, username })
}

async function setUserActive(request: Request, userId: string) {
  const { service, profile } = await requireMaster(request)
  if (!isUuid(userId)) throw new HttpError(400, "Invalid user ID")
  const input = await bodyJson(request)
  if (typeof input.active !== "boolean") throw new HttpError(400, "Active must be true or false")
  if (profile.id === userId && !input.active) throw new HttpError(400, "You cannot deactivate your own account")

  const { data: target, error: readError } = await service
    .from("user_profiles")
    .select("id,is_active")
    .eq("id", userId)
    .maybeSingle()
  if (readError) throw new HttpError(503, "Could not verify target account")
  if (!target) throw new HttpError(404, "Account not found")

  const { error: authError } = await service.auth.admin.updateUserById(userId, {
    ban_duration: input.active ? "none" : "876000h",
  })
  if (authError) throw new HttpError(400, "Could not update authentication status")
  const { error } = await service.from("user_profiles").update({ is_active: input.active }).eq("id", userId)
  if (error) {
    await service.auth.admin.updateUserById(userId, {
      ban_duration: target.is_active ? "none" : "876000h",
    })
    throw new HttpError(400, "Could not update account status")
  }
  return json({ ok: true })
}

async function setUserPassword(request: Request, userId: string) {
  const { service } = await requireMaster(request)
  if (!isUuid(userId)) throw new HttpError(400, "Invalid user ID")
  const input = await bodyJson(request)
  if (typeof input.password !== "string" || input.password.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters")
  }
  const { data: target, error: readError } = await service
    .from("user_profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle()
  if (readError) throw new HttpError(503, "Could not verify target account")
  if (!target) throw new HttpError(404, "Account not found")
  const { error } = await service.auth.admin.updateUserById(userId, { password: input.password })
  if (error) throw new HttpError(400, "Could not update password")
  return json({ ok: true })
}

async function passkeyConfig(service: ReturnType<typeof serviceClient>): Promise<PasskeyConfig> {
  const { data, error } = await service
    .from("app_settings")
    .select("passkey_enabled,passkey_rp_id,passkey_origin")
    .eq("id", 1)
    .maybeSingle()
  if (error) throw new HttpError(503, "Could not load passkey settings")
  const rpId = typeof data?.passkey_rp_id === "string" ? data.passkey_rp_id.trim().toLowerCase() : ""
  const origin = typeof data?.passkey_origin === "string" ? data.passkey_origin.trim() : ""
  if (!data?.passkey_enabled || !rpId || !origin) {
    throw new HttpError(503, "Passkeys are not configured for this app domain")
  }
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new HttpError(503, "Passkey origin configuration is invalid")
  }
  if (
    parsed.origin !== origin ||
    (parsed.protocol !== "https:" && parsed.hostname !== "localhost") ||
    (parsed.hostname !== rpId && !parsed.hostname.endsWith(`.${rpId}`))
  ) {
    throw new HttpError(503, "Passkey RP ID and origin do not match")
  }
  return { rpId, origin }
}

async function saveChallenge(
  service: ReturnType<typeof serviceClient>,
  challenge: string,
  purpose: "register" | "login",
  userId: string | null,
) {
  const { error: cleanupError } = await service
    .from("passkey_challenges")
    .delete()
    .lt("expires_at", new Date().toISOString())
  if (cleanupError) throw new HttpError(503, "Passkey challenge storage is unavailable")
  const { error } = await service.from("passkey_challenges").insert({
    challenge,
    purpose,
    user_id: userId,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  })
  if (error) throw new HttpError(503, "Could not save passkey challenge")
}

function decodeBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(base64)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

function readChallenge(response: unknown) {
  if (!response || typeof response !== "object") throw new HttpError(400, "Invalid passkey response")
  const value = response as { response?: { clientDataJSON?: unknown } }
  if (typeof value.response?.clientDataJSON !== "string") throw new HttpError(400, "Invalid passkey response")
  try {
    const clientData = JSON.parse(new TextDecoder().decode(decodeBase64Url(value.response.clientDataJSON)))
    if (typeof clientData.challenge !== "string") throw new Error()
    return clientData.challenge as string
  } catch {
    throw new HttpError(400, "Invalid passkey response")
  }
}

async function consumeChallenge(
  service: ReturnType<typeof serviceClient>,
  challenge: string,
  purpose: "register" | "login",
  userId: string | null,
) {
  let query = service
    .from("passkey_challenges")
    .delete()
    .eq("challenge", challenge)
    .eq("purpose", purpose)
    .gt("expires_at", new Date().toISOString())
  if (userId) query = query.eq("user_id", userId)
  const { data, error } = await query.select("challenge,user_id,purpose").maybeSingle()
  if (error) throw new HttpError(503, "Could not verify passkey challenge")
  if (!data || (userId && data.user_id !== userId)) throw new HttpError(400, "Passkey challenge expired or already used")
  return data
}

async function registrationOptions(request: Request) {
  const { service, profile } = await requireUser(request)
  const config = await passkeyConfig(service)
  const { data: rows, error } = await service
    .from("user_passkeys")
    .select("credential_id,transports")
    .eq("user_id", profile.id)
  if (error) throw new HttpError(503, "Could not load registered passkeys")
  const options = await generateRegistrationOptions({
    rpName: "AL-SAREE",
    rpID: config.rpId,
    userID: new TextEncoder().encode(profile.id),
    userName: profile.username,
    userDisplayName: profile.full_name,
    attestationType: "none",
    excludeCredentials: (rows ?? []).map((row) => ({
      id: row.credential_id,
      transports: row.transports ?? [],
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  })
  await saveChallenge(service, options.challenge, "register", profile.id)
  return json(options)
}

async function verifyRegistration(request: Request) {
  const { service, profile } = await requireUser(request)
  const config = await passkeyConfig(service)
  const input = await bodyJson(request)
  const challenge = readChallenge(input.response)
  await consumeChallenge(service, challenge, "register", profile.id)
  const verification = await verifyRegistrationResponse({
    response: input.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
    expectedChallenge: challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    requireUserVerification: true,
  })
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpError(400, "Passkey registration could not be verified")
  }
  const credential = verification.registrationInfo.credential
  const response = input.response as { response?: { transports?: string[] } }
  const transports = credential.transports ?? response.response?.transports ?? []
  const label = typeof input.label === "string" ? input.label.replace(/[\r\n\0]/g, " ").slice(0, 80) : null
  const { error } = await service.from("user_passkeys").insert({
    user_id: profile.id,
    credential_id: credential.id,
    public_key: encodeBase64Url(credential.publicKey),
    counter: credential.counter,
    transports,
    device_name: label,
  })
  if (error) throw new HttpError(400, "This passkey is already registered or could not be saved")
  return json({ verified: true })
}

async function listPasskeys(request: Request) {
  const { service, profile } = await requireUser(request)
  const { data, error } = await service
    .from("user_passkeys")
    .select("id,device_name,created_at")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) throw new HttpError(503, "Could not load registered passkeys")
  return json({ passkeys: data ?? [] })
}

async function deletePasskey(request: Request) {
  const { service, profile } = await requireUser(request)
  const input = await bodyJson(request)
  if (!isUuid(input.id)) throw new HttpError(400, "Invalid passkey")
  const { data, error } = await service
    .from("user_passkeys")
    .delete()
    .eq("id", input.id)
    .eq("user_id", profile.id)
    .select("id")
    .maybeSingle()
  if (error) throw new HttpError(503, "Could not remove passkey")
  if (!data) throw new HttpError(404, "Passkey not found")
  return json({ removed: true })
}

async function authenticationOptions() {
  const service = serviceClient()
  const config = await passkeyConfig(service)
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: "required",
    allowCredentials: [],
  })
  await saveChallenge(service, options.challenge, "login", null)
  return json(options)
}

async function verifyAuthentication(request: Request) {
  const service = serviceClient()
  const config = await passkeyConfig(service)
  const input = await bodyJson(request)
  if (!input.response || typeof input.response !== "object") {
    throw new HttpError(400, "Invalid passkey response")
  }
  const response = input.response as {
    id?: unknown
    response?: { userHandle?: unknown }
  }
  if (typeof response?.id !== "string") throw new HttpError(400, "Invalid passkey response")
  const challenge = readChallenge(response)
  await consumeChallenge(service, challenge, "login", null)

  const { data: credential, error } = await service
    .from("user_passkeys")
    .select("id,user_id,credential_id,public_key,counter,transports")
    .eq("credential_id", response.id)
    .maybeSingle()
  if (error || !credential) throw new HttpError(401, "Passkey sign-in failed")

  const verification = await verifyAuthenticationResponse({
    response: input.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
    expectedChallenge: challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    credential: {
      id: credential.credential_id,
      publicKey: decodeBase64Url(credential.public_key),
      counter: Number(credential.counter),
      transports: credential.transports ?? [],
    },
    requireUserVerification: true,
  })
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    throw new HttpError(401, "Passkey sign-in failed")
  }

  const userHandle = response.response?.userHandle
  if (typeof userHandle !== "string" || new TextDecoder().decode(decodeBase64Url(userHandle)) !== credential.user_id) {
    throw new HttpError(401, "Passkey sign-in failed")
  }

  const { data: profile, error: profileError } = await service
    .from("user_profiles")
    .select("id,is_active")
    .eq("id", credential.user_id)
    .maybeSingle()
  if (profileError) throw new HttpError(503, "Could not verify account")
  if (!profile?.is_active) throw new HttpError(401, "Passkey sign-in failed")

  const { data: counterUpdate, error: counterError } = await service
    .from("user_passkeys")
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq("id", credential.id)
    .eq("counter", credential.counter)
    .select("id")
    .maybeSingle()
  if (counterError) throw new HttpError(503, "Could not update passkey counter")
  if (!counterUpdate) throw new HttpError(401, "Passkey sign-in failed")

  const { data: authUser, error: authUserError } = await service.auth.admin.getUserById(credential.user_id)
  if (authUserError || !authUser.user?.email) throw new HttpError(401, "Passkey sign-in failed")
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) throw new HttpError(503, "Could not create sign-in session")
  return json({ token_hash: tokenHash })
}

async function handle(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const url = new URL(request.url)
  const marker = `/${functionSlug}`
  const markerIndex = url.pathname.lastIndexOf(marker)
  const path = markerIndex >= 0 ? url.pathname.slice(markerIndex + marker.length) : url.pathname

  if ((request.method === "GET" || request.method === "POST") && path === "/health") {
    return json({ status: "ok" })
  }
  if (request.method !== "POST") throw new HttpError(405, "Method not allowed")

  if (path === "/admin/users") return await createStaffUser(request)
  const activeMatch = /^\/admin\/users\/([^/]+)\/active$/.exec(path)
  if (activeMatch) return await setUserActive(request, activeMatch[1])
  const passwordMatch = /^\/admin\/users\/([^/]+)\/password$/.exec(path)
  if (passwordMatch) return await setUserPassword(request, passwordMatch[1])

  if (path === "/passkey/register/options") return await registrationOptions(request)
  if (path === "/passkey/register/verify") return await verifyRegistration(request)
  if (path === "/passkey/manage/list") return await listPasskeys(request)
  if (path === "/passkey/manage/delete") return await deletePasskey(request)
  if (path === "/passkey/login/options") return await authenticationOptions()
  if (path === "/passkey/login/verify") return await verifyAuthentication(request)

  throw new HttpError(404, "Route not found")
}

Deno.serve(async (request) => {
  try {
    return await handle(request)
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error("Edge Function request failed", error)
    return json({ error: "Internal server error" }, 500)
  }
})

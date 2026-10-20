import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import LockScreen from "../components/LockScreen"
import { lockMinutes } from "../components/SecurityCard"
import { clearUserQueue, listQueue, startQueueSync } from "../lib/offline-queue"
import { clearUserCatalogs } from "../lib/catalog-cache"
import { createBrowserRouter, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router"
import { branches as fallbackBranches } from "../lib/data"
import { supabase } from "../lib/supabase"
import Login from "../components/Login"
import { useAuth } from "../lib/auth-context"
import Shell, { type Page } from "../components/Shell"
import Skeleton from "../components/Skeleton"
import { useApp } from "../lib/app-context"
import GlobalScannerDialog from "../components/GlobalScannerDialog"

const Dashboard = lazy(() => import("../components/Dashboard"))
const Products = lazy(() => import("../components/Products"))
const Scanner = lazy(() => import("../components/Scanner"))
const Backup = lazy(() => import("../components/Backup"))
const Settings = lazy(() => import("../components/Settings"))
const History = lazy(() => import("../components/History"))
const Users = lazy(() => import("../components/Users"))
const StockCount = lazy(() => import("../components/StockCount"))

const pages: Page[] = [
  "dashboard",
  "scan",
  "count",
  "products",
  "users",
  "history",
  "backup",
  "settings",
]

type BranchOption = { code: string; name_en: string; name_ar: string }
const fallbackList: BranchOption[] = fallbackBranches.map((b) => ({ code: b.id, name_en: b.en, name_ar: b.ar }))
const DEFAULT_SESSION_MINUTES = 1440

function tokenSessionId(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: string }
    return payload.session_id ?? ""
  } catch {
    return ""
  }
}

function ProtectedRoutes() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Skeleton variant="dashboard" />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

function LoginRoute() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  if (loading) return <Skeleton variant="dashboard" />
  if (session) return <Navigate to={from?.startsWith("/") ? from : "/"} replace />
  return <Login />
}

function Workspace() {
  const { t } = useApp()
  const navigate = useNavigate()
  const params = useParams()
  const { session } = useAuth()
  const routePage = params.page as Page | undefined
  const page = routePage && pages.includes(routePage) ? routePage : "dashboard"
  const user = session?.user.email?.split("@")[0] ?? ""
  const userId = session?.user.id
  const [branchId, setBranchId] = useState(fallbackBranches[0].id)
  const [branchList, setBranchList] = useState<BranchOption[]>(fallbackList)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannedBarcode, setScannedBarcode] = useState("")
  const openScanner = useCallback(() => setScannerOpen(true), [])
  const closeScanner = useCallback(() => setScannerOpen(false), [])
  const receiveBarcode = useCallback((barcode: string) => {
    setScannedBarcode(barcode)
    navigate("/scan")
  }, [navigate])

  const [locked, setLocked] = useState(() => sessionStorage.getItem("locked") === "1")
  useEffect(() => {
    if (!session) return
    startQueueSync()
  }, [session])

  useEffect(() => {
    if (!session || !userId) return
    const key = `al-saree-session-start:${userId}`
    const sessionId = tokenSessionId(session.access_token)
    let startedAt = Date.now()
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { sessionId?: string; startedAt?: number } | null
      if (saved?.startedAt && saved.sessionId === sessionId) startedAt = saved.startedAt
      else localStorage.setItem(key, JSON.stringify({ sessionId, startedAt }))
    } catch {
      localStorage.setItem(key, JSON.stringify({ sessionId, startedAt }))
    }

    let timer = 0
    const durationKey = `al-saree-session-limit:${userId}`
    const cachedDuration = Number(localStorage.getItem(durationKey))
    let duration = Number.isInteger(cachedDuration) && cachedDuration >= 5 && cachedDuration <= DEFAULT_SESSION_MINUTES
      ? cachedDuration
      : DEFAULT_SESSION_MINUTES
    let expired = false
    const enforce = () => {
      if (expired) return
      const remaining = startedAt + duration * 60_000 - Date.now()
      if (remaining <= 0) {
        expired = true
        localStorage.setItem("al-saree-session-expired", "1")
        localStorage.removeItem(key)
        sessionStorage.removeItem("locked")
        void supabase.auth.signOut()
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(enforce, remaining)
    }
    const refreshDuration = async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("session_duration_minutes")
        .eq("id", userId)
        .maybeSingle()
      const value = Number(data?.session_duration_minutes)
      if (Number.isInteger(value) && value >= 5 && value <= DEFAULT_SESSION_MINUTES) {
        duration = value
        localStorage.setItem(durationKey, String(value))
      }
      enforce()
    }
    const update = () => { void refreshDuration() }
    const onVisibility = () => { if (!document.hidden) update() }
    window.addEventListener("session-limit-change", update)
    window.addEventListener("focus", update)
    document.addEventListener("visibilitychange", onVisibility)
    void refreshDuration()
    return () => {
      expired = true
      window.clearTimeout(timer)
      window.removeEventListener("session-limit-change", update)
      window.removeEventListener("focus", update)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [session?.access_token, userId])

  useEffect(() => {
    if (!user) return
    let timer = 0
    let lastHidden = 0
    const lock = () => { sessionStorage.setItem("locked", "1"); setLocked(true) }
    const arm = () => {
      clearTimeout(timer)
      const mins = lockMinutes()
      if (mins > 0) timer = window.setTimeout(lock, mins * 60_000)
    }
    const vis = () => {
      if (document.hidden) lastHidden = Date.now()
      else if (lastHidden && lockMinutes() > 0 && Date.now() - lastHidden > lockMinutes() * 60_000) lock()
      else arm()
    }
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }))
    document.addEventListener("visibilitychange", vis)
    window.addEventListener("auto-lock-change", arm)
    arm()
    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, arm))
      document.removeEventListener("visibilitychange", vis)
      window.removeEventListener("auto-lock-change", arm)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    let active = true
    const loadBranches = async () => {
      const { data } = await supabase
        .from("branches")
        .select("code,name_en,name_ar")
        .eq("is_active", true)
        .order("code")
      if (!active || !data?.length) return
      setBranchList(data as BranchOption[])
      setBranchId((current) => (data.some((b) => b.code === current) ? current : data[0].code))
    }
    const refresh = () => { void loadBranches() }
    refresh()
    window.addEventListener("branches-updated", refresh)
    return () => {
      active = false
      window.removeEventListener("branches-updated", refresh)
    }
  }, [user])

  const setPage = (nextPage: Page) =>
    navigate(nextPage === "dashboard" ? "/" : `/${nextPage}`)
  const logout = async () => {
    const { data: auth } = await supabase.auth.getSession()
    const userId = auth.session?.user.id
    const pending = userId ? await listQueue().catch(() => []) : []
    const stockKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => !!key?.startsWith("stock-count:"))
    const hasStockCount = stockKeys.some((key) => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { counts?: Record<string, number> } | null
        return Object.keys(saved?.counts ?? {}).length > 0
      } catch {
        return false
      }
    })
    if (pending.length || hasStockCount) {
      const message = t("signOutOfflineWarning").replace("{count}", String(pending.length))
      if (!window.confirm(message)) return
    }
    sessionStorage.removeItem("locked")
    setLocked(false)
    if (userId) {
      await Promise.allSettled([
        clearUserQueue(userId),
        clearUserCatalogs(userId),
      ])
      localStorage.removeItem(`products-ctx:${userId}`)
    }
    stockKeys.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem("passkey-registered")
    if (userId) localStorage.removeItem(`al-saree-session-start:${userId}`)
    void supabase.auth.signOut()
  }

  const current = branchList.find((b) => b.code === branchId) ?? branchList[0]

  return (
    <>
    <Shell
      page={page}
      setPage={setPage}
      branchId={branchId}
      setBranchId={setBranchId}
      branchList={branchList}
      onLogout={logout}
      onScan={openScanner}
    >
      <Suspense fallback={<Skeleton />}>
        {page === "dashboard" && (
          <Dashboard
            branchCode={branchId}
            branchName={{ en: current.name_en, ar: current.name_ar }}
            user={user}
            onScan={openScanner}
          />
        )}
        {page === "scan" && <Scanner branchCode={branchId} scanCode={scannedBarcode} onScanCodeHandled={() => setScannedBarcode("")} />}
        {page === "products" && <Products branchCode={branchId} />}
        {page === "count" && <StockCount branchCode={branchId} />}
        {page === "users" && <Users />}
        {page === "history" && <History />}
        {page === "backup" && <Backup />}
        {page === "settings" && <Settings />}
      </Suspense>
      {locked && (
        <LockScreen
          user={user}
          onUnlock={() => { sessionStorage.removeItem("locked"); setLocked(false) }}
          onLogout={logout}
        />
      )}
    </Shell>
    <GlobalScannerDialog open={scannerOpen} onClose={closeScanner} onScan={receiveBarcode} />
    </>
  )
}

export const router = createBrowserRouter([
  { path: "/login", Component: LoginRoute },
  {
    Component: ProtectedRoutes,
    children: [{ path: "/:page?", Component: Workspace }],
  },
])

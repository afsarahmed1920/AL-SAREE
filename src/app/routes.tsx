import { lazy, Suspense, useEffect, useState } from "react"
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
  const [branchId, setBranchId] = useState(fallbackBranches[0].id)
  const [branchList, setBranchList] = useState<BranchOption[]>(fallbackList)

  const [locked, setLocked] = useState(() => sessionStorage.getItem("locked") === "1")
  useEffect(() => {
    if (!session) return
    startQueueSync()
  }, [session])

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
    void supabase
      .from("branches")
      .select("code,name_en,name_ar")
      .eq("is_active", true)
      .order("code")
      .then(({ data }) => {
        if (!data?.length) return
        setBranchList(data as BranchOption[])
        setBranchId((current) => (data.some((b) => b.code === current) ? current : data[0].code))
      })
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
    void supabase.auth.signOut()
  }

  const current = branchList.find((b) => b.code === branchId) ?? branchList[0]

  return (
    <Shell
      page={page}
      setPage={setPage}
      branchId={branchId}
      setBranchId={setBranchId}
      branchList={branchList}
      onLogout={logout}
    >
      <Suspense fallback={<Skeleton />}>
        {page === "dashboard" && (
          <Dashboard
            branchCode={branchId}
            branchName={{ en: current.name_en, ar: current.name_ar }}
            user={user}
            onScan={() => setPage("scan")}
          />
        )}
        {page === "scan" && <Scanner branchCode={branchId} />}
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
  )
}

export const router = createBrowserRouter([
  { path: "/login", Component: LoginRoute },
  {
    Component: ProtectedRoutes,
    children: [{ path: "/:page?", Component: Workspace }],
  },
])

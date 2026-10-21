import { RouterProvider } from "react-router"
import { AppProvider } from "../lib/app-context"
import { AuthProvider } from "../lib/auth-context"
import { hasSupabaseConfig } from "../lib/config"
import { router } from "./routes"
import { FeedbackProvider } from "../components/FeedbackProvider"

export default function App() {
  if (!hasSupabaseConfig) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-950 px-6 text-center text-white">
        <section className="max-w-xl space-y-3">
          <h1 className="text-xl font-semibold">Supabase configuration is missing</h1>
          <p className="text-sm text-white/70">
            Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your local environment or Vercel project settings, then rebuild.
          </p>
        </section>
      </main>
    )
  }

  return (
    <AuthProvider>
      <AppProvider>
        <FeedbackProvider>
          <RouterProvider router={router} />
        </FeedbackProvider>
      </AppProvider>
    </AuthProvider>
  )
}

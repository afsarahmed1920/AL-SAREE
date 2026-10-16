import { passkeySupported, signInWithPasskey } from "../lib/passkey"
import { useState, type FormEvent } from "react"
import { useLocation, useNavigate } from "react-router"
import { useApp, type Key } from "../lib/app-context"
import { branches } from "../lib/data"
import { useSettings } from "../lib/settings"
import Logo, { useCompanyName } from "./Logo"
import Icon from "./Icon"
import Toggles from "./Toggles"
import { supabase } from "../lib/supabase"

export const toAuthEmail = (u: string) =>
  `${u.trim().toLowerCase()}@store.local`

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const finishLogin = () => navigate(from?.startsWith("/") ? from : "/", { replace: true })
  const { t, lang } = useApp()
  const settings = useSettings()
  const companyName = useCompanyName()
  const [u, setU] = useState("")
  const [p, setP] = useState("")
  const [err, setErr] = useState(false)
  const [passkeyErr, setPasskeyErr] = useState<"failed" | "cancelled" | null>(null)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [modal, setModal] = useState<null | "privacy" | "terms">(null)
  const legalText = modal
    ? settings[`${modal === "privacy" ? "privacy" : "terms"}_${lang}` as "privacy_en"]
    : ""

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(false)
    setPasskeyErr(null)
    const username = u.trim().toLowerCase()
    const { error } = await supabase.auth.signInWithPassword({
      email: toAuthEmail(username),
      password: p,
    })
    if (!error) {
      finishLogin()
    } else {
      setErr(true)
    }
    setBusy(false)
  }

  const field =
    "peer h-[52px] w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 pt-4 text-[15px] text-white outline-none backdrop-blur-md transition-all duration-300 placeholder:text-transparent hover:border-white/20 focus:border-[#ff8a00]/70 focus:bg-white/[0.09] focus:shadow-[0_0_0_4px_rgba(255,138,0,0.12)]"
  const floatLabel =
    "pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-sm text-white/50 transition-all duration-300 peer-focus:top-3.5 peer-focus:text-[11px] peer-focus:tracking-wide peer-focus:text-[#ffb366] peer-[:not(:placeholder-shown)]:top-3.5 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:tracking-wide"

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-[#050812] text-white">
      {/* Animated aurora scene */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="lg-blob absolute -left-32 -top-32 size-[34rem] rounded-full bg-[#1e3a8a] opacity-70 blur-[110px]" />
        <div className="lg-blob lg-blob-2 absolute -bottom-40 -right-24 size-[30rem] rounded-full bg-[#ff8a00] opacity-40 blur-[120px]" />
        <div className="lg-blob lg-blob-3 absolute left-1/2 top-1/3 size-[22rem] rounded-full bg-[#6d28d9] opacity-35 blur-[110px]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.8) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
        {[...Array(14)].map((_, i) => (
          <span
            key={i}
            className="lg-spark absolute size-1 rounded-full bg-white/70"
            style={{
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 100}%`,
              animationDelay: `${(i % 7) * 0.9}s`,
              animationDuration: `${6 + (i % 5)}s`,
            }}
          />
        ))}
      </div>

      <header className="flex items-center justify-between px-6 pt-[max(1rem,env(safe-area-inset-top))] lg:px-10 lg:pt-6">
        <span className="lg-rise font-display text-[11px] tracking-[0.35em] text-[#ff8a00]">
          AL-SAREE · السريع
        </span>
        <div className="lg-rise rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-md">
          <Toggles />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 py-8 lg:grid-cols-[1.1fr_1fr] lg:px-10">
        <section className="hidden lg:block">
          <div className="lg-rise mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 backdrop-blur-md" style={{ animationDelay: "80ms" }}>
            <span className="relative flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative size-2 rounded-full bg-emerald-400" />
            </span>
            {lang === "en" ? "Secure workspace" : "مساحة عمل آمنة"}
          </div>
          <h2 className="lg-rise font-display text-6xl font-semibold leading-[1.05] tracking-tight" style={{ animationDelay: "160ms" }}>
            {lang === "en" ? (
              <>
                Every item,
                <br />
                <span className="lg-shine bg-gradient-to-r from-[#ff8a00] via-[#ffd29a] to-[#ff8a00] bg-clip-text text-transparent">
                  one scan away.
                </span>
              </>
            ) : (
              <>
                كل قطعة،
                <br />
                <span className="lg-shine bg-gradient-to-r from-[#ff8a00] via-[#ffd29a] to-[#ff8a00] bg-clip-text text-transparent">
                  بمسحة واحدة.
                </span>
              </>
            )}
          </h2>
          <p className="lg-rise mt-6 max-w-md text-lg text-white/60" style={{ animationDelay: "240ms" }}>
            {lang === "en"
              ? "1,000+ products, two branches, three prices — private by design."
              : "أكثر من 1000 منتج، فرعان، ثلاثة أسعار — خصوصية بالتصميم."}
          </p>
          <div className="lg-rise mt-10 flex gap-3" style={{ animationDelay: "320ms" }}>
            {(lang === "en" ? ["1,000+ items", "2 branches", "3 price tiers"] : ["+1000 منتج", "فرعان", "3 أسعار"]).map((x) => (
              <div key={x} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80 backdrop-blur-xl">
                {x}
              </div>
            ))}
          </div>
        </section>

        <div className="lg-card-in relative mx-auto w-full max-w-md">
          {/* glowing rotating border */}
          <div aria-hidden className="absolute -inset-px overflow-hidden rounded-[2rem]">
            <div className="lg-spin absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,138,0,0.55)_80deg,transparent_170deg,rgba(59,130,246,0.45)_260deg,transparent_350deg)] opacity-40 blur-md" />
          </div>
          <form
            onSubmit={submit}
            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b1224]/70 p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl sm:p-9"
          >
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-48 rounded-full bg-white/[0.06] blur-2xl" />

            <div className="flex flex-col items-center text-center">
              <div className="lg-float relative rounded-[1.4rem] bg-gradient-to-br from-white/25 to-white/5 p-[3px] shadow-2xl shadow-[#ff8a00]/20">
                <Logo className="size-16 rounded-[1.25rem] text-2xl" />
              </div>
              <div className="mt-4 max-w-full truncate font-display text-lg font-semibold text-white/90">{companyName}</div>
              <h1 className="mt-5 font-display text-2xl font-semibold">{t("signIn")}</h1>
              <p className="mt-1 text-sm text-white/55">{t("signInSub")}</p>
            </div>

            <div className="mt-7 space-y-4">
              <div className="relative">
                <input
                  id="u"
                  placeholder=" "
                  className={field}
                  value={u}
                  onChange={(e) => {
                    setU(e.target.value)
                    setErr(false)
                  }}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  required
                />
                <label htmlFor="u" className={floatLabel}>
                  {t("username")}
                </label>
              </div>
              <div className="relative">
                <input
                  id="p"
                  placeholder=" "
                  type={show ? "text" : "password"}
                  className={`${field} pe-12`}
                  value={p}
                  onChange={(e) => {
                    setP(e.target.value)
                    setErr(false)
                  }}
                  autoComplete="current-password"
                  enterKeyHint="go"
                  required
                />
                <label htmlFor="p" className={floatLabel}>
                  {t("password")}
                </label>
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? t("hidePassword") : t("showPassword")}
                  className="absolute inset-y-0 end-0 grid w-12 place-items-center text-white/50 transition hover:text-white"
                >
                  <Icon name={show ? "eyeOff" : "eye"} className="size-5" />
                </button>
              </div>
            </div>

            {err && (
              <p role="alert" className="lg-shake mt-4 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300 backdrop-blur-md">
                <Icon name="alert" className="size-4 shrink-0" />
                {t("badLogin")}
              </p>
            )}

            <button
              disabled={busy}
              className="group relative mt-7 h-[54px] w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#ff8a00] to-[#ff6a00] text-base font-semibold text-[#0d1426] shadow-lg shadow-[#ff8a00]/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#ff8a00]/40 active:translate-y-0 active:scale-[0.99] disabled:opacity-70"
            >
              <span aria-hidden className="absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/40 blur-md transition-all duration-700 group-hover:left-[120%]" />
              <span className="relative inline-flex items-center justify-center gap-2">
                {busy && <span className="size-4 animate-spin rounded-full border-2 border-[#0d1426]/30 border-t-[#0d1426]" />}
                {busy ? t("syncing") : t("signIn")}
              </span>
            </button>

            {passkeySupported() ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setErr(false)
                    setPasskeyErr(null)
                    setBusy(true)
                    try {
                      await signInWithPasskey()
                      finishLogin()
                    } catch (e) {
                      setPasskeyErr((e as Error)?.name === "NotAllowedError" ? "cancelled" : "failed")
                    } finally {
                      setBusy(false)
                    }
                  }}
                  className="mt-3 inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] text-[15px] font-medium text-white backdrop-blur-md transition hover:bg-white/[0.1] disabled:opacity-60"
                >
                  <Icon name="key" className="size-5 text-[#ffb366]" />
                  {t("usePasskey")}
                </button>
                <p className="mt-2 text-center text-xs leading-5 text-white/55">{t("passkeyLoginHint")}</p>
                {passkeyErr && (
                  <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300 backdrop-blur-md">
                    {t(passkeyErr === "cancelled" ? "passkeyLoginCancelled" : "passkeyLoginFailed")}
                  </p>
                )}
              </>
            ) : (
              <p role="status" className="mt-3 text-center text-sm text-white/55">{t("passkeyUnsupported")}</p>
            )}
          </form>
        </div>
      </div>

      <footer className="border-t border-white/[0.06] bg-white/[0.02] px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 text-xs text-white/50 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 text-center lg:flex-row lg:flex-wrap lg:items-start lg:justify-between lg:gap-x-8 lg:px-4 lg:text-start">
          {settings.contact_numbers.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {settings.contact_numbers.map((ph) => (
                <a
                  key={ph}
                  href={`tel:${ph.replace(/[^\d+]/g, "")}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 font-medium text-white/80 backdrop-blur-md transition hover:bg-white/10"
                >
                  <Icon name="phone" className="size-3.5" />
                  <span dir="ltr">{ph}</span>
                </a>
              ))}
            </div>
          )}
          <div className="space-y-1">
            {branches.map((b) => {
              const address = lang === "en" ? settings.branch_addresses[b.id]?.en : settings.branch_addresses[b.id]?.ar
              if (!address) return null
              return <div key={b.id}>{lang === "en" ? b.en : b.ar}: {address}</div>
            })}
          </div>
          <div className="flex gap-5 font-medium text-[#ffb366]">
            <button type="button" onClick={() => setModal("privacy")} className="py-1 underline-offset-2 hover:underline">
              {t("privacy")}
            </button>
            <button type="button" onClick={() => setModal("terms")} className="py-1 underline-offset-2 hover:underline">
              {t("terms")}
            </button>
          </div>
        </div>
      </footer>

      {modal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="lg-card-in w-full max-w-md rounded-3xl border border-white/10 bg-[#0b1224]/80 p-6 text-white shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">
                {t(modal as Key)}
              </h3>
              <button onClick={() => setModal(null)} aria-label={t("close")}>
                <Icon name="x" />
              </button>
            </div>
            <p className="max-h-[60vh] overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-white/65">
              {legalText || t(modal === "privacy" ? "privacyBody" : "termsBody")}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

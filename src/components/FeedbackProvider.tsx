import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react"
import { useApp } from "../lib/app-context"
import Icon from "./Icon"

type ToastKind = "success" | "error" | "info"
type Toast = { id: string; kind: ToastKind; message: string; action?: { label: string; run: () => void } }
type ConfirmOptions = { title: string; message: string; confirmLabel?: string; destructive?: boolean }
type FeedbackApi = {
  toast: (kind: ToastKind, message: string, action?: Toast["action"]) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useApp()
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmation, setConfirmation] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null)
  const timers = useRef(new Map<string, number>())
  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])
  const toast = useCallback((kind: ToastKind, message: string, action?: Toast["action"]) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current.slice(-2), { id, kind, message, action }])
    if (kind !== "error") timers.current.set(id, window.setTimeout(() => dismiss(id), 3500))
  }, [dismiss])
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setConfirmation({ ...options, resolve })
  }), [])
  const finishConfirm = useCallback((value: boolean) => {
    setConfirmation((current) => {
      current?.resolve(value)
      return null
    })
  }, [])

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), [])

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[120] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:end-4 sm:items-end" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => <ToastItem key={item.id} item={item} lang={lang} dismiss={dismiss} dismissLabel={t("dismiss")} />)}
      </div>
      {confirmation && (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") finishConfirm(false) }}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" onKeyDown={(event) => {
            if (event.key !== "Tab") return
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
            const first = buttons[0]
            const last = buttons[buttons.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }} className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400"><Icon name="alert" className="size-5" /></span>
              <div className="min-w-0"><h2 id="confirm-title" className="font-display text-lg font-semibold text-ink">{confirmation.title}</h2><p id="confirm-description" className="mt-2 text-sm leading-6 text-ink2">{confirmation.message}</p></div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" autoFocus onClick={() => finishConfirm(false)} className="h-11 rounded-xl border border-line2 px-4 text-sm font-semibold text-ink">{t("cancel")}</button>
              <button type="button" onClick={() => finishConfirm(true)} className={`h-11 rounded-xl px-4 text-sm font-semibold text-white ${confirmation.destructive === false ? "bg-brand" : "bg-red-600 hover:bg-red-700"}`}>{confirmation.confirmLabel ?? t("confirm")}</button>
            </div>
          </section>
        </div>
      )}
    </FeedbackContext.Provider>
  )
}

function ToastItem({ item, lang, dismiss, dismissLabel }: { item: Toast; lang: string; dismiss: (id: string) => void; dismissLabel: string }) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => { start.current = { x: event.clientX, y: event.clientY } }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) dismiss(item.id)
    start.current = null
  }
  return (
    <div onPointerDown={onPointerDown} onPointerUp={onPointerUp} dir={lang === "ar" ? "rtl" : "ltr"}
      role={item.kind === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full max-w-md touch-pan-y items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-xl ${item.kind === "success" ? "border-emerald-500/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : item.kind === "error" ? "border-red-500/30 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100" : "border-line2 bg-surface text-ink"}`}>
      <span className="min-w-0 flex-1">{item.message}</span>
      {item.action && <button type="button" onClick={item.action.run} className="shrink-0 font-semibold underline">{item.action.label}</button>}
      <button type="button" onClick={() => dismiss(item.id)} aria-label={dismissLabel} className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-black/5"><Icon name="x" className="size-4" /></button>
    </div>
  )
}

export function useFeedback() {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error("useFeedback outside FeedbackProvider")
  return value
}

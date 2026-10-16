import { useEffect, useState } from "react"
import { useApp } from "../lib/app-context"
import Icon from "./Icon"

type InstallEvent = Event & { prompt: () => Promise<void> }

export default function InstallCard() {
  const { t } = useApp()
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as InstallEvent)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    return () => window.removeEventListener("beforeinstallprompt", onPrompt)
  }, [])

  if (standalone) return null

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold text-ink">{t("installApp")}</h2>
      <p className="mb-4 mt-1 text-sm text-ink2">{ios ? t("installIos") : t("installSub")}</p>
      {event && (
        <button
          type="button"
          onClick={() => void event.prompt().then(() => setEvent(null))}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-on-brand"
        >
          <Icon name="upload" className="size-4" /> {t("installApp")}
        </button>
      )}
    </section>
  )
}

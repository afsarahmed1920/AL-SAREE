import { useApp } from "../lib/app-context"
import Icon from "./Icon"

const btn =
  "glass inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink transition hover:-translate-y-px hover:shadow-md"

export default function Toggles() {
  const { lang, setLang, theme, setTheme, t } = useApp()
  return (
    <div className="flex items-center gap-2">
      <button className={btn} onClick={() => setLang(lang === "en" ? "ar" : "en")} aria-label="Language">
        <Icon name="globe" className="size-4" />
        {lang === "en" ? "العربية" : "EN"}
      </button>
      <button className={btn} onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={theme === "light" ? t("dark") : t("light")}>
        <Icon name={theme === "light" ? "moon" : "sun"} className="size-4" />
        <span className="hidden sm:inline">{theme === "light" ? t("dark") : t("light")}</span>
      </button>
    </div>
  )
}

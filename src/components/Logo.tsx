import { useApp } from "../lib/app-context"
import { useSettings } from "../lib/settings"

export function useCompanyName() {
  const { lang } = useApp()
  const s = useSettings()
  return lang === "en" ? s.company_name_en : s.company_name_ar
}

export default function Logo({ className }: { className: string }) {
  const s = useSettings()
  const name = useCompanyName()
  return s.logo_url ? (
    <img src={s.logo_url} alt={name} className={`${className} bg-surface object-contain`} />
  ) : (
    <div className={`${className} grid place-items-center bg-brand font-display font-bold text-on-brand`}>{name[0]}</div>
  )
}

import { useApp } from "../lib/app-context"

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-xl bg-surface2 motion-safe:animate-pulse ${className}`} />
}

export default function Skeleton({ variant = "list" }: { variant?: "dashboard" | "list" }) {
  const { t } = useApp()
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-6xl space-y-5">
      <span className="sr-only">{t("syncing")}</span>
      <div aria-hidden="true" className="space-y-3">
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-4 w-64 max-w-full" />
      </div>
      {variant === "dashboard" && (
        <div aria-hidden="true" className="space-y-5">
          <SkeletonBlock className="h-64 w-full rounded-3xl" />
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="h-40 rounded-3xl" />)}
          </div>
        </div>
      )}
      <div aria-hidden="true" className="rounded-3xl border border-line bg-surface p-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-4 border-b border-line py-5 last:border-0">
            <SkeletonBlock className="size-10 shrink-0" />
            <div className="flex-1 space-y-3">
              <SkeletonBlock className="h-4 w-2/3" />
              <SkeletonBlock className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

import { AlertTriangle, Settings, X } from "lucide-react"
import { useLocalMaintenanceStore, shouldShowLocalMaintenanceBanner } from "@/stores/local-maintenance-store"
import type { LocalMaintenanceReminder } from "@/stores/local-maintenance-store"
import { useWikiStore } from "@/stores/wiki-store"
import { openMaintenanceSettings } from "@/lib/open-maintenance-settings"

const DAY_MS = 86_400_000

export function LocalMaintenanceBanner() {
  const reminder = useLocalMaintenanceStore((s) => s.reminder)
  const visible = useLocalMaintenanceStore((s) => shouldShowLocalMaintenanceBanner(s))
  const dismissReminder = useLocalMaintenanceStore((s) => s.dismissReminder)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  if (!visible || !reminder) return null

  return (
    <LocalMaintenanceBannerView
      reminder={reminder}
      onOpenMaintenance={() => openMaintenanceSettings(setActiveView)}
      onDismiss={dismissReminder}
    />
  )
}

export function LocalMaintenanceBannerView({
  reminder,
  onOpenMaintenance,
  onDismiss,
}: {
  reminder: LocalMaintenanceReminder
  onOpenMaintenance: () => void
  onDismiss: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
        </div>
        <span className="truncate font-medium">
          Maintenance due
        </span>
        <span className="truncate text-xs text-amber-800/80 dark:text-amber-100/80">
          {summaryText(reminder)}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpenMaintenance}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-700"
      >
        <Settings className="h-3.5 w-3.5" />
        Open Settings
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-amber-800/75 transition-colors hover:bg-amber-500/15 hover:text-amber-950 dark:text-amber-100/75 dark:hover:text-amber-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function summaryText(reminder: LocalMaintenanceReminder): string {
  const reasons = reminder.dueReasons.map(reasonLabel).join(", ")
  const parts = [
    reasons,
    `${reminder.eventCountSincePatrol} event${reminder.eventCountSincePatrol === 1 ? "" : "s"}`,
  ]

  const dirtyDays = daysSince(reminder.dirtySince, reminder.createdAt)
  if (dirtyDays !== null) parts.push(`dirty for ${dirtyDays}d`)

  const patrolDays = daysSince(reminder.lastPatrolAt, reminder.createdAt)
  if (patrolDays !== null) parts.push(`last patrol ${patrolDays}d ago`)

  return parts.join(" · ")
}

function reasonLabel(reason: string): string {
  if (reason === "event-threshold") return "event threshold"
  if (reason === "time-interval") return "time interval"
  return reason
}

function daysSince(value: number | undefined, now: number): number | null {
  if (value === undefined) return null
  return Math.max(0, Math.floor((now - value) / DAY_MS))
}

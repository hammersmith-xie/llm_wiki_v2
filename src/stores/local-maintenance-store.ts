import { create } from "zustand"
import type { MemoryOpsMaintenanceDueReason } from "@/lib/memory-ops"

export interface LocalMaintenanceReminder {
  projectPath: string
  dueReasons: MemoryOpsMaintenanceDueReason[]
  eventCountSincePatrol: number
  dirtySince?: number
  lastPatrolAt?: number
  createdAt: number
}

export interface LocalMaintenanceState {
  reminder: LocalMaintenanceReminder | null
  dismissedReminderKey: string | null
  setReminder: (reminder: LocalMaintenanceReminder) => void
  dismissReminder: () => void
  clearReminder: () => void
}

export const useLocalMaintenanceStore = create<LocalMaintenanceState>((set) => ({
  reminder: null,
  dismissedReminderKey: null,
  setReminder: (reminder) =>
    set({
      reminder,
      dismissedReminderKey: null,
    }),
  dismissReminder: () =>
    set((state) => ({
      dismissedReminderKey: state.reminder ? reminderKey(state.reminder) : null,
    })),
  clearReminder: () =>
    set({
      reminder: null,
      dismissedReminderKey: null,
    }),
}))

export function shouldShowLocalMaintenanceBanner(
  state: Pick<LocalMaintenanceState, "reminder" | "dismissedReminderKey">,
): boolean {
  if (!state.reminder) return false
  return state.dismissedReminderKey !== reminderKey(state.reminder)
}

function reminderKey(reminder: LocalMaintenanceReminder): string {
  return [
    reminder.projectPath,
    reminder.createdAt,
    reminder.eventCountSincePatrol,
    reminder.dueReasons.join("+"),
  ].join("|")
}

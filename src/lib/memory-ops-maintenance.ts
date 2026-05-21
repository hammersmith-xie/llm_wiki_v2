import {
  DEFAULT_MEMORY_OPS_POLICY,
  type MemoryOpsPolicy,
} from "@/lib/memory-ops-policy"
import type {
  PersistedMemoryOpsMaintenanceState,
} from "@/lib/project-store"
import type {
  MemoryOpsMaintenanceEventOptions,
  MemoryOpsMaintenanceEventResult,
  MemoryOpsMaintenanceStatus,
} from "@/lib/memory-ops-types"

const MEMORY_OPS_EVENT_THRESHOLD = 5
const MEMORY_OPS_REMINDER_COOLDOWN_MS = 30 * 60 * 1000

export function reduceMemoryOpsMaintenanceEvent(
  state: PersistedMemoryOpsMaintenanceState | null | undefined,
  options: MemoryOpsMaintenanceEventOptions = {},
): MemoryOpsMaintenanceEventResult {
  const now = options.now ?? Date.now()
  const schedule = maintenanceScheduleFromOptions(options)
  const current = normalizeMaintenanceState(state)
  const eventCountSincePatrol = current.eventCountSincePatrol + 1
  const dirtySince = current.dirtySince ?? now
  const reminderCooldownElapsed =
    current.lastReminderAt === undefined || now - current.lastReminderAt >= schedule.reminderCooldownMs
  const patrolIntervalElapsed =
    current.lastPatrolAt === undefined || now - current.lastPatrolAt >= schedule.minPatrolIntervalMs
  const eventDue = eventCountSincePatrol >= schedule.eventThreshold
  const timeDue =
    schedule.timeIntervalMs > 0 &&
    current.lastPatrolAt !== undefined &&
    now - current.lastPatrolAt >= schedule.timeIntervalMs
  const dueReasons = [
    ...(eventDue ? ["event-threshold" as const] : []),
    ...(timeDue ? ["time-interval" as const] : []),
  ]
  const reminderDue = dueReasons.length > 0 && reminderCooldownElapsed && patrolIntervalElapsed

  return {
    state: {
      ...current,
      dirtySince,
      eventCountSincePatrol,
      lastReminderAt: reminderDue ? now : current.lastReminderAt,
    },
    reminderDue,
    dueReasons: reminderDue ? dueReasons : [],
  }
}

export function completeMemoryOpsPatrolCooldown(
  _state: PersistedMemoryOpsMaintenanceState | null | undefined,
  now = Date.now(),
): PersistedMemoryOpsMaintenanceState {
  return {
    lastPatrolAt: now,
    eventCountSincePatrol: 0,
  }
}

export function summarizeMemoryOpsMaintenanceStatus(
  state: PersistedMemoryOpsMaintenanceState | null | undefined,
  options: MemoryOpsMaintenanceEventOptions = {},
): MemoryOpsMaintenanceStatus {
  const now = options.now ?? Date.now()
  const schedule = maintenanceScheduleFromOptions(options)
  const current = normalizeMaintenanceState(state)
  const reminderCooldownElapsed =
    current.lastReminderAt === undefined || now - current.lastReminderAt >= schedule.reminderCooldownMs
  const patrolIntervalElapsed =
    current.lastPatrolAt === undefined || now - current.lastPatrolAt >= schedule.minPatrolIntervalMs
  const eventDue = current.eventCountSincePatrol >= schedule.eventThreshold
  const timeDue =
    schedule.timeIntervalMs > 0 &&
    current.lastPatrolAt !== undefined &&
    now - current.lastPatrolAt >= schedule.timeIntervalMs
  const dueReasons = [
    ...(eventDue ? ["event-threshold" as const] : []),
    ...(timeDue ? ["time-interval" as const] : []),
  ]
  const reminderDue = dueReasons.length > 0 && reminderCooldownElapsed && patrolIntervalElapsed
  const needsPatrol = current.eventCountSincePatrol > 0
  return {
    ...current,
    status: reminderDue ? "reminder-due" : needsPatrol ? "dirty" : "clean",
    needsPatrol,
    reminderDue,
    dueReasons: reminderDue ? dueReasons : [],
  }
}

function normalizeMaintenanceState(
  state: PersistedMemoryOpsMaintenanceState | null | undefined,
): PersistedMemoryOpsMaintenanceState {
  return {
    lastPatrolAt: state?.lastPatrolAt,
    dirtySince: state?.dirtySince,
    eventCountSincePatrol: state?.eventCountSincePatrol ?? 0,
    lastReminderAt: state?.lastReminderAt,
  }
}

function maintenanceScheduleFromOptions(options: MemoryOpsMaintenanceEventOptions): {
  eventThreshold: number
  reminderCooldownMs: number
  minPatrolIntervalMs: number
  timeIntervalMs: number
} {
  const policy: MemoryOpsPolicy = options.policy ?? DEFAULT_MEMORY_OPS_POLICY
  return {
    eventThreshold: options.eventThreshold ?? policy.automation.eventThreshold ?? MEMORY_OPS_EVENT_THRESHOLD,
    reminderCooldownMs:
      options.reminderCooldownMs ??
      minutesToMs(policy.automation.reminderCooldownMinutes) ??
      MEMORY_OPS_REMINDER_COOLDOWN_MS,
    minPatrolIntervalMs:
      options.minPatrolIntervalMs ??
      minutesToMs(policy.automation.minPatrolIntervalMinutes) ??
      0,
    timeIntervalMs:
      options.timeIntervalMs ??
      hoursToMs(policy.automation.timeIntervalHours) ??
      0,
  }
}

function minutesToMs(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value * 60 * 1000
    : undefined
}

function hoursToMs(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value * 60 * 60 * 1000
    : undefined
}

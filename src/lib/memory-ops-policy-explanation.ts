import {
  DEFAULT_MEMORY_OPS_POLICY,
  type MemoryOpsPolicy,
} from "@/lib/memory-ops-policy"
import type { MemoryOpsMaintenanceStatus } from "@/lib/memory-ops-types"

export type MemoryOpsPolicyExplanationKind =
  | "clean"
  | "never-run"
  | "event-progress"
  | "event-threshold-due"
  | "time-interval-due"
  | "cooldown-blocked"
  | "min-interval-blocked"
  | "auto-enabled"
  | "auto-disabled"

export interface MemoryOpsPolicyExplanation {
  kind: MemoryOpsPolicyExplanationKind
  severity: "success" | "info" | "warning"
  count?: number
  threshold?: number
  minutes?: number
  hours?: number
}

const DEFAULT_EVENT_THRESHOLD = 5
const DEFAULT_REMINDER_COOLDOWN_MINUTES = 30

export function explainMemoryOpsPolicyStatus(
  status: MemoryOpsMaintenanceStatus,
  policy: MemoryOpsPolicy = DEFAULT_MEMORY_OPS_POLICY,
  options: { now?: number } = {},
): MemoryOpsPolicyExplanation[] {
  const now = options.now ?? Date.now()
  const eventThreshold = positiveInteger(
    policy.automation.eventThreshold,
    DEFAULT_EVENT_THRESHOLD,
  )
  const reminderCooldownMs = minutesToMs(
    policy.automation.reminderCooldownMinutes,
    DEFAULT_REMINDER_COOLDOWN_MINUTES * 60_000,
  )
  const minPatrolIntervalMs = minutesToMs(policy.automation.minPatrolIntervalMinutes, 0)
  const timeIntervalMs = hoursToMs(policy.automation.timeIntervalHours, 0)
  const eventDue = status.eventCountSincePatrol >= eventThreshold
  const timeDue =
    timeIntervalMs > 0 &&
    status.lastPatrolAt !== undefined &&
    now - status.lastPatrolAt >= timeIntervalMs
  const explanations: MemoryOpsPolicyExplanation[] = []

  if (status.eventCountSincePatrol === 0) {
    explanations.push(status.lastPatrolAt === undefined
      ? { kind: "never-run", severity: "info" }
      : { kind: "clean", severity: "success" })
  } else if (eventDue) {
    explanations.push({
      kind: "event-threshold-due",
      severity: "warning",
      count: status.eventCountSincePatrol,
      threshold: eventThreshold,
    })
  } else {
    explanations.push({
      kind: "event-progress",
      severity: "info",
      count: status.eventCountSincePatrol,
      threshold: eventThreshold,
    })
  }

  if (timeDue) {
    explanations.push({
      kind: "time-interval-due",
      severity: "warning",
      hours: msToHours(timeIntervalMs),
    })
  }

  if (eventDue || timeDue || status.needsPatrol) {
    const cooldownRemainingMs = remainingMs(
      status.lastReminderAt,
      reminderCooldownMs,
      now,
    )
    if (cooldownRemainingMs > 0) {
      explanations.push({
        kind: "cooldown-blocked",
        severity: "info",
        minutes: msToCeilMinutes(cooldownRemainingMs),
      })
    }

    const minIntervalRemainingMs = remainingMs(
      status.lastPatrolAt,
      minPatrolIntervalMs,
      now,
    )
    if (minIntervalRemainingMs > 0) {
      explanations.push({
        kind: "min-interval-blocked",
        severity: "info",
        minutes: msToCeilMinutes(minIntervalRemainingMs),
      })
    }
  }

  explanations.push(policy.automation.autoPatrolEnabled
    ? { kind: "auto-enabled", severity: "success" }
    : { kind: "auto-disabled", severity: "warning" })

  return explanations
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function minutesToMs(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value * 60_000
    : fallback
}

function hoursToMs(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value * 3_600_000
    : fallback
}

function remainingMs(
  since: number | undefined,
  intervalMs: number,
  now: number,
): number {
  if (since === undefined || intervalMs <= 0) return 0
  return Math.max(0, intervalMs - (now - since))
}

function msToCeilMinutes(value: number): number {
  return Math.max(1, Math.ceil(value / 60_000))
}

function msToHours(value: number): number {
  return Math.round((value / 3_600_000) * 100) / 100
}

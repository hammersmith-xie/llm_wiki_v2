import { describe, expect, it } from "vitest"
import { DEFAULT_MEMORY_OPS_POLICY } from "./memory-ops-policy"
import { explainMemoryOpsPolicyStatus } from "./memory-ops-policy-explanation"
import type { MemoryOpsMaintenanceStatus } from "./memory-ops-types"

describe("memory ops policy explanation", () => {
  it("explains progress toward the event threshold", () => {
    const explanations = explainMemoryOpsPolicyStatus(status({
      eventCountSincePatrol: 2,
      lastPatrolAt: 1_000,
      needsPatrol: true,
      status: "dirty",
    }), policy({ eventThreshold: 5 }), { now: 60_000 })

    expect(explanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "event-progress",
          count: 2,
          threshold: 5,
        }),
      ]),
    )
  })

  it("explains threshold due state", () => {
    const explanations = explainMemoryOpsPolicyStatus(status({
      eventCountSincePatrol: 5,
      lastPatrolAt: 1_000,
      needsPatrol: true,
      reminderDue: true,
      status: "reminder-due",
    }), policy({ eventThreshold: 5 }), { now: 3_600_000 })

    expect(explanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "event-threshold-due",
          count: 5,
          threshold: 5,
        }),
      ]),
    )
  })

  it("explains reminder cooldown blocking a due state", () => {
    const explanations = explainMemoryOpsPolicyStatus(status({
      eventCountSincePatrol: 5,
      lastPatrolAt: 1_000,
      lastReminderAt: 25 * 60_000,
      needsPatrol: true,
      status: "dirty",
    }), policy({
      eventThreshold: 5,
      reminderCooldownMinutes: 30,
      minPatrolIntervalMinutes: 0,
    }), { now: 30 * 60_000 })

    expect(explanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "cooldown-blocked",
          minutes: 25,
        }),
      ]),
    )
  })

  it("explains minimum patrol interval blocking another patrol", () => {
    const explanations = explainMemoryOpsPolicyStatus(status({
      eventCountSincePatrol: 5,
      lastPatrolAt: 25 * 60_000,
      needsPatrol: true,
      status: "dirty",
    }), policy({
      eventThreshold: 5,
      minPatrolIntervalMinutes: 30,
      reminderCooldownMinutes: 0,
    }), { now: 30 * 60_000 })

    expect(explanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "min-interval-blocked",
          minutes: 25,
        }),
      ]),
    )
  })

  it("explains disabled automation", () => {
    const explanations = explainMemoryOpsPolicyStatus(status(), policy({
      autoPatrolEnabled: false,
    }))

    expect(explanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "auto-disabled" }),
      ]),
    )
  })

  it("explains a clean state", () => {
    const explanations = explainMemoryOpsPolicyStatus(status({
      eventCountSincePatrol: 0,
      lastPatrolAt: 1_000,
      status: "clean",
      needsPatrol: false,
    }), policy(), { now: 2_000 })

    expect(explanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "clean" }),
      ]),
    )
    expect(explanations.some((item) => item.kind === "event-progress")).toBe(false)
  })
})

function status(
  overrides: Partial<MemoryOpsMaintenanceStatus> = {},
): MemoryOpsMaintenanceStatus {
  return {
    eventCountSincePatrol: 0,
    needsPatrol: false,
    reminderDue: false,
    dueReasons: [],
    status: "clean",
    ...overrides,
  }
}

function policy(overrides: Partial<typeof DEFAULT_MEMORY_OPS_POLICY.automation> = {}) {
  return {
    ...DEFAULT_MEMORY_OPS_POLICY,
    automation: {
      ...DEFAULT_MEMORY_OPS_POLICY.automation,
      ...overrides,
    },
  }
}

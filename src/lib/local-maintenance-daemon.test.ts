import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  runLocalMaintenanceCheck,
  startLocalMaintenanceDaemon,
} from "./local-maintenance-daemon"
import { DEFAULT_MEMORY_OPS_POLICY } from "./memory-ops-policy"
import type { MemoryOpsMaintenanceStatus } from "./memory-ops"
import { useActivityStore } from "@/stores/activity-store"

vi.mock("./memory-ops-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./memory-ops-policy")>()
  return {
    ...actual,
    loadMemoryOpsPolicy: vi.fn(async () => ({ policy: actual.DEFAULT_MEMORY_OPS_POLICY, warnings: [] })),
  }
})

vi.mock("./memory-ops", () => ({
  getMemoryOpsMaintenanceStatus: vi.fn(async () => status({ reminderDue: false })),
  scheduleAutoMemoryOpsPatrol: vi.fn(() => true),
}))

import { loadMemoryOpsPolicy } from "./memory-ops-policy"
import {
  getMemoryOpsMaintenanceStatus,
  scheduleAutoMemoryOpsPatrol,
} from "./memory-ops"

const mockLoadPolicy = vi.mocked(loadMemoryOpsPolicy)
const mockGetStatus = vi.mocked(getMemoryOpsMaintenanceStatus)
const mockSchedulePatrol = vi.mocked(scheduleAutoMemoryOpsPatrol)

beforeEach(() => {
  vi.useRealTimers()
  mockLoadPolicy.mockReset()
  mockLoadPolicy.mockResolvedValue({ policy: DEFAULT_MEMORY_OPS_POLICY, warnings: [] })
  mockGetStatus.mockReset()
  mockGetStatus.mockResolvedValue(status({ reminderDue: false }))
  mockSchedulePatrol.mockReset()
  mockSchedulePatrol.mockReturnValue(true)
  useActivityStore.setState({ items: [] })
})

describe("local maintenance daemon", () => {
  it("only reads policy and maintenance status when nothing is due", async () => {
    await runLocalMaintenanceCheck("/project")

    expect(mockLoadPolicy).toHaveBeenCalledWith("/project")
    expect(mockGetStatus).toHaveBeenCalledWith("/project")
    expect(mockSchedulePatrol).not.toHaveBeenCalled()
    expect(useActivityStore.getState().items).toEqual([])
  })

  it("records a reminder without scheduling patrol when auto patrol is disabled", async () => {
    mockLoadPolicy.mockResolvedValue({
      policy: {
        ...DEFAULT_MEMORY_OPS_POLICY,
        automation: {
          ...DEFAULT_MEMORY_OPS_POLICY.automation,
          autoPatrolEnabled: false,
        },
      },
      warnings: [],
    })
    mockGetStatus.mockResolvedValue(status({ reminderDue: true }))

    await runLocalMaintenanceCheck("/project")

    expect(mockSchedulePatrol).not.toHaveBeenCalled()
    expect(useActivityStore.getState().items).toEqual([
      expect.objectContaining({
        type: "maintenance",
        title: "Memory Ops patrol recommended",
        status: "done",
        detail: "Local daemon found patrol due: event-threshold, time-interval.",
      }),
    ])
  })

  it("schedules auto patrol when policy allows it and maintenance is due", async () => {
    mockGetStatus.mockResolvedValue(status({ reminderDue: true }))

    await runLocalMaintenanceCheck("/project")

    expect(mockSchedulePatrol).toHaveBeenCalledWith(
      "/project",
      "local-maintenance-daemon",
    )
  })

  it("uses a 15 minute default interval and stop clears the loop", async () => {
    vi.useFakeTimers()
    const handle = startLocalMaintenanceDaemon("/project")

    expect(mockGetStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(mockGetStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(mockGetStatus).toHaveBeenCalledTimes(2)

    handle.stop()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(mockGetStatus).toHaveBeenCalledTimes(2)
  })

  it("dedupes repeated starts for the same project and allows restart after stop", async () => {
    vi.useFakeTimers()
    const first = startLocalMaintenanceDaemon("/project", { intervalMs: 1_000 })
    const second = startLocalMaintenanceDaemon("/project", { intervalMs: 1_000 })

    expect(second.active).toBe(false)
    expect(mockGetStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(mockGetStatus).toHaveBeenCalledTimes(2)

    first.stop()
    const third = startLocalMaintenanceDaemon("/project", { intervalMs: 1_000 })

    expect(third.active).toBe(true)
    expect(mockGetStatus).toHaveBeenCalledTimes(3)
    third.stop()
  })

  it("does not run overlapping checks when a prior tick is still in flight", async () => {
    vi.useFakeTimers()
    let resolveStatus: (value: MemoryOpsMaintenanceStatus) => void = () => {}
    mockGetStatus.mockImplementation(
      () => new Promise((resolve) => {
        resolveStatus = resolve
      }),
    )

    const handle = startLocalMaintenanceDaemon("/project", { intervalMs: 1_000 })

    expect(mockGetStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mockGetStatus).toHaveBeenCalledTimes(1)

    resolveStatus(status({ reminderDue: false }))
    await vi.runOnlyPendingTimersAsync()
    expect(mockGetStatus).toHaveBeenCalledTimes(2)
    handle.stop()
  })

  it("captures check failures without throwing into the daemon loop", async () => {
    const error = new Error("store unavailable")
    mockGetStatus.mockRejectedValue(error)
    const onError = vi.fn()

    await expect(runLocalMaintenanceCheck("/project", { onError })).resolves.toBeNull()

    expect(onError).toHaveBeenCalledWith(error)
    expect(useActivityStore.getState().items).toEqual([
      expect.objectContaining({
        title: "Local maintenance check failed",
        status: "error",
        detail: "store unavailable",
      }),
    ])
  })
})

function status(
  overrides: Partial<MemoryOpsMaintenanceStatus>,
): MemoryOpsMaintenanceStatus {
  return {
    eventCountSincePatrol: 0,
    status: "clean",
    needsPatrol: false,
    reminderDue: false,
    dueReasons: [],
    ...overrides,
    ...(overrides.reminderDue
      ? {
          status: "reminder-due" as const,
          needsPatrol: true,
          dueReasons: ["event-threshold", "time-interval"] as const,
        }
      : {}),
  }
}

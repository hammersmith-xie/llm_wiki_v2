import { beforeEach, describe, expect, it } from "vitest"
import {
  shouldShowLocalMaintenanceBanner,
  useLocalMaintenanceStore,
  type LocalMaintenanceReminder,
} from "./local-maintenance-store"

beforeEach(() => {
  useLocalMaintenanceStore.getState().clearReminder()
})

describe("local maintenance store", () => {
  it("shows an undismissed reminder", () => {
    useLocalMaintenanceStore.getState().setReminder({
      projectPath: "/project",
      dueReasons: ["event-threshold"],
      eventCountSincePatrol: 6,
      dirtySince: 1_000,
      lastPatrolAt: 2_000,
      createdAt: 3_000,
    })

    expect(shouldShowLocalMaintenanceBanner(useLocalMaintenanceStore.getState())).toBe(true)
  })

  it("dismisses only the current session reminder", () => {
    const store = useLocalMaintenanceStore.getState()
    const currentReminder: LocalMaintenanceReminder = {
      projectPath: "/project",
      dueReasons: ["time-interval"],
      eventCountSincePatrol: 0,
      lastPatrolAt: 1_000,
      createdAt: 2_000,
    }
    store.setReminder(currentReminder)
    store.dismissReminder()

    expect(shouldShowLocalMaintenanceBanner(useLocalMaintenanceStore.getState())).toBe(false)

    useLocalMaintenanceStore.getState().setReminder({
      ...currentReminder,
      createdAt: 3_000,
    })

    expect(shouldShowLocalMaintenanceBanner(useLocalMaintenanceStore.getState())).toBe(false)

    useLocalMaintenanceStore.getState().setReminder({
      projectPath: "/project",
      dueReasons: ["event-threshold"],
      eventCountSincePatrol: 7,
      dirtySince: 3_000,
      createdAt: 4_000,
    })

    expect(shouldShowLocalMaintenanceBanner(useLocalMaintenanceStore.getState())).toBe(true)
  })
})

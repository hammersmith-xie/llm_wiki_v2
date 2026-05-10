import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  startProjectLocalMaintenanceDaemon,
  startProjectLocalMaintenanceLifecycle,
} from "./project-local-maintenance"
import { DEFAULT_MEMORY_OPS_POLICY } from "./memory-ops-policy"
import type { LocalMaintenanceDaemonHandle } from "./local-maintenance-daemon"

vi.mock("./memory-ops-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./memory-ops-policy")>()
  return {
    ...actual,
    loadMemoryOpsPolicy: vi.fn(async () => ({
      policy: actual.DEFAULT_MEMORY_OPS_POLICY,
      warnings: [],
    })),
  }
})

vi.mock("./local-maintenance-daemon", () => ({
  startLocalMaintenanceDaemon: vi.fn(() => handle()),
}))

import { loadMemoryOpsPolicy } from "./memory-ops-policy"
import { startLocalMaintenanceDaemon } from "./local-maintenance-daemon"

const mockLoadPolicy = vi.mocked(loadMemoryOpsPolicy)
const mockStartDaemon = vi.mocked(startLocalMaintenanceDaemon)

beforeEach(() => {
  mockLoadPolicy.mockReset()
  mockLoadPolicy.mockResolvedValue({ policy: DEFAULT_MEMORY_OPS_POLICY, warnings: [] })
  mockStartDaemon.mockReset()
  mockStartDaemon.mockReturnValue(handle())
})

describe("project local maintenance lifecycle", () => {
  it("starts the app-resident daemon with the default 15 minute interval", async () => {
    await startProjectLocalMaintenanceDaemon("/project")

    expect(mockStartDaemon).toHaveBeenCalledWith("/project", {
      intervalMs: 15 * 60 * 1000,
    })
  })

  it("does not start the daemon when project policy disables it", async () => {
    mockLoadPolicy.mockResolvedValue({
      policy: {
        ...DEFAULT_MEMORY_OPS_POLICY,
        automation: {
          ...DEFAULT_MEMORY_OPS_POLICY.automation,
          maintenanceDaemonEnabled: false,
        },
      },
      warnings: [],
    })

    const started = await startProjectLocalMaintenanceDaemon("/project")

    expect(started).toBeNull()
    expect(mockStartDaemon).not.toHaveBeenCalled()
  })

  it("uses the policy maintenance check interval", async () => {
    mockLoadPolicy.mockResolvedValue({
      policy: {
        ...DEFAULT_MEMORY_OPS_POLICY,
        automation: {
          ...DEFAULT_MEMORY_OPS_POLICY.automation,
          maintenanceCheckIntervalMinutes: 5,
        },
      },
      warnings: [],
    })

    await startProjectLocalMaintenanceDaemon("/project")

    expect(mockStartDaemon).toHaveBeenCalledWith("/project", {
      intervalMs: 5 * 60 * 1000,
    })
  })

  it("stops the active daemon when lifecycle cleanup runs", async () => {
    const daemon = handle()
    mockStartDaemon.mockReturnValueOnce(daemon)

    const lifecycle = startProjectLocalMaintenanceLifecycle("/project")
    await lifecycle.ready
    lifecycle.stop()

    expect(daemon.stop).toHaveBeenCalledOnce()
  })

  it("stops a late-started daemon when cleanup happens before policy load resolves", async () => {
    let resolvePolicy: (value: Awaited<ReturnType<typeof loadMemoryOpsPolicy>>) => void = () => {}
    mockLoadPolicy.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePolicy = resolve
      }),
    )
    const daemon = handle()
    mockStartDaemon.mockReturnValueOnce(daemon)

    const lifecycle = startProjectLocalMaintenanceLifecycle("/project")
    lifecycle.stop()
    resolvePolicy({ policy: DEFAULT_MEMORY_OPS_POLICY, warnings: [] })
    await lifecycle.ready

    expect(daemon.stop).toHaveBeenCalledOnce()
  })
})

function handle(): LocalMaintenanceDaemonHandle {
  return {
    active: true,
    projectPath: "/project",
    stop: vi.fn(),
  }
}

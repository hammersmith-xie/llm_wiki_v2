import {
  getMemoryOpsMaintenanceStatus,
  scheduleAutoMemoryOpsPatrol,
  type MemoryOpsMaintenanceStatus,
} from "@/lib/memory-ops"
import { loadMemoryOpsPolicy } from "@/lib/memory-ops-policy"
import { normalizePath } from "@/lib/path-utils"
import { useActivityStore } from "@/stores/activity-store"
import { useLocalMaintenanceStore } from "@/stores/local-maintenance-store"

export const DEFAULT_LOCAL_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000
export const LOCAL_MAINTENANCE_DAEMON_ACTION = "local-maintenance-daemon"

export interface LocalMaintenanceDaemonHandle {
  active: boolean
  projectPath: string
  stop: () => void
}

export interface LocalMaintenanceDaemonOptions {
  intervalMs?: number
  onStatus?: (status: MemoryOpsMaintenanceStatus) => void
  onError?: (error: unknown) => void
}

const daemonHandles = new Map<string, LocalMaintenanceDaemonHandle>()

export function startLocalMaintenanceDaemon(
  projectPath: string,
  options: LocalMaintenanceDaemonOptions = {},
): LocalMaintenanceDaemonHandle {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const existing = daemonHandles.get(pp)
  if (existing) {
    return {
      active: false,
      projectPath: pp,
      stop: () => {},
    }
  }

  let stopped = false
  let inFlight = false
  const intervalMs = options.intervalMs ?? DEFAULT_LOCAL_MAINTENANCE_INTERVAL_MS

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      await runLocalMaintenanceCheck(pp, options)
    } finally {
      inFlight = false
    }
  }

  void tick()
  const timer = setInterval(tick, intervalMs)

  const handle: LocalMaintenanceDaemonHandle = {
    active: true,
    projectPath: pp,
    stop: () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      daemonHandles.delete(pp)
    },
  }
  daemonHandles.set(pp, handle)
  return handle
}

export async function runLocalMaintenanceCheck(
  projectPath: string,
  options: LocalMaintenanceDaemonOptions = {},
): Promise<MemoryOpsMaintenanceStatus | null> {
  try {
    const [{ policy }, status] = await Promise.all([
      loadMemoryOpsPolicy(projectPath),
      getMemoryOpsMaintenanceStatus(projectPath),
    ])
    options.onStatus?.(status)

    if (!status.reminderDue) return status

    useLocalMaintenanceStore.getState().setReminder({
      projectPath,
      dueReasons: status.dueReasons,
      eventCountSincePatrol: status.eventCountSincePatrol,
      dirtySince: status.dirtySince,
      lastPatrolAt: status.lastPatrolAt,
      createdAt: Date.now(),
    })

    useActivityStore.getState().addItem({
      type: "maintenance",
      title: "Memory Ops patrol recommended",
      status: "done",
      detail: `Local daemon found patrol due: ${status.dueReasons.join(", ")}.`,
      filesWritten: [],
    })

    if (policy.automation.autoPatrolEnabled) {
      scheduleAutoMemoryOpsPatrol(projectPath, LOCAL_MAINTENANCE_DAEMON_ACTION)
    }

    return status
  } catch (err) {
    options.onError?.(err)
    useActivityStore.getState().addItem({
      type: "maintenance",
      title: "Local maintenance check failed",
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
      filesWritten: [],
    })
    return null
  }
}

export function stopLocalMaintenanceDaemon(projectPath: string): void {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  daemonHandles.get(pp)?.stop()
}

export function activeLocalMaintenanceDaemonCount(): number {
  return daemonHandles.size
}

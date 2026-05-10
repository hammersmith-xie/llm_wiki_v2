import {
  startLocalMaintenanceDaemon,
  type LocalMaintenanceDaemonHandle,
} from "@/lib/local-maintenance-daemon"
import { loadMemoryOpsPolicy } from "@/lib/memory-ops-policy"

export interface ProjectLocalMaintenanceLifecycle {
  ready: Promise<LocalMaintenanceDaemonHandle | null>
  stop: () => void
}

export async function startProjectLocalMaintenanceDaemon(
  projectPath: string,
): Promise<LocalMaintenanceDaemonHandle | null> {
  const { policy } = await loadMemoryOpsPolicy(projectPath)
  if (!policy.automation.maintenanceDaemonEnabled) return null

  return startLocalMaintenanceDaemon(projectPath, {
    intervalMs: policy.automation.maintenanceCheckIntervalMinutes * 60 * 1000,
  })
}

export function startProjectLocalMaintenanceLifecycle(
  projectPath: string,
): ProjectLocalMaintenanceLifecycle {
  let stopped = false
  let handle: LocalMaintenanceDaemonHandle | null = null

  const ready = startProjectLocalMaintenanceDaemon(projectPath)
    .then((started) => {
      handle = started
      if (stopped) {
        handle?.stop()
      }
      return started
    })
    .catch((err) => {
      console.warn("[local-maintenance-daemon] failed to start:", err)
      return null
    })

  return {
    ready,
    stop: () => {
      stopped = true
      handle?.stop()
    },
  }
}

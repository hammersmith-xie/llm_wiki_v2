import { appendAuditEvent } from "@/lib/audit-timeline"
import type { MemoryOpsPatrolOptions } from "@/lib/memory-ops-types"
import { normalizePath } from "@/lib/path-utils"
import { useActivityStore } from "@/stores/activity-store"

export type MemoryOpsPatrolRunner = (
  projectPath: string,
  options: MemoryOpsPatrolOptions,
) => Promise<unknown>

const autoPatrolInFlight = new Set<string>()

export function scheduleAutoMemoryOpsPatrol(
  projectPath: string,
  reasonAction: string,
  runPatrol: MemoryOpsPatrolRunner,
): boolean {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  if (autoPatrolInFlight.has(pp)) return false
  autoPatrolInFlight.add(pp)
  void runAutoMemoryOpsPatrol(pp, reasonAction, runPatrol)
  return true
}

export function autoMemoryOpsPatrolInFlightCount(): number {
  return autoPatrolInFlight.size
}

async function runAutoMemoryOpsPatrol(
  projectPath: string,
  reasonAction: string,
  runPatrol: MemoryOpsPatrolRunner,
): Promise<void> {
  try {
    await runPatrol(projectPath, {
      trigger: {
        mode: "auto",
        action: reasonAction,
      },
    })
  } catch (err) {
    await appendAutoPatrolFailureAudit(projectPath, reasonAction, err)
    useActivityStore.getState().addItem({
      type: "maintenance",
      title: "Memory Ops auto patrol failed",
      status: "error",
      detail: `Triggered by ${reasonAction}: ${err instanceof Error ? err.message : String(err)}`,
      filesWritten: [],
    })
  } finally {
    autoPatrolInFlight.delete(projectPath)
  }
}

async function appendAutoPatrolFailureAudit(
  projectPath: string,
  reasonAction: string,
  err: unknown,
): Promise<void> {
  await appendAuditEvent(projectPath, {
    action: "memory_ops.patrol",
    targetPath: ".llm-wiki/audit.jsonl",
    changes: { status: "error" },
    after: {
      trigger: {
        mode: "auto",
        action: reasonAction,
      },
      error: err instanceof Error ? err.message : String(err),
    },
    reasons: [
      "auto patrol failed",
      `triggered by ${reasonAction}`,
    ],
  }).catch(() => {})
}

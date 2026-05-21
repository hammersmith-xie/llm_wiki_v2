import { appendAuditEvent } from "@/lib/audit-timeline"
import {
  scheduleAutoMemoryOpsPatrol as scheduleAutoMemoryOpsPatrolWithRunner,
} from "@/lib/memory-ops-autopatrol"
import {
  evaluateClaimSuggestions,
  evaluateLifecycleSuggestions,
  evaluateRelationCleanupSuggestions,
} from "@/lib/memory-ops-rules"
import {
  previewMemoryOpsHistoricalConflicts,
  type MemoryOpsHistoricalConflictResult,
} from "@/lib/memory-ops-conflicts"
import {
  completeMemoryOpsPatrolCooldown,
  reduceMemoryOpsMaintenanceEvent,
  summarizeMemoryOpsMaintenanceStatus,
} from "@/lib/memory-ops-maintenance"
import {
  loadMemoryOpsMaintenanceState,
  saveMemoryOpsMaintenanceState,
  type PersistedMemoryOpsMaintenanceState,
} from "@/lib/project-store"
import {
  DEFAULT_MEMORY_OPS_POLICY,
  loadMemoryOpsPolicy,
} from "@/lib/memory-ops-policy"
import { auditScanTelemetry, scanMemoryOpsProject } from "@/lib/memory-ops-scan"
import { useActivityStore } from "@/stores/activity-store"
import type {
  MemoryOpsMaintenanceEventOptions,
  MemoryOpsMaintenanceStatus,
  MemoryOpsPatrolOptions,
  MemoryOpsPatrolReport,
  MemoryOpsPatrolStats,
} from "@/lib/memory-ops-types"

export type {
  MemoryOpsClaimHealthSummary,
  MemoryOpsEvidenceRiskFlag,
  MemoryOpsMaintenanceDueReason,
  MemoryOpsMaintenanceEventOptions,
  MemoryOpsMaintenanceEventResult,
  MemoryOpsMaintenanceStatus,
  MemoryOpsMaintenanceStatusKind,
  MemoryOpsPageEvidenceSummary,
  MemoryOpsPatrolOptions,
  MemoryOpsPatrolReport,
  MemoryOpsPatrolStats,
  MemoryOpsProjectSnapshot,
  MemoryOpsRecentUseEvidence,
  MemoryOpsReinforcementEvidence,
  MemoryOpsRelationIssue,
  MemoryOpsResolvedScanOptions,
  MemoryOpsRiskEvidence,
  MemoryOpsScanOptions,
  MemoryOpsScanStage,
  MemoryOpsScanStageTiming,
  MemoryOpsScanTelemetry,
  MemoryOpsSnapshotStats,
  MemoryOpsSourceSupportEvidence,
  MemoryOpsStalenessEvidence,
  MemoryOpsSuggestion,
  MemoryOpsSuggestionKind,
  MemoryOpsSuggestionSeverity,
  MemoryOpsWikiPage,
} from "@/lib/memory-ops-types"
export {
  completeMemoryOpsPatrolCooldown,
  reduceMemoryOpsMaintenanceEvent,
  summarizeMemoryOpsMaintenanceStatus,
} from "@/lib/memory-ops-maintenance"
export { autoMemoryOpsPatrolInFlightCount } from "@/lib/memory-ops-autopatrol"
export { scanMemoryOpsProject } from "@/lib/memory-ops-scan"

export async function runMemoryOpsPatrol(
  projectPath: string,
  options: MemoryOpsPatrolOptions = {},
): Promise<MemoryOpsPatrolReport> {
  const activity = useActivityStore.getState()
  const activityId = activity.addItem({
    type: "maintenance",
    title: "Memory Ops patrol",
    status: "running",
    detail: "Scanning wiki and memory state...",
    filesWritten: [],
  })

  try {
    const snapshot = await scanMemoryOpsProject(projectPath, {
      dataVersion: options.dataVersion,
      today: options.today,
      policy: options.policy,
      includeChatMessages: options.includeChatMessages,
      includeSelfHealing: options.includeSelfHealing,
      maxChatConversations: options.maxChatConversations,
    })
    const historicalConflicts = options.includeHistoricalConflicts === false
      ? emptyHistoricalConflicts()
      : await previewMemoryOpsHistoricalConflicts(
          snapshot.projectPath,
          snapshot.pages,
        )
    const suggestions = [
      ...evaluateLifecycleSuggestions(snapshot, {
        today: options.today,
        policy: snapshot.policy,
      }),
      ...evaluateClaimSuggestions(snapshot, {
        today: options.today,
      }),
      ...evaluateRelationCleanupSuggestions(snapshot),
      ...historicalConflicts.suggestions,
    ]
    const stats: MemoryOpsPatrolStats = {
      ...snapshot.stats,
      historicalConflictCandidateCount: historicalConflicts.candidateCount,
      historicalConflictSuggestionCount: historicalConflicts.suggestions.length,
      historicalConflictWarningCount: historicalConflicts.warningCount,
      scanDurationMs: snapshot.scanTelemetry.totalMs,
      suggestionCount: suggestions.length,
    }
    const report: MemoryOpsPatrolReport = {
      snapshot,
      suggestions,
      warnings: snapshot.audit.warnings,
      stats,
    }

    await appendAuditEvent(snapshot.projectPath, {
      action: "memory_ops.patrol",
      targetPath: ".llm-wiki/audit.jsonl",
      changes: { status: "applied" },
      after: {
        stats: report.stats,
        scanTelemetry: auditScanTelemetry(report.snapshot.scanTelemetry),
        selfHealing: report.snapshot.selfHealingSummary,
        policy: {
          name: snapshot.policy.name,
          version: snapshot.policy.version,
          warnings: snapshot.policyWarnings,
        },
        trigger: patrolTriggerSummary(options.trigger),
      },
      reasons: [
        `${options.trigger?.mode ?? "manual"} patrol`,
        ...(options.trigger?.action ? [`triggered by ${options.trigger.action}`] : []),
        `${report.stats.pageCount} pages scanned`,
        `${report.stats.suggestionCount} suggestions generated`,
        `policy ${snapshot.policy.name} v${snapshot.policy.version}`,
      ],
    })
    await saveMaintenanceStateSafely(
      snapshot.projectPath,
      completeMemoryOpsPatrolCooldown(undefined, Date.now()),
    )

    useActivityStore.getState().updateItem(activityId, {
      status: "done",
      detail: `Patrol complete: ${report.stats.suggestionCount} suggestion${report.stats.suggestionCount === 1 ? "" : "s"}.`,
    })
    return report
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    useActivityStore.getState().updateItem(activityId, {
      status: "error",
      detail: `Patrol failed: ${message}`,
    })
    throw err
  }
}

export async function getMemoryOpsMaintenanceStatus(
  projectPath: string,
): Promise<MemoryOpsMaintenanceStatus> {
  const [state, policy] = await Promise.all([
    loadMemoryOpsMaintenanceState(projectPath).catch(() => null),
    loadMemoryOpsPolicy(projectPath)
      .then((result) => result.policy)
      .catch(() => DEFAULT_MEMORY_OPS_POLICY),
  ])
  return summarizeMemoryOpsMaintenanceStatus(state, { policy })
}

export async function recordMemoryOpsMaintenanceEvent(
  projectPath: string,
  action: string,
  options: MemoryOpsMaintenanceEventOptions = {},
): Promise<void> {
  const [state, policy] = await Promise.all([
    loadMemoryOpsMaintenanceState(projectPath).catch(() => null),
    options.policy
      ? Promise.resolve(options.policy)
      : loadMemoryOpsPolicy(projectPath)
          .then((result) => result.policy)
          .catch(() => DEFAULT_MEMORY_OPS_POLICY),
  ])
  const next = reduceMemoryOpsMaintenanceEvent(state, { ...options, policy })
  await saveMaintenanceStateSafely(projectPath, next.state)
  if (!next.reminderDue) return

  useActivityStore.getState().addItem({
    type: "maintenance",
    title: "Memory Ops patrol recommended",
    status: "done",
    detail: `${next.state.eventCountSincePatrol} wiki activity events since the last patrol. Due: ${next.dueReasons.join(", ")}. Latest event: ${action}.`,
    filesWritten: [],
  })

  if (options.autoPatrol !== false) {
    if (policy.automation.autoPatrolEnabled) {
      scheduleAutoMemoryOpsPatrol(projectPath, action)
    }
  }
}

export function scheduleAutoMemoryOpsPatrol(
  projectPath: string,
  reasonAction: string,
): boolean {
  return scheduleAutoMemoryOpsPatrolWithRunner(
    projectPath,
    reasonAction,
    runMemoryOpsPatrol,
  )
}

function patrolTriggerSummary(
  trigger: MemoryOpsPatrolOptions["trigger"] | undefined,
): Record<string, unknown> {
  return {
    mode: trigger?.mode ?? "manual",
    ...(trigger?.action ? { action: trigger.action } : {}),
  }
}

function emptyHistoricalConflicts(): MemoryOpsHistoricalConflictResult {
  return {
    candidateCount: 0,
    previews: [],
    warnings: [],
    warningCount: 0,
    suggestions: [],
  }
}

async function saveMaintenanceStateSafely(
  projectPath: string,
  state: PersistedMemoryOpsMaintenanceState,
): Promise<void> {
  await saveMemoryOpsMaintenanceState(projectPath, state).catch(() => {})
}

import { appendAuditEvent } from "@/lib/audit-timeline"
import {
  scheduleAutoMemoryOpsPatrol as scheduleAutoMemoryOpsPatrolWithRunner,
} from "@/lib/memory-ops-autopatrol"
import {
  previewMemoryOpsHistoricalConflicts,
} from "@/lib/memory-ops-conflicts"
import {
  buildMemoryOpsPatrolReportFromSnapshot,
  emptyMemoryOpsHistoricalConflicts,
  summarizeMemoryOpsPatrolResearch,
} from "@/lib/memory-ops-engine"
import { loadLatestMemoryOpsResearchReport } from "@/lib/memory-ops-research-store"
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
export {
  buildMemoryOpsPatrolReportFromSnapshot,
  emptyMemoryOpsHistoricalConflicts,
} from "@/lib/memory-ops-engine"

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
      ? emptyMemoryOpsHistoricalConflicts()
      : await previewMemoryOpsHistoricalConflicts(
          snapshot.projectPath,
          snapshot.pages,
        )
    const latestResearchReport = await loadLatestMemoryOpsResearchReport(snapshot.projectPath)
    const report = buildMemoryOpsPatrolReportFromSnapshot(snapshot, {
      today: options.today,
      trigger: options.trigger,
      historicalConflicts,
      latestResearchReport,
    })
    const researchSummary = summarizeMemoryOpsPatrolResearch(
      report,
      latestResearchReport,
    )
    const reportForAudit: MemoryOpsPatrolReport = {
      snapshot,
      suggestions: report.suggestions,
      warnings: snapshot.audit.warnings,
      stats: report.stats,
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
        researchEvidence: researchSummary,
        trigger: patrolTriggerSummary(options.trigger),
      },
      reasons: [
        `${options.trigger?.mode ?? "manual"} patrol`,
        ...(options.trigger?.action ? [`triggered by ${options.trigger.action}`] : []),
        `${reportForAudit.stats.pageCount} pages scanned`,
        `${reportForAudit.stats.suggestionCount} suggestions generated`,
        `${reportForAudit.stats.researchEvidenceCandidateCount} research candidates identified`,
        `policy ${snapshot.policy.name} v${snapshot.policy.version}`,
      ],
    })
    await saveMaintenanceStateSafely(
      snapshot.projectPath,
      completeMemoryOpsPatrolCooldown(undefined, Date.now()),
    )

    useActivityStore.getState().updateItem(activityId, {
      status: "done",
      detail: `Patrol complete: ${reportForAudit.stats.suggestionCount} suggestion${reportForAudit.stats.suggestionCount === 1 ? "" : "s"}.`,
    })
    return reportForAudit
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

async function saveMaintenanceStateSafely(
  projectPath: string,
  state: PersistedMemoryOpsMaintenanceState,
): Promise<void> {
  await saveMemoryOpsMaintenanceState(projectPath, state).catch(() => {})
}

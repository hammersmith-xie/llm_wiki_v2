import type { AuditEvent } from "@/lib/audit-timeline"
import type { MemoryOpsPatrolReport } from "@/lib/memory-ops"

export interface MemoryOpsPatrolSummary {
  pageCount: number
  suggestionCount: number
  warningCount: number
  auditEventCount: number
  emptySuggestions: boolean
}

export function summarizeMemoryOpsPatrolReport(
  report: MemoryOpsPatrolReport,
): MemoryOpsPatrolSummary {
  return {
    pageCount: report.stats.pageCount,
    suggestionCount: report.stats.suggestionCount,
    warningCount: report.warnings.length,
    auditEventCount: report.stats.auditEventCount,
    emptySuggestions: report.suggestions.length === 0,
  }
}

export function selectRecentAuditEvents(
  events: readonly AuditEvent[],
  limit = 3,
): AuditEvent[] {
  return [...events]
    .sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp))
    .slice(0, Math.max(0, limit))
}

export function auditEventTargetLabel(event: AuditEvent): string {
  return event.targetPath ?? event.pagePath ?? event.sourcePath ?? ".llm-wiki/audit.jsonl"
}

function timestampValue(timestamp: string | undefined): number {
  if (!timestamp) return 0
  const value = Date.parse(timestamp)
  return Number.isFinite(value) ? value : 0
}

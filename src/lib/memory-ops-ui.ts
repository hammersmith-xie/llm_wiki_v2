import type { AuditEvent } from "@/lib/audit-timeline"
import type { MetadataFieldDiff, MetadataPatchValue } from "@/lib/memory-ops-executor"
import type { MemoryOpsPatrolReport } from "@/lib/memory-ops"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"

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

export function visibleMemoryOpsSuggestions(
  suggestions: readonly MemoryOpsSuggestion[],
  state: {
    ignoredIds?: ReadonlySet<string>
    appliedIds?: ReadonlySet<string>
  },
): MemoryOpsSuggestion[] {
  return suggestions.filter(
    (suggestion) =>
      !state.ignoredIds?.has(suggestion.id) && !state.appliedIds?.has(suggestion.id),
  )
}

export function metadataPatchDiffLabel(diff: MetadataFieldDiff): string {
  return `${diff.field}: ${formatDiffValue(diff.before)} -> ${formatDiffValue(diff.after)}`
}

function timestampValue(timestamp: string | undefined): number {
  if (!timestamp) return 0
  const value = Date.parse(timestamp)
  return Number.isFinite(value) ? value : 0
}

function formatDiffValue(value: MetadataFieldDiff["before"] | MetadataPatchValue): string {
  if (value === undefined || value === "") return "(empty)"
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "(empty)"
  return String(value)
}

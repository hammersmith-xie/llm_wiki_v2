import type { AuditEvent } from "@/lib/audit-timeline"
import type { MetadataFieldDiff, MetadataPatchValue } from "@/lib/memory-ops-executor"
import type { MemoryOpsPatrolReport } from "@/lib/memory-ops"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import type { PersistedSchemaQualitySummaryState } from "@/lib/project-store"

export type MemoryOpsSuggestionCategory =
  | "lifecycle"
  | "relation"
  | "contradiction"
  | "retention"
  | "schema"
  | "quality"
  | "search-health"
  | "other"

export interface MemoryOpsSuggestionGroup {
  category: MemoryOpsSuggestionCategory
  suggestions: MemoryOpsSuggestion[]
}

export interface MemoryOpsPatrolSummary {
  pageCount: number
  suggestionCount: number
  warningCount: number
  auditEventCount: number
  stalePageCount: number
  riskPageCount: number
  categoryCounts: Partial<Record<MemoryOpsSuggestionCategory, number>>
  schemaQualitySummary: PersistedSchemaQualitySummaryState | null
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
    stalePageCount: report.stats.stalePageCount,
    riskPageCount: report.stats.riskPageCount,
    categoryCounts: countSuggestionCategories(report.suggestions),
    schemaQualitySummary: report.snapshot?.schemaQualitySummary ?? null,
    emptySuggestions: report.suggestions.length === 0,
  }
}

export function categorizeMemoryOpsSuggestion(
  suggestion: MemoryOpsSuggestion,
): MemoryOpsSuggestionCategory {
  const text = [
    suggestion.id,
    suggestion.title,
    suggestion.detail,
    suggestion.relation?.field,
    suggestion.proposedOperation?.kind,
    ...suggestion.reasons,
  ].join(" ").toLowerCase()

  if (text.includes("quality")) return "quality"
  if (text.includes("schema") || text.includes("frontmatter")) return "schema"
  if (text.includes("search") || text.includes("retrieval")) return "search-health"
  if (text.includes("contradict")) return "contradiction"
  if (text.includes("archive") || text.includes("retention") || text.includes("deprioritize")) {
    return "retention"
  }
  if (suggestion.kind === "relation-cleanup" || suggestion.relation) return "relation"
  if (suggestion.kind === "metadata-update" || suggestion.kind === "review-action") return "lifecycle"
  return "other"
}

export function groupMemoryOpsSuggestionsByCategory(
  suggestions: readonly MemoryOpsSuggestion[],
): MemoryOpsSuggestionGroup[] {
  const groups = new Map<MemoryOpsSuggestionCategory, MemoryOpsSuggestion[]>()
  for (const suggestion of suggestions) {
    const category = categorizeMemoryOpsSuggestion(suggestion)
    const list = groups.get(category) ?? []
    list.push(suggestion)
    groups.set(category, list)
  }

  return CATEGORY_ORDER
    .map((category) => ({ category, suggestions: groups.get(category) ?? [] }))
    .filter((group) => group.suggestions.length > 0)
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

const CATEGORY_ORDER: MemoryOpsSuggestionCategory[] = [
  "lifecycle",
  "relation",
  "contradiction",
  "retention",
  "schema",
  "quality",
  "search-health",
  "other",
]

function countSuggestionCategories(
  suggestions: readonly MemoryOpsSuggestion[],
): Partial<Record<MemoryOpsSuggestionCategory, number>> {
  const counts: Partial<Record<MemoryOpsSuggestionCategory, number>> = {}
  for (const suggestion of suggestions) {
    const category = categorizeMemoryOpsSuggestion(suggestion)
    counts[category] = (counts[category] ?? 0) + 1
  }
  return counts
}

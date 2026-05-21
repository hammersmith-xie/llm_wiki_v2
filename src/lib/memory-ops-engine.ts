import {
  evaluateClaimSuggestions,
  evaluateLifecycleSuggestions,
  evaluateRelationCleanupSuggestions,
} from "@/lib/memory-ops-rules"
import {
  enrichMemoryOpsSuggestionsWithResearch,
  selectMemoryOpsResearchCandidates,
  summarizeMemoryOpsResearchIntegration,
} from "@/lib/memory-ops-research-integration"
import type {
  MemoryOpsHistoricalConflictResult,
} from "@/lib/memory-ops-conflicts"
import type {
  MemoryOpsResearchEvidenceReport,
} from "@/lib/memory-ops-research-types"
import type {
  MemoryOpsPatrolOptions,
  MemoryOpsPatrolReport,
  MemoryOpsPatrolStats,
  MemoryOpsProjectSnapshot,
} from "@/lib/memory-ops-types"

export interface BuildMemoryOpsPatrolReportOptions {
  today?: string
  trigger?: MemoryOpsPatrolOptions["trigger"]
  historicalConflicts?: MemoryOpsHistoricalConflictResult
  latestResearchReport?: MemoryOpsResearchEvidenceReport | null
}

export function buildMemoryOpsPatrolReportFromSnapshot(
  snapshot: MemoryOpsProjectSnapshot,
  options: BuildMemoryOpsPatrolReportOptions = {},
): MemoryOpsPatrolReport {
  const historicalConflicts = options.historicalConflicts ?? emptyHistoricalConflicts()
  const baseSuggestions = [
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
  const suggestions = enrichMemoryOpsSuggestionsWithResearch(
    baseSuggestions,
    options.latestResearchReport,
    snapshot,
  )
  const researchCandidates = selectMemoryOpsResearchCandidates(snapshot, suggestions, {
    maxCandidates: snapshot.policy.research.maxCandidates,
  })
  const researchSummary = summarizeMemoryOpsResearchIntegration(
    options.latestResearchReport,
    suggestions,
  )
  const stats: MemoryOpsPatrolStats = {
    ...snapshot.stats,
    historicalConflictCandidateCount: historicalConflicts.candidateCount,
    historicalConflictSuggestionCount: historicalConflicts.suggestions.length,
    historicalConflictWarningCount: historicalConflicts.warningCount,
    researchEvidenceCandidateCount: researchCandidates.length,
    researchEvidenceMatchedSuggestionCount: researchSummary.matchedSuggestionCount,
    researchEvidenceItemCount: researchSummary.evidenceCount,
    researchEvidenceWarningCount: researchSummary.warningCount,
    scanDurationMs: snapshot.scanTelemetry.totalMs,
    suggestionCount: suggestions.length,
  }

  return {
    snapshot,
    suggestions,
    warnings: snapshot.audit.warnings,
    stats,
  }
}

export function summarizeMemoryOpsPatrolResearch(
  report: MemoryOpsPatrolReport,
  latestResearchReport: MemoryOpsResearchEvidenceReport | null | undefined,
) {
  return summarizeMemoryOpsResearchIntegration(latestResearchReport, report.suggestions)
}

export function emptyMemoryOpsHistoricalConflicts(): MemoryOpsHistoricalConflictResult {
  return emptyHistoricalConflicts()
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

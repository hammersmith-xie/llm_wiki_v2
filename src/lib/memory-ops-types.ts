import type { AuditTimelineResult } from "@/lib/audit-timeline"
import type { ClaimRecord } from "@/lib/claims"
import type { FrontmatterValue } from "@/lib/frontmatter"
import type { MetadataPatchOperation } from "@/lib/memory-ops-executor"
import type { MemoryOpsPolicy } from "@/lib/memory-ops-policy"
import type {
  PersistedMemoryOpsMaintenanceState,
  PersistedSchemaQualitySummaryState,
} from "@/lib/project-store"
import type { SelfHealingSummary } from "@/lib/self-healing-summary"
import type { TypedGraph } from "@/lib/typed-graph"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { ReviewItem } from "@/stores/review-store"

export type MemoryOpsEvidenceRiskFlag =
  | "stale"
  | "contradicted"
  | "superseded"
  | "open-review"

export interface MemoryOpsRecentUseEvidence {
  eventCount: number
  lastUsedAt?: string
}

export interface MemoryOpsReinforcementEvidence {
  frontmatterCount: number
  auditEventCount: number
  totalCount: number
  lastReinforcedAt?: string
}

export interface MemoryOpsSourceSupportEvidence {
  sourceCount: number
  supportingRelationCount: number
}

export interface MemoryOpsStalenessEvidence {
  lastConfirmed?: string
  ageDays?: number
  stale: boolean
}

export interface MemoryOpsRiskEvidence {
  contradictionCount: number
  supersededByCount: number
  openReviewItemCount: number
  flags: MemoryOpsEvidenceRiskFlag[]
}

export interface MemoryOpsPageEvidenceSummary {
  pagePath: string
  recentUse: MemoryOpsRecentUseEvidence
  reinforcement: MemoryOpsReinforcementEvidence
  sourceSupport: MemoryOpsSourceSupportEvidence
  staleness: MemoryOpsStalenessEvidence
  risk: MemoryOpsRiskEvidence
}

export interface MemoryOpsWikiPage {
  id: string
  fileName: string
  path: string
  content: string
  frontmatter: Record<string, FrontmatterValue> | null
  evidence?: MemoryOpsPageEvidenceSummary
}

export interface MemoryOpsSnapshotStats {
  pageCount: number
  reviewItemCount: number
  conversationCount: number
  chatMessageCount: number
  auditEventCount: number
  auditWarningCount: number
  pageEvidenceCount: number
  pagesWithRecentUseCount: number
  pagesWithReinforcementCount: number
  pagesWithSourceSupportCount: number
  stalePageCount: number
  riskPageCount: number
  claimCount: number
  staleClaimCount: number
  contradictedClaimCount: number
  supersededClaimCount: number
  orphanClaimCount: number
  reinforcedClaimCount: number
  claimsMissingSourceRefCount: number
  claimsMissingSnippetHashCount: number
  historicalConflictCandidateCount: number
  historicalConflictSuggestionCount: number
  historicalConflictWarningCount: number
  selfHealingCandidateCount: number
  selfHealingWarningCount: number
}

export type MemoryOpsScanStage =
  | "policy-schema"
  | "wiki-pages"
  | "graph"
  | "audit"
  | "review-items"
  | "conversations"
  | "chat-messages"
  | "claims"
  | "evidence"
  | "self-healing"

export interface MemoryOpsScanStageTiming {
  stage: MemoryOpsScanStage
  ms: number
  itemCount?: number
  skipped?: boolean
}

export interface MemoryOpsResolvedScanOptions {
  includeChatMessages: boolean
  includeSelfHealing: boolean
  maxChatConversations?: number
}

export interface MemoryOpsScanTelemetry {
  totalMs: number
  stages: MemoryOpsScanStageTiming[]
  options: MemoryOpsResolvedScanOptions
}

export interface MemoryOpsClaimHealthSummary {
  claimCount: number
  staleCount: number
  contradictedCount: number
  supersededCount: number
  orphanCount: number
  reinforcedCount: number
  missingSourceRefCount: number
  missingSnippetHashCount: number
}

export interface MemoryOpsProjectSnapshot {
  projectPath: string
  dataVersion: number
  policy: MemoryOpsPolicy
  policyWarnings: string[]
  scanTelemetry: MemoryOpsScanTelemetry
  pages: MemoryOpsWikiPage[]
  graph: TypedGraph
  audit: AuditTimelineResult
  schemaQualitySummary: PersistedSchemaQualitySummaryState | null
  reviewItems: ReviewItem[]
  conversations: Conversation[]
  chatMessages: DisplayMessage[]
  claims: ClaimRecord[]
  claimHealth: MemoryOpsClaimHealthSummary
  selfHealingSummary: SelfHealingSummary
  stats: MemoryOpsSnapshotStats
}

export type MemoryOpsSuggestionKind = "metadata-update" | "relation-cleanup" | "review-action"
export type MemoryOpsSuggestionSeverity = "info" | "warning"

export interface MemoryOpsRelationIssue {
  field: string
  target: string
  candidateTarget?: string
}

export interface MemoryOpsSuggestion {
  id: string
  kind: MemoryOpsSuggestionKind
  severity: MemoryOpsSuggestionSeverity
  targetPath: string
  title: string
  detail: string
  reasons: string[]
  proposedOperation?: MetadataPatchOperation
  relation?: MemoryOpsRelationIssue
}

export interface MemoryOpsPatrolStats extends MemoryOpsSnapshotStats {
  scanDurationMs: number
  suggestionCount: number
}

export interface MemoryOpsPatrolReport {
  snapshot: MemoryOpsProjectSnapshot
  suggestions: MemoryOpsSuggestion[]
  warnings: AuditTimelineResult["warnings"]
  stats: MemoryOpsPatrolStats
}

export interface MemoryOpsScanOptions {
  dataVersion?: number
  today?: string
  policy?: MemoryOpsPolicy
  includeChatMessages?: boolean
  includeSelfHealing?: boolean
  maxChatConversations?: number
}

export interface MemoryOpsPatrolOptions extends MemoryOpsScanOptions {
  includeHistoricalConflicts?: boolean
  trigger?: {
    mode: "manual" | "auto"
    action?: string
  }
}

export interface MemoryOpsMaintenanceEventOptions {
  now?: number
  eventThreshold?: number
  reminderCooldownMs?: number
  minPatrolIntervalMs?: number
  timeIntervalMs?: number
  policy?: MemoryOpsPolicy
  autoPatrol?: boolean
}

export interface MemoryOpsMaintenanceEventResult {
  state: PersistedMemoryOpsMaintenanceState
  reminderDue: boolean
  dueReasons: MemoryOpsMaintenanceDueReason[]
}

export type MemoryOpsMaintenanceStatusKind = "clean" | "dirty" | "reminder-due"
export type MemoryOpsMaintenanceDueReason = "event-threshold" | "time-interval"

export interface MemoryOpsMaintenanceStatus extends PersistedMemoryOpsMaintenanceState {
  status: MemoryOpsMaintenanceStatusKind
  needsPatrol: boolean
  reminderDue: boolean
  dueReasons: MemoryOpsMaintenanceDueReason[]
}

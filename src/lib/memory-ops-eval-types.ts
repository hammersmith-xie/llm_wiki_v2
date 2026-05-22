import type { MemoryOpsPatrolReport } from "@/lib/memory-ops-types"
import type { MemoryOpsPolicy } from "@/lib/memory-ops-policy"
import type { MemoryOpsProjectSnapshot } from "@/lib/memory-ops-types"

export interface MemoryOpsEvalExpectedSuggestion {
  id: string
  kind?: string
  targetPath?: string
}

export interface MemoryOpsEvalCase {
  id: string
  title: string
  description: string
  snapshot?: MemoryOpsProjectSnapshot
  expectedSuggestions: MemoryOpsEvalExpectedSuggestion[]
}

export interface MemoryOpsEvalCaseResult {
  id: string
  title: string
  passed: boolean
  expectedCount: number
  actualCount: number
  matchedCount: number
  falsePositiveCount: number
  falseNegativeCount: number
  safePatchCount: number
  actualSuggestionIds: string[]
  missingSuggestionIds: string[]
  unexpectedSuggestionIds: string[]
  durationMs: number
}

export interface MemoryOpsEvalMetrics {
  caseCount: number
  passedCaseCount: number
  failedCaseCount: number
  expectedSuggestionCount: number
  actualSuggestionCount: number
  matchedSuggestionCount: number
  falsePositiveCount: number
  falseNegativeCount: number
  safePatchCount: number
  expectedCategoryCoverage: Record<string, number>
  actualCategoryCoverage: Record<string, number>
  precision: number
  recall: number
  f1: number
  patrolScore: number
  totalDurationMs: number
}

export interface MemoryOpsEvalPolicyVariant {
  id: string
  title: string
  policy: MemoryOpsPolicy
}

export interface MemoryOpsEvalVariantResult {
  id: string
  title: string
  metrics: MemoryOpsEvalMetrics
  scoreDelta: number
  precisionDelta: number
  recallDelta: number
  f1Delta: number
  decision: MemoryOpsEvalGateDecision
}

export type MemoryOpsEvalGateStatus = "pass" | "fail"
export type MemoryOpsEvalExperimentDecision = "keep" | "discard"

export interface MemoryOpsEvalGateDecision {
  status: MemoryOpsEvalGateStatus
  decision: MemoryOpsEvalExperimentDecision
  baselineScore?: number
  candidateScore?: number
  reasons: string[]
}

export interface MemoryOpsEvalReport {
  schemaVersion: 1
  id: string
  createdAt: string
  projectPath: string
  metrics: MemoryOpsEvalMetrics
  gate: MemoryOpsEvalGateDecision
  cases: MemoryOpsEvalCaseResult[]
  variants?: MemoryOpsEvalVariantResult[]
}

export type MemoryOpsEvalPatrolRunner = (
  evalCase: MemoryOpsEvalCase,
) => Promise<MemoryOpsPatrolReport>

import type { MemoryOpsPatrolReport } from "@/lib/memory-ops-types"

export interface MemoryOpsEvalExpectedSuggestion {
  id: string
  kind?: string
  targetPath?: string
}

export interface MemoryOpsEvalCase {
  id: string
  title: string
  description: string
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
  totalDurationMs: number
}

export interface MemoryOpsEvalReport {
  schemaVersion: 1
  id: string
  createdAt: string
  projectPath: string
  metrics: MemoryOpsEvalMetrics
  cases: MemoryOpsEvalCaseResult[]
}

export type MemoryOpsEvalPatrolRunner = (
  evalCase: MemoryOpsEvalCase,
) => Promise<MemoryOpsPatrolReport>

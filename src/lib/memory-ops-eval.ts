import type { MemoryOpsPatrolReport } from "@/lib/memory-ops-types"
import {
  BUILT_IN_MEMORY_OPS_EVAL_CASES,
} from "@/lib/memory-ops-eval-fixtures"
import type {
  MemoryOpsEvalCase,
  MemoryOpsEvalCaseResult,
  MemoryOpsEvalMetrics,
  MemoryOpsEvalPatrolRunner,
  MemoryOpsEvalReport,
} from "@/lib/memory-ops-eval-types"

export interface RunMemoryOpsEvalOptions {
  cases?: readonly MemoryOpsEvalCase[]
  runner?: MemoryOpsEvalPatrolRunner
  now?: Date
}

export async function runMemoryOpsEval(
  projectPath: string,
  options: RunMemoryOpsEvalOptions = {},
): Promise<MemoryOpsEvalReport> {
  const cases = [...(options.cases ?? BUILT_IN_MEMORY_OPS_EVAL_CASES)]
  const runner = options.runner ?? unsupportedRunner
  const results: MemoryOpsEvalCaseResult[] = []

  for (const evalCase of cases) {
    const startedAt = performance.now()
    const report = await runner(evalCase)
    results.push(evaluateCase(evalCase, report, elapsedMs(startedAt)))
  }

  const createdAt = (options.now ?? new Date()).toISOString()
  return {
    schemaVersion: 1,
    id: evalReportId(createdAt),
    createdAt,
    projectPath,
    metrics: summarizeEvalMetrics(results),
    cases: results,
  }
}

export function evaluateMemoryOpsEvalCase(
  evalCase: MemoryOpsEvalCase,
  report: MemoryOpsPatrolReport,
): MemoryOpsEvalCaseResult {
  return evaluateCase(evalCase, report, 0)
}

function evaluateCase(
  evalCase: MemoryOpsEvalCase,
  report: MemoryOpsPatrolReport,
  durationMs: number,
): MemoryOpsEvalCaseResult {
  const expected = new Set(evalCase.expectedSuggestions.map((item) => item.id))
  const actualSuggestions = report.suggestions.map((suggestion) => ({
    id: suggestion.id,
    targetPath: suggestion.targetPath,
    kind: suggestion.kind,
    safePatch: Boolean(suggestion.proposedOperation),
  }))
  const actual = new Set(actualSuggestions.map((suggestion) => suggestion.id))
  const missing = [...expected].filter((id) => !actual.has(id))
  const unexpected = [...actual].filter((id) => !expected.has(id))
  const matchedCount = [...expected].filter((id) => actual.has(id)).length

  return {
    id: evalCase.id,
    title: evalCase.title,
    passed: missing.length === 0 && unexpected.length === 0,
    expectedCount: expected.size,
    actualCount: actual.size,
    matchedCount,
    falsePositiveCount: unexpected.length,
    falseNegativeCount: missing.length,
    safePatchCount: actualSuggestions.filter((suggestion) => suggestion.safePatch).length,
    actualSuggestionIds: actualSuggestions.map((suggestion) => suggestion.id),
    missingSuggestionIds: missing,
    unexpectedSuggestionIds: unexpected,
    durationMs,
  }
}

export function summarizeEvalMetrics(
  results: readonly MemoryOpsEvalCaseResult[],
): MemoryOpsEvalMetrics {
  const expectedSuggestionCount = sum(results, (item) => item.expectedCount)
  const actualSuggestionCount = sum(results, (item) => item.actualCount)
  const matchedSuggestionCount = sum(results, (item) => item.matchedCount)
  const falsePositiveCount = sum(results, (item) => item.falsePositiveCount)
  const falseNegativeCount = sum(results, (item) => item.falseNegativeCount)
  const expectedCategoryCoverage = mergeCategoryCounts(
    results.map((item) => categoryCounts(item.missingSuggestionIds.concat(
      item.actualSuggestionIds.filter((id) => !item.unexpectedSuggestionIds.includes(id)),
    ))),
  )
  const actualCategoryCoverage = mergeCategoryCounts(
    results.map((item) => categoryCounts(item.actualSuggestionIds)),
  )
  const precision = ratio(matchedSuggestionCount, actualSuggestionCount)
  const recall = ratio(matchedSuggestionCount, expectedSuggestionCount)
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  return {
    caseCount: results.length,
    passedCaseCount: results.filter((item) => item.passed).length,
    failedCaseCount: results.filter((item) => !item.passed).length,
    expectedSuggestionCount,
    actualSuggestionCount,
    matchedSuggestionCount,
    falsePositiveCount,
    falseNegativeCount,
    safePatchCount: sum(results, (item) => item.safePatchCount),
    expectedCategoryCoverage,
    actualCategoryCoverage,
    precision,
    recall,
    f1,
    totalDurationMs: sum(results, (item) => item.durationMs),
  }
}

function sum<T>(items: readonly T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0)
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 1
}

function mergeCategoryCounts(counts: readonly Record<string, number>[]): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const group of counts) {
    for (const [category, count] of Object.entries(group)) {
      merged[category] = (merged[category] ?? 0) + count
    }
  }
  return merged
}

function categoryCounts(ids: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const id of ids) {
    const category = id.split(":")[0] || "other"
    counts[category] = (counts[category] ?? 0) + 1
  }
  return counts
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100)
}

function evalReportId(createdAt: string): string {
  return `eval_${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`
}

async function unsupportedRunner(): Promise<MemoryOpsPatrolReport> {
  throw new Error(
    "Memory Ops eval requires a patrol runner. The UI runner supplies the current project patrol; tests can inject fixtures.",
  )
}

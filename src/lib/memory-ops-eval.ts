import type { MemoryOpsPatrolReport } from "@/lib/memory-ops-types"
import { buildMemoryOpsPatrolReportFromSnapshot } from "@/lib/memory-ops-engine"
import { attachPageEvidence, summarizeEvidenceStats } from "@/lib/memory-ops-evidence"
import {
  BUILT_IN_MEMORY_OPS_EVAL_CASES,
} from "@/lib/memory-ops-eval-fixtures"
import type { MemoryOpsPolicy } from "@/lib/memory-ops-policy"
import type {
  MemoryOpsEvalCase,
  MemoryOpsEvalCaseResult,
  MemoryOpsEvalMetrics,
  MemoryOpsEvalPatrolRunner,
  MemoryOpsEvalGateDecision,
  MemoryOpsEvalPolicyVariant,
  MemoryOpsEvalReport,
  MemoryOpsEvalVariantResult,
} from "@/lib/memory-ops-eval-types"

export interface RunMemoryOpsEvalOptions {
  cases?: readonly MemoryOpsEvalCase[]
  runner?: MemoryOpsEvalPatrolRunner
  variants?: readonly MemoryOpsEvalPolicyVariant[]
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
    const report = await runEvalCase(evalCase, runner)
    results.push(evaluateCase(evalCase, report, elapsedMs(startedAt)))
  }

  const createdAt = (options.now ?? new Date()).toISOString()
  const metrics = summarizeEvalMetrics(results)
  const gate = evaluateEvalGate(metrics, cases)
  return {
    schemaVersion: 1,
    id: evalReportId(createdAt),
    createdAt,
    projectPath,
    metrics,
    gate,
    cases: results,
    variants: options.variants && options.variants.length > 0
      ? await runVariantComparisons(cases, options.variants, metrics)
      : undefined,
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

async function runEvalCase(
  evalCase: MemoryOpsEvalCase,
  runner: MemoryOpsEvalPatrolRunner,
): Promise<MemoryOpsPatrolReport> {
  if (evalCase.snapshot) {
    return buildMemoryOpsPatrolReportFromSnapshot(evalCase.snapshot, {
      today: "2026-05-22",
    })
  }
  return runner(evalCase)
}

async function runVariantComparisons(
  cases: readonly MemoryOpsEvalCase[],
  variants: readonly MemoryOpsEvalPolicyVariant[],
  baseline: MemoryOpsEvalMetrics,
): Promise<MemoryOpsEvalVariantResult[]> {
  const results: MemoryOpsEvalVariantResult[] = []
  for (const variant of variants) {
    const caseResults: MemoryOpsEvalCaseResult[] = []
    for (const evalCase of cases) {
      if (!evalCase.snapshot) continue
      const startedAt = performance.now()
      const snapshot = snapshotWithPolicy(evalCase.snapshot, variant.policy)
      const report = buildMemoryOpsPatrolReportFromSnapshot(snapshot, {
        today: "2026-05-22",
      })
      caseResults.push(evaluateCase(evalCase, report, elapsedMs(startedAt)))
    }
    const metrics = summarizeEvalMetrics(caseResults)
    results.push({
      id: variant.id,
      title: variant.title,
      metrics,
      precisionDelta: roundMetric(metrics.precision - baseline.precision),
      recallDelta: roundMetric(metrics.recall - baseline.recall),
      f1Delta: roundMetric(metrics.f1 - baseline.f1),
      decision: evaluateEvalGate(metrics, cases),
    })
  }
  return results
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

function snapshotWithPolicy(
  snapshot: NonNullable<MemoryOpsEvalCase["snapshot"]>,
  policy: MemoryOpsPolicy,
): NonNullable<MemoryOpsEvalCase["snapshot"]> {
  const pages = attachPageEvidence(snapshot.pages, {
    projectPath: snapshot.projectPath,
    graph: snapshot.graph,
    auditEvents: snapshot.audit.events,
    reviewItems: snapshot.reviewItems,
    today: "2026-05-22",
    policy,
  })
  const evidenceStats = summarizeEvidenceStats(pages)
  return {
    ...snapshot,
    policy,
    pages,
    stats: {
      ...snapshot.stats,
      ...evidenceStats,
    },
  }
}

function evaluateEvalGate(
  metrics: MemoryOpsEvalMetrics,
  cases: readonly MemoryOpsEvalCase[],
): MemoryOpsEvalGateDecision {
  const policy = cases.find((evalCase) => evalCase.snapshot)?.snapshot?.policy
  const minPrecision = policy?.eval.minPrecision ?? 0.9
  const minRecall = policy?.eval.minRecall ?? 0.9
  const minF1 = policy?.eval.minF1 ?? 0.9
  const reasons: string[] = []
  if (metrics.precision < minPrecision) {
    reasons.push(`precision ${formatMetric(metrics.precision)} below ${formatMetric(minPrecision)}`)
  }
  if (metrics.recall < minRecall) {
    reasons.push(`recall ${formatMetric(metrics.recall)} below ${formatMetric(minRecall)}`)
  }
  if (metrics.f1 < minF1) {
    reasons.push(`F1 ${formatMetric(metrics.f1)} below ${formatMetric(minF1)}`)
  }
  if (metrics.failedCaseCount > 0) {
    reasons.push(`${metrics.failedCaseCount} failing eval case${metrics.failedCaseCount === 1 ? "" : "s"}`)
  }
  if (reasons.length === 0) {
    return {
      status: "pass",
      decision: "keep",
      reasons: ["eval metrics meet policy thresholds"],
    }
  }
  return {
    status: "fail",
    decision: "discard",
    reasons,
  }
}

function formatMetric(value: number): string {
  return value.toFixed(2)
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}

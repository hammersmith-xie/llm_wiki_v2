import type {
  MemoryOpsEvalCaseComparison,
  MemoryOpsEvalCaseResult,
  MemoryOpsEvalCaseScoreBreakdown,
} from "@/lib/memory-ops-eval-types"

export function buildMemoryOpsEvalCaseScoreBreakdown(input: {
  expectedCount: number
  actualCount: number
  matchedCount: number
  safePatchCount: number
}): MemoryOpsEvalCaseScoreBreakdown {
  const precision = ratio(input.matchedCount, input.actualCount)
  const recall = ratio(input.matchedCount, input.expectedCount)
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const exact = input.expectedCount === input.matchedCount && input.actualCount === input.matchedCount ? 1 : 0
  const safety = input.actualCount > 0 ? ratio(input.safePatchCount, input.actualCount) : 1
  const total = roundMetric(f1 * 0.6 + exact * 0.25 + safety * 0.1 + precision * 0.05)
  return {
    match: roundMetric(f1 * 0.6 + exact * 0.25),
    precision: roundMetric(precision * 0.05),
    safety: roundMetric(safety * 0.1),
    total,
  }
}

export function aggregateMemoryOpsEvalScoreBreakdown(
  results: readonly MemoryOpsEvalCaseResult[],
): MemoryOpsEvalCaseScoreBreakdown {
  if (results.length === 0) {
    return { match: 0.85, precision: 0.05, safety: 0.1, total: 1 }
  }
  const totals = results.reduce((acc, result) => ({
    match: acc.match + result.scoreBreakdown.match,
    precision: acc.precision + result.scoreBreakdown.precision,
    safety: acc.safety + result.scoreBreakdown.safety,
    total: acc.total + result.scoreBreakdown.total,
  }), { match: 0, precision: 0, safety: 0, total: 0 })
  return {
    match: roundMetric(totals.match / results.length),
    precision: roundMetric(totals.precision / results.length),
    safety: roundMetric(totals.safety / results.length),
    total: roundMetric(totals.total / results.length),
  }
}

export function memoryOpsEvalFailureReasons(
  missing: readonly string[],
  unexpected: readonly string[],
): string[] {
  return [
    missing.length > 0 ? `${missing.length} missing expected suggestion${missing.length === 1 ? "" : "s"}` : "",
    unexpected.length > 0 ? `${unexpected.length} unexpected suggestion${unexpected.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean)
}

export function compareMemoryOpsEvalVariantCases(
  baselineResults: readonly MemoryOpsEvalCaseResult[],
  candidateResults: readonly MemoryOpsEvalCaseResult[],
): MemoryOpsEvalCaseComparison[] {
  const candidateById = new Map(candidateResults.map((item) => [item.id, item]))
  return baselineResults.map((baseline) => {
    const candidate = candidateById.get(baseline.id)
    const baselineScore = baseline.scoreBreakdown.total
    const candidateScore = candidate?.scoreBreakdown.total ?? 0
    const scoreDelta = roundMetric(candidateScore - baselineScore)
    const candidatePassed = candidate?.passed ?? false
    const regressed = !candidate || (baseline.passed && !candidatePassed) || scoreDelta < 0
    const improved = candidate ? (!baseline.passed && candidate.passed) || scoreDelta > 0 : false
    return {
      id: baseline.id,
      title: baseline.title,
      baselinePassed: baseline.passed,
      candidatePassed,
      baselineScore,
      candidateScore,
      scoreDelta,
      regressed,
      improved,
      reasons: variantCaseReasons(baseline, candidate, scoreDelta),
    }
  })
}

function variantCaseReasons(
  baseline: MemoryOpsEvalCaseResult,
  candidate: MemoryOpsEvalCaseResult | undefined,
  scoreDelta: number,
): string[] {
  if (!candidate) return ["candidate case did not run"]
  return [
    baseline.passed && !candidate.passed ? "passed in baseline but failed in candidate" : "",
    scoreDelta < 0 ? `case score delta ${formatMetric(scoreDelta)}` : "",
    ...candidate.failureReasons,
  ].filter(Boolean)
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 1
}

function formatMetric(value: number): string {
  return value.toFixed(2)
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}

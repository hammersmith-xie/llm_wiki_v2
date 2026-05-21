import { describe, expect, it } from "vitest"
import {
  evaluateMemoryOpsEvalCase,
  runMemoryOpsEval,
  summarizeEvalMetrics,
} from "./memory-ops-eval"
import type { MemoryOpsPatrolReport } from "./memory-ops-types"

function report(ids: string[]): MemoryOpsPatrolReport {
  return {
    snapshot: {} as MemoryOpsPatrolReport["snapshot"],
    warnings: [],
    stats: {} as MemoryOpsPatrolReport["stats"],
    suggestions: ids.map((id) => ({
      id,
      kind: "review-action",
      severity: "warning",
      targetPath: "wiki/a.md",
      title: id,
      detail: id,
      reasons: [],
    })),
  }
}

describe("memory ops eval", () => {
  it("scores a case with missing and unexpected suggestions", () => {
    const result = evaluateMemoryOpsEvalCase({
      id: "case",
      title: "Case",
      description: "",
      expectedSuggestions: [{ id: "expected" }],
    }, report(["unexpected"]))

    expect(result.passed).toBe(false)
    expect(result.falsePositiveCount).toBe(1)
    expect(result.falseNegativeCount).toBe(1)
  })

  it("summarizes precision recall and f1", () => {
    const metrics = summarizeEvalMetrics([
      {
        id: "a",
        title: "A",
        passed: true,
        expectedCount: 2,
        actualCount: 2,
        matchedCount: 2,
        falsePositiveCount: 0,
        falseNegativeCount: 0,
        safePatchCount: 1,
        actualSuggestionIds: [],
        missingSuggestionIds: [],
        unexpectedSuggestionIds: [],
        durationMs: 10,
      },
    ])

    expect(metrics.precision).toBe(1)
    expect(metrics.recall).toBe(1)
    expect(metrics.f1).toBe(1)
  })

  it("runs with an injected patrol runner", async () => {
    const evalReport = await runMemoryOpsEval("/project", {
      cases: [{
        id: "case",
        title: "Case",
        description: "",
        expectedSuggestions: [{ id: "expected" }],
      }],
      runner: async () => report(["expected"]),
      now: new Date("2026-05-21T00:00:00.000Z"),
    })

    expect(evalReport.metrics.passedCaseCount).toBe(1)
    expect(evalReport.id).toBe("eval_20260521000000")
  })

  it("runs built-in AutoResearch fixtures without an injected runner", async () => {
    const evalReport = await runMemoryOpsEval("/project", {
      now: new Date("2026-05-21T00:00:00.000Z"),
    })

    expect(evalReport.metrics.caseCount).toBeGreaterThan(8)
    expect(evalReport.metrics.failedCaseCount).toBe(0)
    expect(evalReport.metrics.precision).toBe(1)
    expect(evalReport.metrics.recall).toBe(1)
  })
})

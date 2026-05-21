import { describe, expect, it } from "vitest"
import { buildMemoryOpsPatrolReportFromSnapshot } from "./memory-ops-engine"
import { BUILT_IN_MEMORY_OPS_EVAL_CASES } from "./memory-ops-eval-fixtures"

describe("memory ops patrol engine", () => {
  it("builds deterministic patrol reports from synthetic snapshots", () => {
    const evalCase = BUILT_IN_MEMORY_OPS_EVAL_CASES.find((item) => item.id === "stale-page")
    if (!evalCase?.snapshot) throw new Error("missing stale-page fixture")

    const report = buildMemoryOpsPatrolReportFromSnapshot(evalCase.snapshot, {
      today: "2026-05-22",
    })

    expect(report.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "lifecycle:-project-wiki-stale-md:stale",
    ])
    expect(report.stats.suggestionCount).toBe(1)
    expect(report.stats.researchEvidenceCandidateCount).toBe(1)
  })

  it("keeps clean fixture clean", () => {
    const evalCase = BUILT_IN_MEMORY_OPS_EVAL_CASES.find((item) => item.id === "clean-control")
    if (!evalCase?.snapshot) throw new Error("missing clean-control fixture")

    const report = buildMemoryOpsPatrolReportFromSnapshot(evalCase.snapshot, {
      today: "2026-05-22",
    })

    expect(report.suggestions).toEqual([])
    expect(report.stats.suggestionCount).toBe(0)
  })

  it("adds decision gates to generated suggestions", () => {
    const evalCase = BUILT_IN_MEMORY_OPS_EVAL_CASES.find((item) => item.id === "semantic-promotion")
    if (!evalCase?.snapshot) throw new Error("missing semantic-promotion fixture")

    const report = buildMemoryOpsPatrolReportFromSnapshot(evalCase.snapshot, {
      today: "2026-05-22",
    })

    expect(report.suggestions[0]?.decision).toMatchObject({
      kind: "ready",
      applyAllowed: true,
      batchAllowed: true,
    })
  })
})

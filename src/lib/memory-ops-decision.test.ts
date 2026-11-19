import { describe, expect, it } from "vitest"
import { decideMemoryOpsSuggestion } from "./memory-ops-decision"
import type { MemoryOpsSuggestion } from "./memory-ops-types"

describe("memory ops suggestion decision gate", () => {
  it("blocks metadata apply when research contradicts the suggestion", () => {
    const decision = decideMemoryOpsSuggestion(metadataSuggestion({
      verdict: "contradicted",
      confidence: 0.8,
      evidenceCount: 2,
      providerCount: 1,
      reportId: "research_1",
      createdAt: "2026-05-22T00:00:00.000Z",
    }), {
      minResearchConfidence: 0.55,
    })

    expect(decision.kind).toBe("blocked-by-contradiction")
    expect(decision.applyAllowed).toBe(false)
    expect(decision.batchAllowed).toBe(false)
  })

  it("requires research for warning patches when configured", () => {
    const decision = decideMemoryOpsSuggestion(metadataSuggestion(undefined, "warning"), {
      minResearchConfidence: 0.55,
      requireResearchForWarnings: true,
    })

    expect(decision.kind).toBe("needs-research")
    expect(decision.applyAllowed).toBe(false)
  })

  it("holds warning patches when support comes from only weak provider quorum", () => {
    const decision = decideMemoryOpsSuggestion(metadataSuggestion({
      verdict: "supported",
      confidence: 0.8,
      evidenceCount: 1,
      providerCount: 1,
      reportId: "research_1",
      createdAt: "2026-05-22T00:00:00.000Z",
      quorumStatus: "weak",
      supportProviderCount: 1,
      independentEvidenceCount: 1,
    }, "warning"), {
      minResearchConfidence: 0.55,
    })

    expect(decision.kind).toBe("needs-research")
    expect(decision.applyAllowed).toBe(false)
    expect(decision.reasons.join(" ")).toContain("independent source diversity")
  })

  it("holds warning patches when providers cite only one unique source", () => {
    const decision = decideMemoryOpsSuggestion(metadataSuggestion({
      verdict: "supported",
      confidence: 0.8,
      evidenceCount: 2,
      providerCount: 2,
      reportId: "research_1",
      createdAt: "2026-05-22T00:00:00.000Z",
      quorumStatus: "met",
      supportProviderCount: 2,
      independentEvidenceCount: 2,
      uniqueSourceCount: 1,
      sourceDiversityScore: 0.5,
    }, "warning"), {
      minResearchConfidence: 0.55,
    })

    expect(decision.kind).toBe("needs-research")
    expect(decision.reasons.join(" ")).toContain("independent source diversity")
  })
})

function metadataSuggestion(
  research: MemoryOpsSuggestion["research"],
  severity: MemoryOpsSuggestion["severity"] = "info",
): MemoryOpsSuggestion {
  return {
    id: "s1",
    kind: "metadata-update",
    severity,
    targetPath: "wiki/a.md",
    title: "Patch",
    detail: "Patch metadata",
    reasons: ["test"],
    research,
    proposedOperation: {
      kind: "metadata-patch",
      targetPath: "wiki/a.md",
      fields: { review_status: "stale" },
      reason: "test",
    },
  }
}

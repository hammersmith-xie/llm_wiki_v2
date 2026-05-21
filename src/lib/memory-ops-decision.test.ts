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

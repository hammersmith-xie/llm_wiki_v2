import { describe, expect, it } from "vitest"
import {
  enrichMemoryOpsSuggestionsWithResearch,
  selectMemoryOpsResearchCandidates,
  summarizeMemoryOpsResearchIntegration,
} from "./memory-ops-research-integration"
import type { MemoryOpsProjectSnapshot, MemoryOpsSuggestion } from "./memory-ops-types"
import type { MemoryOpsResearchEvidenceReport } from "./memory-ops-research-types"

const suggestion: MemoryOpsSuggestion = {
  id: "claim:claim_1:missing-source-refs",
  kind: "review-action",
  severity: "warning",
  targetPath: "wiki/claim.md",
  title: "Review claim with no source refs",
  detail: "Claim text",
  reasons: ["claim has no source_refs"],
}

describe("memory ops research integration", () => {
  it("selects high-risk suggestions before claims and pages", () => {
    const snapshot = {
      claims: [],
      pages: [],
    } as unknown as MemoryOpsProjectSnapshot
    const candidates = selectMemoryOpsResearchCandidates(snapshot, [suggestion])

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.suggestionId).toBe(suggestion.id)
  })

  it("enriches suggestions from latest report", () => {
    const report: MemoryOpsResearchEvidenceReport = {
      schemaVersion: 1,
      id: "research_1",
      createdAt: "2026-05-21T00:00:00.000Z",
      projectPath: "/project",
      trigger: "manual",
      providers: ["local"],
      summary: {
        candidateCount: 1,
        evidenceCount: 2,
        providerCount: 1,
        warningCount: 0,
        verdictCounts: {
          supported: 0,
          contradicted: 1,
          mixed: 0,
          insufficient: 0,
          unavailable: 0,
        },
      },
      warnings: [],
      results: [{
        candidate: {
          id: "suggestion:claim",
          kind: "suggestion",
          targetPath: "wiki/claim.md",
          title: "Review",
          query: "claim",
          summary: "claim",
          reasons: [],
          suggestionId: suggestion.id,
        },
        verdict: "contradicted",
        confidence: 0.75,
        evidence: [],
        providerResults: [],
        warnings: [],
      }],
    }

    const enriched = enrichMemoryOpsSuggestionsWithResearch([suggestion], report)
    expect(enriched[0]?.research?.verdict).toBe("contradicted")
    expect(enriched[0]?.reasons).toContain("research verdict contradicted (0 evidence items)")

    const summary = summarizeMemoryOpsResearchIntegration(report, enriched)
    expect(summary.matchedSuggestionCount).toBe(1)
    expect(summary.contradictedCount).toBe(1)
  })
})

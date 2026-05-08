import { describe, expect, it } from "vitest"
import { extractClaimCandidates } from "./claim-extract"

describe("claim extraction helper", () => {
  it("extracts digest decisions and lessons with evidence source refs", () => {
    const result = extractClaimCandidates({
      pagePath: "wiki/queries/retrieval.md",
      pageTitle: "Retrieval Digest",
      digest: {
        decisions: [{
          id: "decision-1",
          statement: "Decision: expose token, BM25, vector, and graph streams separately.",
          evidencePaths: ["raw\\sources\\search.md"],
        }],
        lessons: [{
          id: "lesson-1",
          text: "Finding: graph traversal helps alias-only questions.",
          evidencePaths: ["wiki/concepts/graph.md"],
        }],
      },
      today: "2026-05-08",
    })

    expect(result.claims).toHaveLength(2)
    expect(result.claims[0]?.origin).toBe("digest-decision")
    expect(result.claims[0]?.claim).toMatchObject({
      page_path: "wiki/queries/retrieval.md",
      page_title: "Retrieval Digest",
      source_refs: [{ path: "raw/sources/search.md" }],
    })
    expect(result.claims[1]?.origin).toBe("digest-lesson")
  })

  it("does not extract generic short text", () => {
    const result = extractClaimCandidates({
      pagePath: "wiki/notes/tiny.md",
      content: "A short note.",
      today: "2026-05-08",
    })

    expect(result.claims).toEqual([])
    expect(result.warnings).toContain("No high-value claim candidates found.")
  })

  it("limits each write to a bounded number of claims", () => {
    const result = extractClaimCandidates({
      pagePath: "wiki/synthesis/results.md",
      maxClaims: 2,
      content: [
        "- Finding: BM25 improves exact acronym lookup.",
        "- Conclusion: graph expansion improves alias recall.",
        "- Recommendation: keep vector search as a secondary stream.",
      ].join("\n"),
      sourceRefs: [{ path: "raw/sources/eval.md" }],
      today: "2026-05-08",
    })

    expect(result.claims).toHaveLength(2)
    expect(result.skippedCount).toBe(1)
    expect(result.warnings).toContain("Skipped 1 claim candidate because maxClaims=2.")
  })

  it("skips invalid digest items without throwing", () => {
    const result = extractClaimCandidates({
      pagePath: "wiki/queries/retrieval.md",
      digest: {
        decisions: [{ id: "empty", statement: " ", evidencePaths: [] }],
        lessons: [{ id: "lesson-1", text: "Conclusion: keep audit evidence local.", evidencePaths: [] }],
      },
      today: "2026-05-08",
    })

    expect(result.claims).toHaveLength(1)
    expect(result.warnings).toContain("Skipped empty digest decision empty.")
  })
})

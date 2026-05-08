import { describe, expect, it } from "vitest"
import { buildPreWriteCandidate, classifyPreWriteConflict } from "./prewrite-conflict"
import { preWriteConflictToReviewItem } from "./prewrite-conflict-review"

describe("pre-write conflict review conversion", () => {
  const candidate = buildPreWriteCandidate({
    kind: "ingest-page",
    targetPath: "wiki/concepts/search.md",
    title: "Hybrid Search",
    content: "# Hybrid Search",
    sourcePath: "raw/search.md",
    claimSummaries: [{
      claimId: "claim_candidate",
      text: "Hybrid search improves recall.",
      status: "ok",
      pagePath: "wiki/concepts/search.md",
    }],
  })

  it("converts possible contradictions into contradiction review items", () => {
    const preview = classifyPreWriteConflict(candidate, [{
      kind: "claim",
      claimId: "claim_old",
      claimText: "Hybrid search does not improve recall.",
      pagePath: "wiki/concepts/search.md",
      status: "contradicted",
      relation: "contradicts",
      score: 0.9,
      reasons: ["contradiction relation present"],
    }])

    const item = preWriteConflictToReviewItem(preview)

    expect(item).toMatchObject({
      type: "contradiction",
      title: "Pre-write conflict: Hybrid Search",
      sourcePath: "raw/search.md",
      affectedPages: ["wiki/concepts/search.md"],
      options: [
        { label: "Review conflict", action: "open:wiki/concepts/search.md" },
        { label: "Skip write", action: "Skip" },
      ],
    })
    expect(item.description).toContain("possible-contradiction")
    expect(item.searchQueries).toContain("Hybrid Search pre-write conflict")
  })

  it("converts duplicate and uncertain previews into confirm review items", () => {
    const duplicate = classifyPreWriteConflict(candidate, [{
      kind: "page",
      pagePath: "wiki/patterns/hybrid-search.md",
      pageTitle: "Hybrid Search",
      score: 0.9,
      reasons: ["same title exists at a different path"],
    }])
    const uncertain = classifyPreWriteConflict(candidate, [{
      kind: "error",
      score: 1,
      reasons: ["resolver warning"],
    }])

    expect(preWriteConflictToReviewItem(duplicate)).toMatchObject({
      type: "confirm",
      affectedPages: ["wiki/concepts/search.md", "wiki/patterns/hybrid-search.md"],
    })
    expect(preWriteConflictToReviewItem(uncertain)).toMatchObject({
      type: "confirm",
      title: "Pre-write conflict: Hybrid Search",
    })
  })
})

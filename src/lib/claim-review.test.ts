import { describe, expect, it } from "vitest"
import { normalizeClaimRecord } from "./claims"
import { claimToReviewItem } from "./claim-review"

describe("claim review handoff", () => {
  it("creates review-only handoff items for contradicted claims", () => {
    const claim = normalizeClaimRecord({
      text: "BM25 always beats vector search.",
      page_path: "wiki/concepts/search.md",
      status: "contradicted",
      contradicts: ["claim_vector"],
    }, { today: "2026-05-08" }).claim

    const item = claimToReviewItem(claim)

    expect(item).toMatchObject({
      type: "confirm",
      title: "Review contradicted claim",
      sourcePath: "wiki/concepts/search.md",
      affectedPages: ["wiki/concepts/search.md"],
      options: [
        { label: "Open page", action: "open:wiki/concepts/search.md" },
        { label: "Mark reviewed", action: expect.stringMatching(/^claim\.review:claim_/) },
      ],
    })
    expect(item?.description).toContain("BM25 always beats vector search.")
    expect(item?.description).toContain("review-only")
  })

  it("creates review-only handoff items for superseded claims", () => {
    const claim = normalizeClaimRecord({
      text: "Use the old graph pipeline.",
      page_path: "wiki/concepts/graph.md",
      status: "superseded",
      superseded_by: ["claim_new_graph"],
    }, { today: "2026-05-08" }).claim

    expect(claimToReviewItem(claim)).toMatchObject({
      title: "Review superseded claim",
      options: expect.arrayContaining([
        { label: "Mark reviewed", action: expect.stringMatching(/^claim\.review:claim_/) },
      ]),
    })
  })

  it("does not create review items for healthy claims", () => {
    const claim = normalizeClaimRecord({
      text: "Hybrid search keeps multiple retrieval streams explainable.",
      page_path: "wiki/concepts/search.md",
      status: "ok",
    }, { today: "2026-05-08" }).claim

    expect(claimToReviewItem(claim)).toBeNull()
  })
})

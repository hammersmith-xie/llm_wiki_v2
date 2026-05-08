import { describe, expect, it } from "vitest"
import { normalizeClaimRecord } from "./claims"
import { lookupClaimEvidence } from "./claim-evidence"

describe("claim evidence lookup", () => {
  it("returns empty evidence when the claim index is unavailable", () => {
    const result = lookupClaimEvidence({
      query: "hybrid search",
      pageResults: [{ path: "/project/wiki/concepts/search.md", rank: 1 }],
      claims: [],
    })

    expect(result).toEqual({ evidence: [], warnings: [] })
  })

  it("sorts by page match, query token match, confidence, and status", () => {
    const strong = normalizeClaimRecord({
      text: "Hybrid search keeps BM25 and vector evidence separately auditable.",
      page_path: "wiki/concepts/search.md",
      status: "ok",
      confidence: "0.9",
      source_refs: [{ path: "raw/search.md" }],
    }, { today: "2026-05-08" }).claim
    const weak = normalizeClaimRecord({
      text: "Hybrid search might be useful.",
      page_path: "wiki/concepts/search.md",
      status: "stale",
      confidence: "0.4",
    }, { today: "2026-05-08" }).claim
    const otherPage = normalizeClaimRecord({
      text: "Hybrid search on a non-result page.",
      page_path: "wiki/concepts/other.md",
      status: "ok",
      confidence: "1.0",
    }, { today: "2026-05-08" }).claim

    const result = lookupClaimEvidence({
      query: "hybrid BM25 evidence",
      pageResults: [{ path: "/project/wiki/concepts/search.md", rank: 1 }],
      claims: [weak, otherPage, strong],
      existingPagePaths: ["wiki/concepts/search.md", "wiki/concepts/other.md"],
    })

    expect(result.evidence.map((item) => item.claimId)).toEqual([strong.claim_id, weak.claim_id])
    expect(result.evidence[0]).toMatchObject({
      pagePath: "wiki/concepts/search.md",
      status: "ok",
      matchedTerms: ["hybrid", "bm25", "evidence"],
    })
  })

  it("matches CJK claim text", () => {
    const claim = normalizeClaimRecord({
      text: "图谱检索可以补足关键词检索的召回盲区。",
      page_path: "wiki/synthesis/检索.md",
      status: "ok",
      confidence: "0.8",
    }, { today: "2026-05-08" }).claim

    const result = lookupClaimEvidence({
      query: "图谱检索",
      pageResults: [{ path: "wiki/synthesis/检索.md", rank: 1 }],
      claims: [claim],
      existingPagePaths: ["wiki/synthesis/检索.md"],
    })

    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]?.matchedTerms).toContain("图谱检索")
  })

  it("keeps orphan claims out of evidence and reports a warning", () => {
    const claim = normalizeClaimRecord({
      text: "A claim whose page was deleted.",
      page_path: "wiki/concepts/deleted.md",
      status: "ok",
    }, { today: "2026-05-08" }).claim

    const result = lookupClaimEvidence({
      query: "deleted claim",
      pageResults: [{ path: "wiki/concepts/deleted.md", rank: 1 }],
      claims: [claim],
      existingPagePaths: ["wiki/concepts/search.md"],
    })

    expect(result.evidence).toEqual([])
    expect(result.warnings).toEqual([
      expect.objectContaining({
        claimId: claim.claim_id,
        kind: "orphan",
        pagePath: "wiki/concepts/deleted.md",
      }),
    ])
  })
})

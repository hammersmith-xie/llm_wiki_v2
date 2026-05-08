import { describe, expect, it } from "vitest"
import {
  buildPreWriteCandidate,
  summarizePreWriteContent,
} from "./prewrite-conflict"

describe("pre-write conflict candidate", () => {
  it("builds stable ids from kind, target path, and title", () => {
    const first = buildPreWriteCandidate({
      kind: "ingest-page",
      targetPath: "wiki/Concepts/Search.md",
      title: "Hybrid Search",
      content: "# Hybrid Search\n\nBM25 plus graph context improves recall.",
      sourcePath: "raw/search.md",
    })
    const second = buildPreWriteCandidate({
      kind: "ingest-page",
      targetPath: "wiki/concepts/search.md",
      title: "  Hybrid   Search  ",
      content: "# Hybrid Search\n\nDifferent content should not change identity.",
      sourcePath: "raw/other.md",
    })

    expect(first.id).toBe(second.id)
    expect(first).toMatchObject({
      kind: "ingest-page",
      targetPath: "wiki/Concepts/Search.md",
      title: "Hybrid Search",
      sourcePath: "raw/search.md",
    })
  })

  it("caps content summaries and redacts obvious secrets", () => {
    const summary = summarizePreWriteContent(
      [
        "Authorization: Bearer sk-proj-secret-token-1234567890",
        "This page explains a conflict gate.",
        "x".repeat(500),
      ].join("\n"),
      120,
    )

    expect(summary.length).toBeLessThanOrEqual(120)
    expect(summary).toContain("[REDACTED:secret]")
    expect(summary).not.toContain("sk-proj-secret-token")
  })

  it("keeps only bounded claim summaries on the candidate", () => {
    const candidate = buildPreWriteCandidate({
      kind: "crystallization-page",
      targetPath: "wiki/crystallized/query.md",
      content: "# Query",
      claimSummaries: Array.from({ length: 12 }, (_, index) => ({
        claimId: `claim_${index}`,
        text: `Claim ${index} `.repeat(40),
        status: "ok",
        pagePath: "wiki/crystallized/query.md",
      })),
      maxClaims: 5,
    })

    expect(candidate.claimSummaries).toHaveLength(5)
    expect(candidate.claimSummaries[0]?.text.length).toBeLessThanOrEqual(160)
  })
})

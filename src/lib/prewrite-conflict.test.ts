import { describe, expect, it } from "vitest"
import {
  buildPreWriteCandidate,
  classifyPreWriteConflict,
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

describe("pre-write conflict classification", () => {
  const candidate = buildPreWriteCandidate({
    kind: "ingest-page",
    targetPath: "wiki/concepts/search.md",
    title: "Hybrid Search",
    content: "# Hybrid Search\n\nBM25 plus graph context improves recall.",
    claimSummaries: [{
      claimId: "claim_candidate",
      text: "Hybrid search improves recall by combining BM25 and graph context.",
      status: "ok",
      pagePath: "wiki/concepts/search.md",
    }],
  })

  it("allows new writes when no related evidence exists", () => {
    const preview = classifyPreWriteConflict(candidate, [])

    expect(preview).toMatchObject({
      classification: "new",
      decision: "allow",
      severity: "info",
    })
    expect(preview.reasons).toContain("No related page or claim evidence was found.")
  })

  it("allows reinforcement when an active claim is similar", () => {
    const preview = classifyPreWriteConflict(candidate, [{
      kind: "claim",
      claimId: "claim_existing",
      claimText: "Hybrid search improves recall by combining BM25 and graph context.",
      pagePath: "wiki/concepts/search.md",
      status: "ok",
      score: 0.95,
      reasons: ["claim text overlaps candidate"],
    }])

    expect(preview).toMatchObject({
      classification: "reinforcement",
      decision: "allow",
      severity: "info",
    })
  })

  it("allows same-target page updates without risky evidence", () => {
    const preview = classifyPreWriteConflict(candidate, [{
      kind: "page",
      pagePath: "wiki/concepts/search.md",
      pageTitle: "Hybrid Search",
      score: 1,
      reasons: ["target path already exists"],
    }])

    expect(preview).toMatchObject({
      classification: "update",
      decision: "allow",
      severity: "info",
    })
  })

  it("requires review for duplicate evidence on a different target", () => {
    const preview = classifyPreWriteConflict(candidate, [{
      kind: "page",
      pagePath: "wiki/patterns/hybrid-search.md",
      pageTitle: "Hybrid Search",
      score: 0.9,
      reasons: ["same title exists at a different path"],
    }])

    expect(preview).toMatchObject({
      classification: "duplicate",
      decision: "review-only",
      severity: "warning",
    })
  })

  it("requires review for contradiction evidence", () => {
    const preview = classifyPreWriteConflict(candidate, [{
      kind: "claim",
      claimId: "claim_old",
      claimText: "Hybrid search does not improve recall.",
      pagePath: "wiki/concepts/search.md",
      status: "contradicted",
      relation: "contradicts",
      score: 0.8,
      reasons: ["contradiction relation present"],
    }])

    expect(preview).toMatchObject({
      classification: "possible-contradiction",
      decision: "review-only",
      severity: "blocking",
    })
    expect(preview.reasons.join(" ")).toContain("contradiction")
  })

  it("requires review for supersession evidence", () => {
    const preview = classifyPreWriteConflict(candidate, [{
      kind: "relation",
      claimId: "claim_old",
      claimText: "Older search conclusion.",
      pagePath: "wiki/concepts/search.md",
      status: "superseded",
      relation: "superseded-by",
      score: 0.75,
      reasons: ["superseded relation present"],
    }])

    expect(preview).toMatchObject({
      classification: "supersession",
      decision: "review-only",
      severity: "blocking",
    })
  })
})

import { describe, expect, it } from "vitest"
import {
  buildClaimSourceRefsForText,
  createSnippetHash,
  findBestSourceSnippet,
  locateSnippet,
  mergeClaimSourceRefs,
  summarizeClaimProvenance,
} from "./claim-provenance"
import { normalizeClaimRecord } from "./claims"

describe("claim provenance helpers", () => {
  it("finds exact supporting snippets and creates stable hashes", () => {
    const source = [
      "# Retrieval Notes",
      "",
      "Hybrid search keeps BM25, vector, and graph evidence separately auditable.",
    ].join("\n")

    const refs = buildClaimSourceRefsForText({
      baseRefs: [{ path: "raw\\sources\\search.md" }],
      claimText: "Hybrid search keeps BM25, vector, and graph evidence separately auditable.",
      sourceContent: source,
    })

    expect(refs).toEqual([
      expect.objectContaining({
        path: "raw/sources/search.md",
        anchor: expect.stringMatching(/^snippet:/),
        snippet_hash: createSnippetHash("Hybrid search keeps BM25, vector, and graph evidence separately auditable."),
        line_start: 3,
        line_end: 3,
        char_start: expect.any(Number),
        char_end: expect.any(Number),
      }),
    ])
  })

  it("derives PDF-style page and line anchors from extracted markdown", () => {
    const source = [
      "## Page 1",
      "",
      "Intro text.",
      "",
      "## Page 2",
      "",
      "Hybrid search keeps BM25, vector, and graph evidence separately auditable.",
    ].join("\n")

    const refs = buildClaimSourceRefsForText({
      baseRefs: [{ path: "raw/sources/paper.pdf" }],
      claimText: "Hybrid search keeps BM25, vector, and graph evidence separately auditable.",
      sourceContent: source,
    })

    expect(refs[0]).toMatchObject({
      page: 2,
      line_start: 7,
      line_end: 7,
      char_start: source.indexOf("Hybrid search"),
      char_end: source.length,
    })
  })

  it("locates multi-line snippets without storing raw snippet text", () => {
    const source = "Title\n\nFirst supporting line.\nSecond supporting line.\n"
    const location = locateSnippet(source, "First supporting line.\nSecond supporting line.")

    expect(location).toEqual({
      charStart: source.indexOf("First"),
      charEnd: source.indexOf("Second supporting line.") + "Second supporting line.".length,
      lineStart: 3,
      lineEnd: 4,
    })
  })

  it("falls back to paragraph overlap when generated claim wording differs", () => {
    const source = [
      "The retrieval pipeline records lexical matches, semantic vector hits, and graph expansions as separate streams.",
      "This lets reviewers audit why a result was returned.",
    ].join(" ")

    const match = findBestSourceSnippet(
      "Finding: retrieval should keep lexical, vector, and graph streams separately auditable.",
      source,
    )

    expect(match).toMatchObject({
      score: expect.any(Number),
      anchor: expect.stringMatching(/^snippet:/),
    })
    expect(match?.snippet).toContain("retrieval pipeline")
  })

  it("supports CJK overlap without requiring whitespace tokenization", () => {
    const source = "本地知识库应当保留来源证据，并通过片段哈希支持后续审计。"

    const match = findBestSourceSnippet(
      "建议：本地知识库必须保留来源证据和片段哈希。",
      source,
      { minOverlap: 0.24 },
    )

    expect(match?.snippet).toBe(source)
  })

  it("returns normalized path-only refs when no snippet is credible", () => {
    const refs = buildClaimSourceRefsForText({
      baseRefs: [{ path: "raw\\sources\\search.md", title: " Search " }],
      claimText: "Conclusion: unrelated content should not receive a fake hash.",
      sourceContent: "A short note about another topic.",
    })

    expect(refs).toEqual([{ path: "raw/sources/search.md", title: "Search" }])
  })

  it("prefers richer refs over path-only duplicates", () => {
    expect(mergeClaimSourceRefs(
      [{ path: "raw/sources/search.md" }],
      [{
        path: "raw/sources/search.md",
        anchor: "snippet:abc",
        snippet_hash: "snippet_abc",
        page: 2,
      }],
    )).toEqual([{
      path: "raw/sources/search.md",
      anchor: "snippet:abc",
      snippet_hash: "snippet_abc",
      page: 2,
    }])
  })

  it("summarizes missing source refs and missing snippet hashes", () => {
    const noSources = normalizeClaimRecord({
      text: "Claim without sources.",
      page_path: "wiki/concepts/a.md",
    }).claim
    const pathOnly = normalizeClaimRecord({
      text: "Claim with path-only sources.",
      page_path: "wiki/concepts/a.md",
      source_refs: [{ path: "raw/sources/a.md" }],
    }).claim

    expect(summarizeClaimProvenance(noSources)).toMatchObject({
      missingSourceRefs: true,
      missingSnippetHash: false,
    })
    expect(summarizeClaimProvenance(pathOnly)).toMatchObject({
      missingSourceRefs: false,
      missingSnippetHash: true,
    })
  })
})

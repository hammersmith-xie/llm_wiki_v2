import { describe, expect, it } from "vitest"
import { rankBm25Documents } from "./search"

describe("local BM25 lexical scorer", () => {
  it("weights filename and title fields above repeated body-only matches", () => {
    const hits = rankBm25Documents([
      document("wiki/concepts/random.md", "random.md", [
        "---",
        "title: Random",
        "---",
        "",
        "# Random",
        "",
        "attention attention attention attention attention attention",
      ].join("\n")),
      document("wiki/concepts/attention.md", "attention.md", [
        "---",
        "title: Attention Mechanism",
        "---",
        "",
        "# Attention Mechanism",
        "",
        "attention appears once.",
      ].join("\n")),
    ], "attention")

    expect(hits.map((hit) => ({ path: hit.path, rank: hit.rank }))).toEqual([
      { path: "wiki/concepts/attention.md", rank: 1 },
      { path: "wiki/concepts/random.md", rank: 2 },
    ])
    expect(hits[0].explain.fieldScores.filename).toBeGreaterThan(0)
    expect(hits[0].explain.fieldScores.title).toBeGreaterThan(0)
    expect(hits[1].explain.fieldScores.body).toBeGreaterThan(0)
  })

  it("uses aliases and keywords as weighted fields", () => {
    const hits = rankBm25Documents([
      document("wiki/concepts/retriever.md", "retriever.md", [
        "---",
        "title: Retriever",
        "aliases: [bm25]",
        "keywords: [ranking]",
        "---",
        "",
        "# Retriever",
        "",
        "Sparse search overview.",
      ].join("\n")),
      document("wiki/concepts/body-only.md", "body-only.md", [
        "---",
        "title: Body Only",
        "---",
        "",
        "# Body Only",
        "",
        "bm25 is mentioned in the body.",
      ].join("\n")),
    ], "bm25 ranking")

    expect(hits[0]).toMatchObject({
      path: "wiki/concepts/retriever.md",
      rank: 1,
    })
    expect(hits[0].explain.matchedTokensByField.aliases).toContain("bm25")
    expect(hits[0].explain.matchedTokensByField.keywords).toContain("ranking")
  })

  it("keeps deterministic path ordering for score ties and supports CJK tokens", () => {
    const tied = rankBm25Documents([
      document("wiki/concepts/b.md", "b.md", "---\ntitle: B\n---\n\nrope"),
      document("wiki/concepts/a.md", "a.md", "---\ntitle: A\n---\n\nrope"),
    ], "rope")
    expect(tied.map((hit) => hit.path)).toEqual([
      "wiki/concepts/a.md",
      "wiki/concepts/b.md",
    ])

    const cjk = rankBm25Documents([
      document("wiki/concepts/tacit.md", "tacit.md", [
        "---",
        "title: 默会知识",
        "keywords: [波兰尼]",
        "---",
        "",
        "# 默会知识",
        "",
        "tacit knowledge",
      ].join("\n")),
    ], "默会知识。")
    expect(cjk[0]).toMatchObject({
      path: "wiki/concepts/tacit.md",
      rank: 1,
    })
    expect(cjk[0].explain.queryTokens).toEqual(
      expect.arrayContaining(["默会", "会知", "知识", "默会知识"]),
    )
  })
})

function document(path: string, fileName: string, content: string) {
  return { path, fileName, content }
}

import { describe, expect, it } from "vitest"
import { rankLexicalDocuments } from "./search"

describe("token lexical retriever adapter", () => {
  it("ranks filename-exact matches first with explanation metadata", () => {
    const hits = rankLexicalDocuments([
      document("wiki/concepts/random.md", "random.md", [
        "---",
        "title: Random",
        "---",
        "",
        "# Random",
        "",
        "attention is mentioned briefly.",
      ].join("\n")),
      document("wiki/concepts/attention.md", "attention.md", [
        "---",
        "title: Attention",
        "---",
        "",
        "# Attention",
        "",
        "body about attention.",
      ].join("\n")),
    ], "attention")

    expect(hits.map((hit) => ({ path: hit.path, rank: hit.rank }))).toEqual([
      { path: "wiki/concepts/attention.md", rank: 1 },
      { path: "wiki/concepts/random.md", rank: 2 },
    ])
    expect(hits[0].explain).toMatchObject({
      queryPhrase: "attention",
      filenameExact: true,
      titleHasPhrase: true,
      scoreBreakdown: {
        filenameExact: 200,
        titlePhrase: 50,
      },
    })
    expect(hits[0].explain.titleTokenMatches).toContain("attention")
  })

  it("keeps CJK phrase matching stable after punctuation normalization", () => {
    const hits = rankLexicalDocuments([
      document("wiki/concepts/tacit.md", "tacit.md", [
        "---",
        "title: 默会知识",
        "---",
        "",
        "# 默会知识",
        "",
        "波兰尼提出 tacit knowledge。",
      ].join("\n")),
    ], "默会知识。")

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      rank: 1,
      title: "默会知识",
      titleMatch: true,
      explain: {
        queryPhrase: "默会知识",
        titleHasPhrase: true,
      },
    })
    expect(hits[0].explain.tokens).toEqual(
      expect.arrayContaining(["默会", "会知", "知识", "默会知识"]),
    )
  })
})

function document(path: string, fileName: string, content: string) {
  return { path, fileName, content }
}

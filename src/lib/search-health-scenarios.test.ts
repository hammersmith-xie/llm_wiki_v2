import { describe, expect, it } from "vitest"
import { normalizeSearchHealthScenarioConfig } from "./search-health-scenarios"

describe("search health custom scenarios", () => {
  it("normalizes supported custom scenario fields", () => {
    const result = normalizeSearchHealthScenarioConfig({
      scenarios: [
        {
          id: " Critical Query ",
          query: "hybrid search",
          expectedTopPaths: [" /project/wiki/concepts/search.md "],
          expectedInTopK: [{ path: "wiki/concepts/hybrid.md", topK: "3" }],
          expectedOutsideTopK: [{ path: "wiki/archive/old.md", topK: 1 }],
          excludedPaths: ["wiki/private/draft.md"],
          topK: "7",
        },
      ],
    })

    expect(result.scenarios).toEqual([
      {
        id: "critical-query",
        query: "hybrid search",
        expectedTopPaths: ["project/wiki/concepts/search.md"],
        expectedInTopK: [{ path: "wiki/concepts/hybrid.md", topK: 3 }],
        expectedOutsideTopK: [{ path: "wiki/archive/old.md", topK: 1 }],
        excludedPaths: ["wiki/private/draft.md"],
        topK: 7,
      },
    ])
    expect(result.skipped).toEqual([])
  })

  it("skips invalid and duplicate scenarios without throwing", () => {
    const result = normalizeSearchHealthScenarioConfig({
      scenarios: [
        { id: "missing-query", expectedTopPaths: ["wiki/a.md"] },
        { id: "no-expectations", query: "alpha" },
        { id: "dup", query: "first", expectedInTopK: [{ path: "wiki/a.md", topK: 2 }] },
        { id: "dup", query: "second", expectedInTopK: [{ path: "wiki/b.md", topK: 2 }] },
        { id: "bad-topk", query: "beta", expectedInTopK: [{ path: "wiki/b.md", topK: -1 }] },
      ],
    })

    expect(result.scenarios).toEqual([
      {
        id: "dup",
        query: "first",
        expectedInTopK: [{ path: "wiki/a.md", topK: 2 }],
      },
    ])
    expect(result.skipped.map((item) => item.id)).toEqual([
      "missing-query",
      "no-expectations",
      "dup",
      "bad-topk",
    ])
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("missing-query"),
      expect.stringContaining("duplicate"),
      expect.stringContaining("bad-topk"),
    ]))
  })

  it("returns empty scenarios and a warning for malformed config roots", () => {
    const result = normalizeSearchHealthScenarioConfig({ scenarios: "not-array" })

    expect(result.scenarios).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.warnings).toEqual(["Custom search health scenarios must be an array."])
  })
})

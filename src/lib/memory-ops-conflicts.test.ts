import { describe, expect, it } from "vitest"
import { buildMemoryOpsConflictCandidate } from "./memory-ops-conflicts"
import type { MemoryOpsWikiPage } from "./memory-ops"

describe("memory ops conflict candidates", () => {
  it("builds a stable maintenance pre-write candidate from an existing page", () => {
    const page: MemoryOpsWikiPage = {
      id: "hybrid-search",
      fileName: "hybrid-search.md",
      path: "/project/wiki/concepts/hybrid-search.md",
      content: [
        "---",
        "title: Hybrid Search",
        "---",
        "",
        "# Hybrid Search",
        "",
        "Use BM25, vectors, and typed graph expansion.",
        "api_key = sk-test-secret",
      ].join("\n"),
      frontmatter: {
        title: "Hybrid Search",
      },
    }

    const first = buildMemoryOpsConflictCandidate("/project", page)
    const second = buildMemoryOpsConflictCandidate("/project/", page)

    expect(first).toMatchObject({
      kind: "maintenance-page",
      targetPath: "wiki/concepts/hybrid-search.md",
      title: "Hybrid Search",
    })
    expect(second.id).toBe(first.id)
    expect(first.contentSummary).toContain("Hybrid Search")
    expect(first.contentSummary).not.toContain("sk-test-secret")
    expect(first.contentSummary.length).toBeLessThanOrEqual(480)
  })
})

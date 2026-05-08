import { describe, expect, it } from "vitest"
import {
  buildMemoryOpsConflictCandidate,
  previewMemoryOpsHistoricalConflicts,
} from "./memory-ops-conflicts"
import type { MemoryOpsWikiPage } from "./memory-ops"
import type { PreWriteConflictPreview } from "./prewrite-conflict"

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

  it("keeps high-risk historical previews and filters safe same-target updates", async () => {
    const pages = [
      page("safe", "Safe", "wiki/concepts/safe.md"),
      page("dup", "Duplicate", "wiki/concepts/dup.md"),
      page("risk", "Risk", "wiki/concepts/risk.md"),
    ]
    const previews: Record<string, PreWriteConflictPreview["classification"]> = {
      "wiki/concepts/safe.md": "update",
      "wiki/concepts/dup.md": "duplicate",
      "wiki/concepts/risk.md": "possible-contradiction",
    }

    const result = await previewMemoryOpsHistoricalConflicts("/project", pages, {
      previewConflict: async (_projectPath, candidate) => ({
        warnings: [],
        preview: {
          candidate,
          classification: previews[candidate.targetPath] ?? "new",
          decision: candidate.targetPath.includes("safe") ? "allow" : "review-only",
          severity: candidate.targetPath.includes("safe") ? "info" : "warning",
          evidence: candidate.targetPath.includes("safe")
            ? [{
                kind: "page",
                pagePath: candidate.targetPath,
                score: 1,
                reasons: ["same target page"],
              }]
            : [{
                kind: "page",
                pagePath: "wiki/concepts/other.md",
                score: 0.9,
                reasons: ["different target page"],
              }],
          reasons: ["previewed"],
        },
      }),
    })

    expect(result.candidateCount).toBe(3)
    expect(result.previews.map((preview) => preview.candidate.targetPath)).toEqual([
      "wiki/concepts/dup.md",
      "wiki/concepts/risk.md",
    ])
    expect(result.warningCount).toBe(0)
  })

  it("continues historical preview when one page fails", async () => {
    const pages = [
      page("broken", "Broken", "wiki/concepts/broken.md"),
      page("dup", "Duplicate", "wiki/concepts/dup.md"),
    ]

    const result = await previewMemoryOpsHistoricalConflicts("/project", pages, {
      previewConflict: async (_projectPath, candidate) => {
        if (candidate.targetPath.includes("broken")) throw new Error("resolver down")
        return {
          warnings: [],
          preview: {
            candidate,
            classification: "duplicate",
            decision: "review-only",
            severity: "warning",
            evidence: [{
              kind: "page",
              pagePath: "wiki/concepts/other.md",
              score: 0.9,
              reasons: ["different target page"],
            }],
            reasons: ["previewed"],
          },
        }
      },
    })

    expect(result.previews).toHaveLength(1)
    expect(result.warnings).toEqual([
      {
        pagePath: "wiki/concepts/broken.md",
        message: "resolver down",
      },
    ])
  })
})

function page(id: string, title: string, relativePath: string): MemoryOpsWikiPage {
  return {
    id,
    fileName: `${id}.md`,
    path: `/project/${relativePath}`,
    content: `---\ntitle: ${title}\n---\n\n# ${title}\n\nContent.`,
    frontmatter: { title },
  }
}

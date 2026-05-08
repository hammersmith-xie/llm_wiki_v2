import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseFrontmatter } from "@/lib/frontmatter"
import { preWriteConflictToReviewItem } from "@/lib/prewrite-conflict-review"
import {
  buildReviewCreatedPageWrite,
  buildReviewCreatedPageContent,
  buildReviewCreatedPageTarget,
  previewReviewCreatedPageWrite,
} from "./review-page"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(async () => []),
  readFile: vi.fn(async () => ""),
}))

import { listDirectory, readFile } from "@/commands/fs"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockListDirectory.mockResolvedValue([])
  mockReadFile.mockReset()
  mockReadFile.mockResolvedValue("")
})

describe("review page creation", () => {
  it("builds v2 lifecycle frontmatter for pages created from review items", () => {
    const content = buildReviewCreatedPageContent({
      pageType: "concept",
      title: 'Agent Search: "Tavily"',
      description: "Conclusion: Tavily should be treated as an external search provider.",
      date: "2026-05-07",
    })

    const parsed = parseFrontmatter(content)

    expect(parsed.frontmatter).toMatchObject({
      type: "concept",
      title: 'Agent Search: "Tavily"',
      created: "2026-05-07",
      updated: "2026-05-07",
      origin: "review-create",
      lifecycle: "semantic",
      last_confirmed: "2026-05-07",
      review_status: "needs-review",
      scope: "shared",
    })
    expect(parsed.frontmatter?.sources).toEqual([])
    expect(parsed.frontmatter?.alias).toEqual([])
    expect(parsed.frontmatter?.aliases).toEqual([])
    expect(parsed.frontmatter?.keywords).toEqual([])
    expect(parsed.frontmatter?.related).toEqual([])
    expect(parsed.frontmatter?.uses).toEqual([])
    expect(parsed.frontmatter?.depends_on).toEqual([])
    expect(parsed.frontmatter?.contradicts).toEqual([])
    expect(parsed.frontmatter?.supports).toEqual([])
    expect(parsed.frontmatter?.supersedes).toEqual([])
    expect(parsed.frontmatter?.superseded_by).toEqual([])
    expect(parsed.body).toContain("# Agent Search: \"Tavily\"")
    expect(parsed.body).toContain("<!-- claim:")
    expect(parsed.body).toContain("Conclusion: Tavily should be treated as an external search provider.")
  })

  it("maps review-created page targets to schema directories with unicode-safe slugs", () => {
    expect(
      buildReviewCreatedPageTarget({
        projectPath: "/p",
        pageType: "comparison",
        title: "模型 比较",
        date: "2026-05-07",
      }),
    ).toMatchObject({
      dir: "comparisons",
      slug: "模型-比较",
      fileName: "模型-比较-2026-05-07.md",
      filePath: "/p/wiki/comparisons/模型-比较-2026-05-07.md",
      linkTarget: "comparisons/模型-比较-2026-05-07",
    })

    expect(
      buildReviewCreatedPageTarget({
        projectPath: "/p",
        pageType: "synthesis",
        title: "Cross-Cutting Summary",
        date: "2026-05-07",
      }).dir,
    ).toBe("synthesis")
  })

  it("builds review-created page write candidates without losing claim anchors", () => {
    const write = buildReviewCreatedPageWrite({
      projectPath: "/p",
      pageType: "concept",
      title: "Conflict Gate",
      description: "Finding: review-created pages should also pass the conflict gate.",
      date: "2026-05-08",
    })

    expect(write.target.filePath).toBe("/p/wiki/concepts/conflict-gate-2026-05-08.md")
    expect(write.content).toContain("<!-- claim:")
    expect(write.candidate).toMatchObject({
      kind: "review-created-page",
      targetPath: "wiki/concepts/conflict-gate-2026-05-08.md",
      title: "Conflict Gate",
    })
    expect(write.candidate.claimSummaries).toHaveLength(1)
  })

  it("previews review-created page conflicts before callers write files", async () => {
    const contradictedClaim = {
      claim_id: "claim_old",
      text: "Review-created pages should also pass the conflict gate.",
      page_path: "wiki/concepts/conflict-gate-2026-05-08.md",
      source_refs: [],
      lifecycle: "semantic",
      status: "contradicted",
      confidence: "0.30",
      confidence_reasons: ["contradiction signal present"],
      last_confirmed: "2026-05-08",
      reinforcement_count: "0",
      supports: [],
      contradicts: [],
      supersedes: [],
      superseded_by: [],
      scope: "shared",
      created_at: "2026-05-08",
      updated_at: "2026-05-08",
    }
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/p/.llm-wiki/claims.jsonl") return `${JSON.stringify(contradictedClaim)}\n`
      return ""
    })

    const result = await previewReviewCreatedPageWrite({
      projectPath: "/p",
      pageType: "concept",
      title: "Conflict Gate",
      description: "Finding: Review-created pages should also pass the conflict gate.",
      date: "2026-05-08",
    })

    expect(result.preview).toMatchObject({
      classification: "possible-contradiction",
      decision: "review-only",
    })
    expect(preWriteConflictToReviewItem(result.preview)).toMatchObject({
      type: "contradiction",
      affectedPages: ["wiki/concepts/conflict-gate-2026-05-08.md"],
    })
  })
})

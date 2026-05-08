import { describe, expect, it } from "vitest"
import { parseFrontmatter } from "@/lib/frontmatter"
import {
  buildReviewCreatedPageContent,
  buildReviewCreatedPageTarget,
} from "./review-page"

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
})

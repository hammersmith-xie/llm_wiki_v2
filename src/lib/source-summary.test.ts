import { describe, expect, it } from "vitest"
import { parseFrontmatter } from "@/lib/frontmatter"
import { buildFallbackSourceSummaryContent } from "./source-summary"

describe("fallback source summaries", () => {
  it("builds v2 lifecycle frontmatter for ingest fallback source pages", () => {
    const content = buildFallbackSourceSummaryContent({
      fileName: "rope-paper.md",
      date: "2026-05-07",
      body: "Analysis summary.",
    })

    const parsed = parseFrontmatter(content)

    expect(parsed.frontmatter).toMatchObject({
      type: "source",
      title: "Source: rope-paper.md",
      created: "2026-05-07",
      updated: "2026-05-07",
      lifecycle: "episodic",
      last_confirmed: "2026-05-07",
      review_status: "ok",
      scope: "shared",
    })
    expect(parsed.frontmatter?.sources).toEqual(["rope-paper.md"])
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
    expect(parsed.body).toContain("# Source: rope-paper.md")
    expect(parsed.body).toContain("Analysis summary.")
  })
})

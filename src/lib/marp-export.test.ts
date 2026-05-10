import { describe, expect, it } from "vitest"
import { pageToMarp, splitBodyIntoSlides } from "./marp-export"
import type { WikiPage } from "@/types/wiki"

describe("marp export", () => {
  it("wraps a page in Marp frontmatter and title slide", () => {
    const marp = pageToMarp(page({
      path: "/project/wiki/queries/scaling-law.md",
      content: [
        "---",
        "title: Scaling Law Brief",
        "type: query",
        "confidence: 0.82",
        "sources:",
        "  - paper-a.md",
        "  - paper-b.md",
        "---",
        "",
        "# Scaling Law Brief",
        "",
        "Opening summary.",
      ].join("\n"),
    }))

    expect(marp).toContain("marp: true")
    expect(marp).toContain("theme: default")
    expect(marp).toContain("paginate: true")
    expect(marp).toContain("# Scaling Law Brief")
    expect(marp).toContain("**Type**: query")
    expect(marp).toContain("**Confidence**: 0.82")
    expect(marp).toContain("**Sources**: 2")
    expect(marp).toContain("Opening summary.")
  })

  it("falls back to the file name when frontmatter title is missing", () => {
    expect(pageToMarp(page({ path: "/project/wiki/concepts/rope.md" }))).toContain(
      "# rope",
    )
  })

  it("splits bodies by H2 headings", () => {
    expect(splitBodyIntoSlides("# Title\n\nIntro\n\n## A\nA body\n\n## B\nB body")).toEqual([
      "# Title\n\nIntro",
      "## A\nA body",
      "## B\nB body",
    ])
  })

  it("keeps a body without H2 as a single slide", () => {
    expect(splitBodyIntoSlides("# Only\n\nNo h2 here.")).toEqual([
      "# Only\n\nNo h2 here.",
    ])
  })

  it("handles a single H2 and empty body", () => {
    expect(splitBodyIntoSlides("## Only\nBody")).toEqual(["## Only\nBody"])
    expect(splitBodyIntoSlides("")).toEqual([])
  })

  it("does not mutate markdown body content while exporting", () => {
    const body = [
      "# Query",
      "",
      "| Model | Score |",
      "| --- | --- |",
      "| A | 0.9 |",
    ].join("\n")

    expect(pageToMarp(page({ content: body }))).toContain(body)
  })
})

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    path: "/project/wiki/queries/example.md",
    content: "# Example\n\nBody",
    frontmatter: {},
    ...overrides,
  }
}

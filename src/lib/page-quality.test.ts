import { describe, expect, it } from "vitest"
import { evaluatePageQuality, evaluatePagesQuality } from "./page-quality"

describe("page quality evaluator", () => {
  it("scores a well-structured sourced page above the default threshold", () => {
    const result = evaluatePageQuality({
      path: "wiki/concepts/attention.md",
      content: `---
type: concept
title: Attention
tags: [transformer]
related: [transformer]
sources: [paper.pdf]
aliases: [self attention]
keywords: [attention, transformer]
supports: [transformer]
created: 2026-05-07
updated: 2026-05-07
lifecycle: semantic
confidence: "0.74"
quality_score: "0.50"
review_status: ok
last_confirmed: 2026-05-07
scope: shared
---

# Attention

## Summary

Attention lets a model weigh relevant context tokens while processing a sequence. It is a key mechanism in transformer models and supports [[transformer]] architectures.

- Query, key, and value projections shape the scoring process.
- Multi-head variants let the model attend to several relation patterns.
`,
    })

    expect(result.score).toBeGreaterThanOrEqual(0.7)
    expect(result.dimensions.structure.score).toBeGreaterThan(0.7)
    expect(result.dimensions.citation.score).toBeGreaterThan(0.7)
    expect(result.proposedOperation).toBeUndefined()
  })

  it("flags short unsourced pages for review and proposes a quality_score patch", () => {
    const result = evaluatePageQuality({
      path: "wiki/concepts/stub.md",
      content: `---
type: concept
title: Stub
tags: []
related: []
created: 2026-05-07
updated: 2026-05-07
scope: shared
---

# Stub

Tiny note.
`,
    })

    expect(result.score).toBeLessThan(0.55)
    expect(result.dimensions.citation.reasons).toContain("no explicit sources")
    expect(result.dimensions.relation.reasons).toContain("no wiki relationships")
    expect(result.proposedOperation).toMatchObject({
      kind: "metadata-patch",
      targetPath: "wiki/concepts/stub.md",
      fields: {
        quality_score: expect.any(String),
        review_status: "needs-review",
      },
    })
  })

  it("does not overwrite a higher explicit quality score", () => {
    const result = evaluatePageQuality({
      path: "wiki/concepts/manual-score.md",
      content: `---
type: concept
title: Manual Score
tags: []
related: []
created: 2026-05-07
updated: 2026-05-07
quality_score: "0.90"
scope: shared
---

# Manual Score

Tiny note.
`,
    })

    expect(result.score).toBeLessThan(0.9)
    expect(result.proposedOperation).toBeUndefined()
  })

  it("keeps private scope on proposed operations and does not include body content in reasons", () => {
    const result = evaluatePageQuality({
      path: "wiki/concepts/private.md",
      content: `---
type: concept
title: Private
tags: []
related: []
created: 2026-05-07
updated: 2026-05-07
scope: private
---

# Private

SECRET_TOKEN=abc123
`,
    })

    expect(JSON.stringify(result.reasons)).not.toContain("SECRET_TOKEN")
    expect(result.proposedOperation?.scope).toBe("private")
  })

  it("evaluates a batch with a shared contract", () => {
    const results = evaluatePagesQuality([
      {
        path: "wiki/concepts/a.md",
        content: page("A", "a.md"),
      },
      {
        path: "wiki/concepts/b.md",
        content: page("B", "b.md"),
      },
    ])

    expect(results).toHaveLength(2)
    expect(results.map((result) => result.targetPath)).toEqual([
      "wiki/concepts/a.md",
      "wiki/concepts/b.md",
    ])
  })
})

function page(title: string, source: string): string {
  return `---
type: concept
title: ${title}
tags: [tag]
related: [other]
sources: [${source}]
created: 2026-05-07
updated: 2026-05-07
confidence: "0.60"
review_status: ok
last_confirmed: 2026-05-07
scope: shared
---

# ${title}

## Summary

This page has enough body content to pass basic quality checks and includes a useful [[other]] wikilink.
`
}

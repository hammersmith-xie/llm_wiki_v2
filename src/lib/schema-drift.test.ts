import { describe, expect, it } from "vitest"
import {
  scanSchemaDrift,
  type SchemaDriftFinding,
  type SchemaDriftPageInput,
} from "./schema-drift"

describe("schema drift scanner", () => {
  it("reports pages without parseable frontmatter", () => {
    const report = scanSchemaDrift([
      {
        path: "wiki/concepts/no-frontmatter.md",
        content: "# No Frontmatter\n\nBody",
      },
    ])

    expect(report.stats).toMatchObject({
      pageCount: 1,
      findingCount: 1,
      warningCount: 1,
    })
    expect(report.findings[0]).toMatchObject({
      kind: "missing-frontmatter",
      targetPath: "wiki/concepts/no-frontmatter.md",
      severity: "warning",
    })
  })

  it("reports missing required fields and proposes safe frontmatter patches when values can be inferred", () => {
    const report = scanSchemaDrift([
      {
        path: "wiki/concepts/attention.md",
        content: `---
type: concept
created: 2026-05-07
updated: 2026-05-07
---

# Attention Mechanism
`,
      },
    ])

    const missingTitle = find(report.findings, "missing-required-field", "title")
    const missingTags = find(report.findings, "missing-required-field", "tags")
    const missingRelated = find(report.findings, "missing-required-field", "related")

    expect(missingTitle?.proposedOperation).toMatchObject({
      kind: "metadata-patch",
      targetPath: "wiki/concepts/attention.md",
      fields: { title: "Attention Mechanism" },
    })
    expect(missingTags?.proposedOperation?.fields).toEqual({ tags: [] })
    expect(missingRelated?.proposedOperation?.fields).toEqual({ related: [] })
  })

  it("reports invalid enum, score, integer, and date fields", () => {
    const report = scanSchemaDrift([
      {
        path: "wiki/concepts/bad-metadata.md",
        content: `---
type: concept
title: Bad Metadata
tags: []
related: []
created: 2026-99-99
updated: 2026-05-07
lifecycle: permanent
confidence: "2"
reinforcement_count: "-1"
---

# Bad Metadata
`,
      },
    ])

    expect(find(report.findings, "invalid-date", "created")).toMatchObject({
      expected: "YYYY-MM-DD",
    })
    expect(find(report.findings, "invalid-enum", "lifecycle")).toMatchObject({
      expected: "working | episodic | semantic | procedural | archived",
      actual: "permanent",
    })
    expect(find(report.findings, "invalid-score", "confidence")).toBeTruthy()
    expect(find(report.findings, "invalid-integer", "reinforcement_count")).toBeTruthy()
  })

  it("reports scalar relation arrays and dangling relation targets separately", () => {
    const report = scanSchemaDrift([
      page("wiki/concepts/source-page.md", {
        title: "Source Page",
        aliases: ["Source"],
      }),
      {
        path: "wiki/concepts/relation-page.md",
        content: `---
type: concept
title: Relation Page
tags: []
related: []
created: 2026-05-07
updated: 2026-05-07
uses: source-page
depends_on: [missing-page]
---

# Relation Page
`,
      },
    ])

    expect(find(report.findings, "invalid-field-kind", "uses")).toMatchObject({
      expected: "array",
      actual: "scalar",
      proposedOperation: expect.objectContaining({
        fields: { uses: ["source-page"] },
      }),
    })
    expect(find(report.findings, "dangling-relation", "depends_on")).toMatchObject({
      relationTarget: "missing-page",
      severity: "warning",
    })
  })

  it("reports page type/path mismatches", () => {
    const report = scanSchemaDrift([
      page("wiki/entities/attention.md", {
        type: "concept",
        title: "Attention",
      }),
    ])

    expect(find(report.findings, "page-type-path-mismatch", "type")).toMatchObject({
      expected: "wiki/concepts/",
      actual: "wiki/entities/attention.md",
      severity: "info",
    })
  })

  it("reports likely alias candidates for unresolved typed relations", () => {
    const report = scanSchemaDrift([
      page("wiki/concepts/redis-cache.md", {
        title: "Redis Cache",
        aliases: ["Redis caching"],
      }),
      {
        path: "wiki/concepts/consumer.md",
        content: `---
type: concept
title: Consumer
tags: []
related: []
created: 2026-05-07
updated: 2026-05-07
supports: [redis cach]
---

# Consumer
`,
      },
    ])

    expect(find(report.findings, "relation-alias-candidate", "supports")).toMatchObject({
      relationTarget: "redis cach",
      candidateTarget: "wiki/concepts/redis-cache.md",
      proposedOperation: expect.objectContaining({
        fields: { supports: ["redis-cache"] },
      }),
    })
  })

  it("does not leak private page body content into findings", () => {
    const report = scanSchemaDrift([
      {
        path: "wiki/concepts/private-page.md",
        content: `---
type: concept
title: Private Page
tags: []
related: []
created: bad-date
updated: 2026-05-07
scope: private
uses: redis
---

# Private Page

SECRET_TOKEN=abc123
`,
      },
    ])

    expect(JSON.stringify(report.findings)).not.toContain("SECRET_TOKEN")
    expect(find(report.findings, "invalid-field-kind", "uses")?.proposedOperation?.scope).toBe("private")
  })
})

function page(
  path: string,
  overrides: {
    type?: string
    title?: string
    aliases?: string[]
  } = {},
): SchemaDriftPageInput {
  const type = overrides.type ?? (path.includes("/entities/") ? "entity" : "concept")
  const title = overrides.title ?? "Page"
  const aliases = overrides.aliases
    ? `aliases: [${overrides.aliases.join(", ")}]\n`
    : ""
  return {
    path,
    content: `---
type: ${type}
title: ${title}
tags: []
related: []
created: 2026-05-07
updated: 2026-05-07
${aliases}---

# ${title}
`,
  }
}

function find(
  findings: readonly SchemaDriftFinding[],
  kind: SchemaDriftFinding["kind"],
  field?: string,
): SchemaDriftFinding | undefined {
  return findings.find((finding) =>
    finding.kind === kind && (field === undefined || finding.field === field),
  )
}

import { describe, it, expect, vi } from "vitest"
import {
  extractEntitySummary,
  detectDuplicateGroups,
  parseDetectorResponse,
  mergeDuplicateGroup,
  rewriteCrossReferences,
  rewriteIndexMd,
  type EntitySummary,
} from "./dedup"
import { parseFrontmatterArray } from "./sources-merge"

const PAGE = (fm: string, body: string) => `---\n${fm}\n---\n\n${body}`

// ──────────────────────────────────────────────────────────────────
// Stage 1: extractEntitySummary
// ──────────────────────────────────────────────────────────────────

describe("extractEntitySummary", () => {
  it("returns null for content with no frontmatter", () => {
    expect(extractEntitySummary("wiki/entities/foo.md", "# Just body")).toBeNull()
  })

  it("derives slug from filename", () => {
    const s = extractEntitySummary(
      "wiki/entities/accumulibacter.md",
      PAGE("type: entity\ntitle: Accumulibacter", "body"),
    )
    expect(s?.slug).toBe("accumulibacter")
  })

  it("uses frontmatter description when present", () => {
    const s = extractEntitySummary(
      "wiki/entities/foo.md",
      PAGE(
        'type: entity\ntitle: Foo\ndescription: "A short summary."\ntags: [a, b]',
        "Body text",
      ),
    )
    expect(s?.description).toBe("A short summary.")
    expect(s?.tags).toEqual(["a", "b"])
  })

  it("falls back to first non-heading body paragraph for description", () => {
    const s = extractEntitySummary(
      "wiki/entities/foo.md",
      PAGE("type: entity\ntitle: Foo", "# Foo\n\nFirst real paragraph here."),
    )
    expect(s?.description).toBe("First real paragraph here.")
  })

  it("truncates long descriptions to ~200 chars", () => {
    const long = "x".repeat(400)
    const s = extractEntitySummary(
      "wiki/entities/foo.md",
      PAGE(`type: entity\ntitle: Foo\ndescription: "${long}"`, "body"),
    )
    expect(s?.description?.length).toBeLessThanOrEqual(200)
    expect(s?.description?.endsWith("…")).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────
// Stage 2: parseDetectorResponse
// ──────────────────────────────────────────────────────────────────

describe("parseDetectorResponse", () => {
  it("parses a clean JSON response", () => {
    const raw = JSON.stringify({
      groups: [
        { slugs: ["a", "b"], reason: "same thing", confidence: "high" },
      ],
    })
    expect(parseDetectorResponse(raw)).toEqual([
      { slugs: ["a", "b"], reason: "same thing", confidence: "high" },
    ])
  })

  it("strips ```json code fences if the LLM wrapped its output", () => {
    const raw = '```json\n{"groups": [{"slugs": ["a","b"], "reason": "x", "confidence": "high"}]}\n```'
    const out = parseDetectorResponse(raw)
    expect(out).toHaveLength(1)
    expect(out[0].slugs).toEqual(["a", "b"])
  })

  it("strips conversational preamble before the JSON", () => {
    const raw =
      'Sure, here are the duplicates I found:\n\n{"groups": [{"slugs": ["foo","bar"], "reason": "synonyms", "confidence": "medium"}]}\n\nLet me know if you need anything else.'
    const out = parseDetectorResponse(raw)
    expect(out[0].slugs).toEqual(["foo", "bar"])
    expect(out[0].confidence).toBe("medium")
  })

  it("rejects groups with fewer than 2 slugs", () => {
    const raw = '{"groups": [{"slugs": ["only-one"], "reason": "x", "confidence": "high"}]}'
    expect(parseDetectorResponse(raw)).toEqual([])
  })

  it("defaults invalid confidence values to 'low'", () => {
    const raw = '{"groups": [{"slugs": ["a","b"], "reason": "", "confidence": "extremely-high"}]}'
    expect(parseDetectorResponse(raw)[0].confidence).toBe("low")
  })

  it("returns [] for malformed JSON", () => {
    expect(parseDetectorResponse("not json at all")).toEqual([])
    expect(parseDetectorResponse('{"groups": [unclosed')).toEqual([])
    expect(parseDetectorResponse("")).toEqual([])
  })

  it("returns [] when the JSON object has no groups field", () => {
    expect(parseDetectorResponse('{"other_field": []}')).toEqual([])
  })

  it("survives quoted braces inside reason strings", () => {
    const raw =
      '{"groups": [{"slugs": ["a","b"], "reason": "Same thing { really }", "confidence": "high"}]}'
    const out = parseDetectorResponse(raw)
    expect(out[0].reason).toBe("Same thing { really }")
  })
})

// ──────────────────────────────────────────────────────────────────
// Stage 2: detectDuplicateGroups (full pipeline w/ mock LLM)
// ──────────────────────────────────────────────────────────────────

describe("detectDuplicateGroups", () => {
  const summary = (slug: string, title: string, type = "entity"): EntitySummary => ({
    slug,
    path: `wiki/entities/${slug}.md`,
    type,
    title,
    tags: [],
  })

  it("returns [] when fewer than 2 summaries are passed", async () => {
    const llm = vi.fn()
    expect(await detectDuplicateGroups([summary("foo", "Foo")], llm)).toEqual([])
    expect(llm).not.toHaveBeenCalled()
  })

  it("filters out groups whose slugs aren't in the input list", async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({
        groups: [
          { slugs: ["real-a", "real-b"], reason: "x", confidence: "high" },
          { slugs: ["fake", "real-a"], reason: "x", confidence: "high" },
        ],
      }),
    )
    const result = await detectDuplicateGroups(
      [summary("real-a", "A"), summary("real-b", "B")],
      llm,
    )
    expect(result).toHaveLength(1)
    expect(result[0].slugs).toEqual(["real-a", "real-b"])
  })

  it("filters out groups already on the user's not-duplicates whitelist", async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({
        groups: [
          { slugs: ["foo", "bar"], reason: "x", confidence: "high" },
          { slugs: ["x", "y"], reason: "x", confidence: "high" },
        ],
      }),
    )
    const result = await detectDuplicateGroups(
      [
        summary("foo", "Foo"),
        summary("bar", "Bar"),
        summary("x", "X"),
        summary("y", "Y"),
      ],
      llm,
      { notDuplicates: [["foo", "bar"]] },
    )
    expect(result.map((g) => g.slugs.sort())).toEqual([["x", "y"]])
  })

  it("treats whitelist entries case-insensitively and order-independently", async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({
        groups: [{ slugs: ["foo", "bar"], reason: "", confidence: "high" }],
      }),
    )
    // Whitelist stored with reversed casing/order — should still match.
    const result = await detectDuplicateGroups(
      [summary("foo", "Foo"), summary("bar", "Bar")],
      llm,
      { notDuplicates: [["BAR", "FOO"]] },
    )
    expect(result).toEqual([])
  })

  it("formats the user message with type / slug / title / tags / description", async () => {
    const llm = vi.fn().mockResolvedValue('{"groups":[]}')
    await detectDuplicateGroups(
      [
        {
          slug: "foo",
          path: "wiki/entities/foo.md",
          type: "entity",
          title: "Foo",
          description: "Short desc.",
          tags: ["t1", "t2"],
        },
        summary("bar", "Bar"),
      ],
      llm,
    )
    expect(llm).toHaveBeenCalledOnce()
    const userMsg = llm.mock.calls[0][1]
    expect(userMsg).toContain("type=entity")
    expect(userMsg).toContain("slug=foo")
    expect(userMsg).toContain('"Foo"')
    expect(userMsg).toContain("[t1, t2]")
    expect(userMsg).toContain("Short desc.")
  })
})

// ──────────────────────────────────────────────────────────────────
// Stage 3: rewriteCrossReferences
// ──────────────────────────────────────────────────────────────────

describe("rewriteCrossReferences", () => {
  it("rewrites bare wikilinks", () => {
    const out = rewriteCrossReferences(
      "See [[old-slug]] for context.",
      new Map([["old-slug", "new-slug"]]),
    )
    expect(out).toBe("See [[new-slug]] for context.")
  })

  it("rewrites wikilinks with aliases, preserving the alias", () => {
    const out = rewriteCrossReferences(
      "See [[old-slug|the old display]] here.",
      new Map([["old-slug", "new-slug"]]),
    )
    expect(out).toBe("See [[new-slug|the old display]] here.")
  })

  it("rewrites body wikilinks using normalized title and alias variants", () => {
    const out = rewriteCrossReferences(
      "See [[Web_Search_API]] and [[tavily|Tavily Search]].",
      new Map([
        ["web search api", "search-api"],
        ["tavily", "search-api"],
      ]),
    )

    expect(out).toBe("See [[search-api]] and [[search-api|Tavily Search]].")
  })

  it("does not touch wikilinks pointing at unrelated slugs", () => {
    const input = "Both [[paos]] and [[unrelated]] are mentioned."
    const out = rewriteCrossReferences(input, new Map([["paos", "phosphorus-accumulating-organisms"]]))
    expect(out).toContain("[[phosphorus-accumulating-organisms]]")
    expect(out).toContain("[[unrelated]]")
  })

  it("rewrites the related field (inline form)", () => {
    const input = PAGE(
      "type: entity\ntitle: Foo\nrelated: [old-slug, kept]",
      "body",
    )
    const out = rewriteCrossReferences(input, new Map([["old-slug", "new-slug"]]))
    expect(parseFrontmatterArray(out, "related")).toEqual(["new-slug", "kept"])
  })

  it("rewrites the related field (block form)", () => {
    const input = PAGE(
      "type: entity\ntitle: Foo\nrelated:\n  - old-slug\n  - kept",
      "body",
    )
    const out = rewriteCrossReferences(input, new Map([["old-slug", "new-slug"]]))
    expect(parseFrontmatterArray(out, "related")).toEqual(["new-slug", "kept"])
  })

  it("dedupes related when canonical was already in the list", () => {
    // Page already linked to BOTH the canonical AND the duplicate.
    // After redirect, we'd have ["new-slug", "new-slug"] before dedup.
    const input = PAGE(
      "type: entity\nrelated: [old-slug, new-slug, kept]",
      "body",
    )
    const out = rewriteCrossReferences(input, new Map([["old-slug", "new-slug"]]))
    expect(parseFrontmatterArray(out, "related")).toEqual(["new-slug", "kept"])
  })

  it("rewrites v2 typed relationship arrays when duplicate slugs are merged", () => {
    const input = PAGE(
      [
        "type: concept",
        "title: Foo",
        "related: [old-slug, kept]",
        "uses: [old-slug, tool]",
        "depends_on: [old-slug, prereq]",
        "contradicts: [claim]",
        "supports: [old-slug, claim]",
        "supersedes: [old-slug, older]",
        "superseded_by: [future]",
      ].join("\n"),
      "body",
    )

    const out = rewriteCrossReferences(input, new Map([["old-slug", "new-slug"]]))

    expect(parseFrontmatterArray(out, "related")).toEqual(["new-slug", "kept"])
    expect(parseFrontmatterArray(out, "uses")).toEqual(["new-slug", "tool"])
    expect(parseFrontmatterArray(out, "depends_on")).toEqual(["new-slug", "prereq"])
    expect(parseFrontmatterArray(out, "contradicts")).toEqual(["claim"])
    expect(parseFrontmatterArray(out, "supports")).toEqual(["new-slug", "claim"])
    expect(parseFrontmatterArray(out, "supersedes")).toEqual(["new-slug", "older"])
    expect(parseFrontmatterArray(out, "superseded_by")).toEqual(["future"])
  })

  it("rewrites frontmatter reference arrays using slug-normalized variants", () => {
    const input = PAGE(
      [
        "type: concept",
        "title: Foo",
        "related: [old_slug, new-slug, kept]",
        "uses: [Old Slug, tool]",
        "supports: [old slug, claim]",
      ].join("\n"),
      "body",
    )

    const out = rewriteCrossReferences(input, new Map([["old-slug", "new-slug"]]))

    expect(parseFrontmatterArray(out, "related")).toEqual(["new-slug", "kept"])
    expect(parseFrontmatterArray(out, "uses")).toEqual(["new-slug", "tool"])
    expect(parseFrontmatterArray(out, "supports")).toEqual(["new-slug", "claim"])
  })

  it("returns content unchanged when no redirects apply", () => {
    const input = PAGE("type: entity\nrelated: [a, b]", "[[c]] and [[d]] here.")
    const out = rewriteCrossReferences(input, new Map([["nonexistent", "other"]]))
    expect(out).toBe(input)
  })

  it("rewrites multiple slugs in one pass", () => {
    const input = "[[old-a]] and [[old-b]] and [[keep-me]]."
    const out = rewriteCrossReferences(
      input,
      new Map([
        ["old-a", "canonical"],
        ["old-b", "canonical"],
      ]),
    )
    expect(out).toBe("[[canonical]] and [[canonical]] and [[keep-me]].")
  })
})

// ──────────────────────────────────────────────────────────────────
// Stage 3: rewriteIndexMd
// ──────────────────────────────────────────────────────────────────

describe("rewriteIndexMd", () => {
  it("removes lines linking to merged-away slugs (markdown link form)", () => {
    const input = [
      "## Entities",
      "- [Accumulibacter](entities/accumulibacter.md)",
      "- [DPAOs (deprecated)](entities/dpaos.md)",
      "- [DPAO](entities/dpao.md)",
    ].join("\n")
    const out = rewriteIndexMd(input, new Set(["dpaos"]))
    expect(out).not.toContain("dpaos")
    expect(out).toContain("accumulibacter")
    expect(out).toContain("[DPAO](entities/dpao.md)")
  })

  it("removes lines with wikilinks to merged-away slugs", () => {
    const input = [
      "## Concepts",
      "- [[vfa]] — Volatile fatty acids",
      "- [[volatile-fatty-acids]] — VFAs (long form)",
      "- [[pha]] — PHA storage polymer",
    ].join("\n")
    const out = rewriteIndexMd(input, new Set(["volatile-fatty-acids"]))
    expect(out).not.toContain("volatile-fatty-acids")
    expect(out).toContain("[[vfa]]")
    expect(out).toContain("[[pha]]")
  })

  it("preserves headings and prose between lists", () => {
    const input = [
      "# Wiki Index",
      "",
      "Generated overview.",
      "",
      "## Entities",
      "- [DPAOs](entities/dpaos.md)",
      "- [DPAO](entities/dpao.md)",
      "",
      "## Concepts",
      "Some intro prose here, no slugs.",
    ].join("\n")
    const out = rewriteIndexMd(input, new Set(["dpaos"]))
    expect(out).toContain("# Wiki Index")
    expect(out).toContain("Generated overview.")
    expect(out).toContain("## Entities")
    expect(out).toContain("[DPAO](entities/dpao.md)")
    expect(out).toContain("## Concepts")
    expect(out).toContain("Some intro prose here")
    expect(out).not.toContain("dpaos.md")
  })

  it("is a no-op when removedSlugs is empty", () => {
    const input = "- [Foo](entities/foo.md)\n- [Bar](entities/bar.md)"
    expect(rewriteIndexMd(input, new Set())).toBe(input)
  })
})

// ──────────────────────────────────────────────────────────────────
// Stage 3: mergeDuplicateGroup (full integration with mock LLM)
// ──────────────────────────────────────────────────────────────────

describe("mergeDuplicateGroup", () => {
  const FIXED_TODAY = () => "2026-04-30"

  it("throws when canonicalSlug isn't in the group", async () => {
    await expect(
      mergeDuplicateGroup(
        {
          group: [
            { slug: "a", path: "wiki/entities/a.md", content: PAGE("type: entity", "ax") },
            { slug: "b", path: "wiki/entities/b.md", content: PAGE("type: entity", "bx") },
          ],
          canonicalSlug: "z",
          otherWikiPages: [],
        },
        vi.fn(),
      ),
    ).rejects.toThrow(/canonicalSlug/)
  })

  it("throws when group has fewer than 2 pages", async () => {
    await expect(
      mergeDuplicateGroup(
        {
          group: [{ slug: "a", path: "wiki/entities/a.md", content: PAGE("type: entity", "x") }],
          canonicalSlug: "a",
          otherWikiPages: [],
        },
        vi.fn(),
      ),
    ).rejects.toThrow(/at least 2/)
  })

  it("merges bodies via LLM, unions sources/tags/related, stamps updated", async () => {
    const pageA = PAGE(
      'type: entity\ntitle: Accumulibacter\ncreated: 2026-04-09\nupdated: 2026-04-09\ntags: [microbiology, ebpr]\nrelated: [dpao, vfa]\nsources: ["doc-A.pdf"]',
      "## Anaerobic Phase\n\nDescription from page A.",
    )
    const pageB = PAGE(
      'type: entity\ntitle: 聚磷菌\ncreated: 2026-04-15\nupdated: 2026-04-15\ntags: [paos, propionate]\nrelated: [pha]\nsources: ["doc-B.pdf"]',
      "## 厌氧阶段\n\n来自页面 B 的描述。",
    )
    const llmMerged = PAGE(
      'type: entity\ntitle: Accumulibacter\ncreated: 2026-04-09\nupdated: 2026-04-09\ntags: [microbiology, ebpr]\nrelated: [dpao, vfa]\nsources: ["doc-A.pdf"]',
      "## Anaerobic Phase\n\nDescription from page A.\n\n## 厌氧阶段\n\n来自页面 B 的描述。",
    )
    const llm = vi.fn().mockResolvedValue(llmMerged)

    const result = await mergeDuplicateGroup(
      {
        group: [
          { slug: "accumulibacter", path: "wiki/entities/accumulibacter.md", content: pageA },
          { slug: "聚磷菌", path: "wiki/entities/聚磷菌.md", content: pageB },
        ],
        canonicalSlug: "accumulibacter",
        otherWikiPages: [],
      },
      llm,
      { today: FIXED_TODAY },
    )

    // Canonical body has both versions' content
    expect(result.canonicalContent).toContain("Anaerobic Phase")
    expect(result.canonicalContent).toContain("厌氧阶段")

    // Frontmatter unioned (set semantics — order not part of contract)
    expect(parseFrontmatterArray(result.canonicalContent, "sources").sort()).toEqual(
      ["doc-A.pdf", "doc-B.pdf"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "tags").sort()).toEqual(
      ["ebpr", "microbiology", "paos", "propionate"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "related").sort()).toEqual(
      ["dpao", "pha", "vfa"].sort(),
    )

    // Updated stamped to today
    expect(result.canonicalContent).toContain("updated: 2026-04-30")

    // Canonical path correct
    expect(result.canonicalPath).toBe("wiki/entities/accumulibacter.md")

    // The other group member's path is in pagesToDelete
    expect(result.pagesToDelete).toEqual(["wiki/entities/聚磷菌.md"])

    // Backup includes both pre-merge contents
    expect(result.backup).toEqual([
      { path: "wiki/entities/accumulibacter.md", content: pageA },
      { path: "wiki/entities/聚磷菌.md", content: pageB },
    ])
  })

  it("unions v2 graph relationship and seed arrays during duplicate merges", async () => {
    const pageA = PAGE(
      [
        "type: concept",
        "title: Deep Research",
        "created: 2026-04-09",
        "alias: [deep-searcher]",
        "aliases: [deep-search]",
        "keywords: [research-agent]",
        "related: [llm-wiki]",
        "uses: [serp-api]",
        "depends_on: [embedding]",
        "contradicts: [old-rag]",
        "supports: [wiki-memory]",
        "supersedes: [deep-research-v1]",
        "superseded_by: [deep-research-v3]",
      ].join("\n"),
      "body a",
    )
    const pageB = PAGE(
      [
        "type: concept",
        "title: Deep Research",
        "created: 2026-04-12",
        "alias: [query-rewriter]",
        "aliases: [query-rewriting]",
        "keywords: [retrieval]",
        "related: [agent-search]",
        "uses: [tavily]",
        "depends_on: [vector-store]",
        "contradicts: [static-index]",
        "supports: [query-memory]",
        "supersedes: [deep-research-v2]",
        "superseded_by: [deep-research-v4]",
      ].join("\n"),
      "body b",
    )
    const llmMerged = PAGE(
      [
        "type: concept",
        "title: Deep Research",
        "created: 2026-04-09",
        "related: [llm-wiki]",
      ].join("\n"),
      "merged body",
    )
    const llm = vi.fn().mockResolvedValue(llmMerged)

    const result = await mergeDuplicateGroup(
      {
        group: [
          { slug: "deep-research", path: "wiki/concepts/deep-research.md", content: pageA },
          { slug: "query-rewriting", path: "wiki/concepts/query-rewriting.md", content: pageB },
        ],
        canonicalSlug: "deep-research",
        otherWikiPages: [],
      },
      llm,
      { today: FIXED_TODAY },
    )

    expect(parseFrontmatterArray(result.canonicalContent, "alias").sort()).toEqual(
      ["deep-searcher", "query-rewriter"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "aliases").sort()).toEqual(
      ["deep-search", "query-rewriting"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "keywords").sort()).toEqual(
      ["research-agent", "retrieval"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "related").sort()).toEqual(
      ["agent-search", "llm-wiki"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "uses").sort()).toEqual(
      ["serp-api", "tavily"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "depends_on").sort()).toEqual(
      ["embedding", "vector-store"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "contradicts").sort()).toEqual(
      ["old-rag", "static-index"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "supports").sort()).toEqual(
      ["query-memory", "wiki-memory"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "supersedes").sort()).toEqual(
      ["deep-research-v1", "deep-research-v2"].sort(),
    )
    expect(parseFrontmatterArray(result.canonicalContent, "superseded_by").sort()).toEqual(
      ["deep-research-v3", "deep-research-v4"].sort(),
    )
  })

  it("rewrites cross-references in other wiki pages", async () => {
    const pageA = PAGE("type: entity\ntitle: A\nrelated: [bar]", "body a")
    const pageB = PAGE("type: entity\ntitle: B\nrelated: [bar]", "body b")
    const referencingPage = PAGE(
      "type: concept\ntitle: Other\nrelated: [a, b, kept]",
      "See [[a]] and [[b|the b]] and [[unrelated]].",
    )
    const llm = vi.fn().mockResolvedValue(PAGE("type: entity\ntitle: A\n", "merged body"))

    const result = await mergeDuplicateGroup(
      {
        group: [
          { slug: "a", path: "wiki/entities/a.md", content: pageA },
          { slug: "b", path: "wiki/entities/b.md", content: pageB },
        ],
        canonicalSlug: "a",
        otherWikiPages: [
          { path: "wiki/concepts/other.md", content: referencingPage },
        ],
      },
      llm,
      { today: FIXED_TODAY },
    )

    expect(result.rewrites).toHaveLength(1)
    const rewritten = result.rewrites[0].newContent
    // wikilinks rewritten
    expect(rewritten).toContain("[[a]]")
    expect(rewritten).toContain("[[a|the b]]")
    expect(rewritten).toContain("[[unrelated]]")
    expect(rewritten).not.toMatch(/\[\[b(\|[^\]]*)?\]\]/)
    // related field rewritten + deduped
    expect(parseFrontmatterArray(rewritten, "related")).toEqual(["a", "kept"])
  })

  it("rewrites title and alias refs for merged-away pages to the canonical slug", async () => {
    const canonicalPage = PAGE("type: concept\ntitle: Search API", "body a")
    const mergedAwayPage = PAGE(
      [
        "type: concept",
        "title: Tavily API",
        "alias: [tavily]",
        "aliases: [web search api]",
      ].join("\n"),
      "body b",
    )
    const referencingPage = PAGE(
      [
        "type: concept",
        "title: Agent Search",
        "related: [Tavily API, kept]",
        "uses: [tavily, runtime]",
        "supports: [web_search_api, claim]",
      ].join("\n"),
      "See [[Tavily API]] and [[tavily|Tavily]].",
    )
    const llm = vi.fn().mockResolvedValue(PAGE("type: concept\ntitle: Search API\n", "merged body"))

    const result = await mergeDuplicateGroup(
      {
        group: [
          { slug: "search-api", path: "wiki/concepts/search-api.md", content: canonicalPage },
          { slug: "tavily-api", path: "wiki/concepts/tavily-api.md", content: mergedAwayPage },
        ],
        canonicalSlug: "search-api",
        otherWikiPages: [
          { path: "wiki/concepts/agent-search.md", content: referencingPage },
        ],
      },
      llm,
      { today: FIXED_TODAY },
    )

    expect(result.rewrites).toHaveLength(1)
    const rewritten = result.rewrites[0].newContent
    expect(rewritten).toContain("[[search-api]]")
    expect(rewritten).toContain("[[search-api|Tavily]]")
    expect(parseFrontmatterArray(rewritten, "related")).toEqual(["search-api", "kept"])
    expect(parseFrontmatterArray(rewritten, "uses")).toEqual(["search-api", "runtime"])
    expect(parseFrontmatterArray(rewritten, "supports")).toEqual(["search-api", "claim"])
  })

  it("doesn't include unchanged pages in rewrites", async () => {
    const llm = vi.fn().mockResolvedValue(PAGE("type: entity\ntitle: A\n", "merged"))
    const irrelevant = PAGE(
      "type: concept\nrelated: [unrelated-slug]",
      "[[totally-different]] page.",
    )

    const result = await mergeDuplicateGroup(
      {
        group: [
          { slug: "a", path: "wiki/entities/a.md", content: PAGE("type: entity", "x") },
          { slug: "b", path: "wiki/entities/b.md", content: PAGE("type: entity", "y") },
        ],
        canonicalSlug: "a",
        otherWikiPages: [{ path: "wiki/concepts/irrelevant.md", content: irrelevant }],
      },
      llm,
      { today: FIXED_TODAY },
    )
    expect(result.rewrites).toEqual([])
    // Backup also doesn't include unchanged pages
    expect(result.backup.map((b) => b.path)).not.toContain("wiki/concepts/irrelevant.md")
  })

  it("backup snapshots the pre-merge state of every touched file", async () => {
    const pageA = PAGE("type: entity\ntitle: A", "body a")
    const pageB = PAGE("type: entity\ntitle: B", "body b")
    const refOrig = PAGE("type: concept\nrelated: [b]", "[[b]]")
    const llm = vi.fn().mockResolvedValue(PAGE("type: entity\ntitle: A", "merged"))

    const result = await mergeDuplicateGroup(
      {
        group: [
          { slug: "a", path: "wiki/entities/a.md", content: pageA },
          { slug: "b", path: "wiki/entities/b.md", content: pageB },
        ],
        canonicalSlug: "a",
        otherWikiPages: [{ path: "wiki/concepts/ref.md", content: refOrig }],
      },
      llm,
      { today: FIXED_TODAY },
    )

    // Backup has all 3 pre-merge files; rewrites only has the changed cross-ref
    const backupPaths = result.backup.map((b) => b.path).sort()
    expect(backupPaths).toEqual([
      "wiki/concepts/ref.md",
      "wiki/entities/a.md",
      "wiki/entities/b.md",
    ])
    // The backup content is the ORIGINAL, not the post-merge version
    const refBackup = result.backup.find((b) => b.path === "wiki/concepts/ref.md")
    expect(refBackup?.content).toBe(refOrig)
  })
})

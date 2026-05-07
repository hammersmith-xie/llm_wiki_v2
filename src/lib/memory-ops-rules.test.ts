import { describe, expect, it } from "vitest"
import { extractTypedGraphFromPages } from "@/lib/typed-graph"
import type { MemoryOpsProjectSnapshot, MemoryOpsWikiPage } from "./memory-ops"
import {
  evaluateLifecycleSuggestions,
  evaluateRelationCleanupSuggestions,
} from "./memory-ops-rules"

describe("memory ops lifecycle rules", () => {
  it("suggests stale metadata for old low-confidence pages without rewriting content", () => {
    const page = wikiPage("old-claim", [
      "---",
      "type: concept",
      "title: Old Claim",
      "sources: [paper.md]",
      "last_confirmed: 2025-01-01",
      "reinforcement_count: 0",
      "---",
      "",
      "# Old Claim",
    ].join("\n"))

    const suggestions = evaluateLifecycleSuggestions(snapshot([page]), {
      today: "2026-05-07",
    })

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "metadata-update",
        targetPath: "/project/wiki/concepts/old-claim.md",
        severity: "info",
        proposedOperation: expect.objectContaining({
          kind: "metadata-patch",
          targetPath: "/project/wiki/concepts/old-claim.md",
          fields: expect.objectContaining({
            review_status: "stale",
          }),
        }),
      }),
    ])
    expect(suggestions[0].reasons.join(" ")).toContain("last confirmed")
    expect(page.content).not.toContain("review_status") // proves the rule did not mutate content.
  })

  it("suggests reinforcement count updates from matching audit usage", () => {
    const page = wikiPage("attention", [
      "---",
      "type: concept",
      "title: Attention",
      "sources: [paper.md]",
      "last_confirmed: 2026-05-01",
      "reinforcement_count: 0",
      "---",
      "",
      "# Attention",
    ].join("\n"))

    const suggestions = evaluateLifecycleSuggestions(
      snapshot([page], {
        auditEvents: [
          {
            timestamp: "2026-05-07T00:00:00.000Z",
            action: "crystallize.query",
            targetPath: "/project/wiki/concepts/attention.md",
          },
          {
            timestamp: "2026-05-07T00:01:00.000Z",
            action: "chat.answer",
            pagePath: "wiki/concepts/attention.md",
          },
        ],
      }),
      { today: "2026-05-07" },
    )

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "metadata-update",
        title: "Update reinforcement count",
        proposedOperation: expect.objectContaining({
          fields: expect.objectContaining({ reinforcement_count: "2" }),
        }),
      }),
    ])
    expect(suggestions[0].reasons.join(" ")).toContain("2 reinforcing audit events")
  })

  it("counts retrieval result references as reinforcement signals", () => {
    const page = wikiPage("attention", [
      "---",
      "type: concept",
      "title: Attention",
      "sources: [paper.md]",
      "last_confirmed: 2026-05-01",
      "reinforcement_count: 0",
      "---",
      "",
      "# Attention",
    ].join("\n"))

    const suggestions = evaluateLifecycleSuggestions(
      snapshot([page], {
        auditEvents: [
          {
            timestamp: "2026-05-07T00:00:00.000Z",
            action: "query.answer",
            retrieval: {
              results: [{ path: "wiki/concepts/attention.md", rank: 1 }],
            },
          },
        ],
      }),
      { today: "2026-05-07" },
    )

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "metadata-update",
        title: "Update reinforcement count",
        reasons: expect.arrayContaining(["1 reinforcing audit event references this page"]),
        proposedOperation: expect.objectContaining({
          fields: expect.objectContaining({ reinforcement_count: "1" }),
        }),
      }),
    ])
  })

  it("marks low-confidence pages for review with confidence evidence", () => {
    const page = wikiPage("unsupported-claim", [
      "---",
      "type: concept",
      "title: Unsupported Claim",
      "last_confirmed: 2026-05-07",
      "---",
      "",
      "# Unsupported Claim",
    ].join("\n"))

    const suggestions = evaluateLifecycleSuggestions(snapshot([page]), {
      today: "2026-05-07",
    })

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "metadata-update",
        severity: "warning",
        title: "Mark low-confidence page for review",
        reasons: expect.arrayContaining(["confidence 0.43 is below 0.45"]),
        proposedOperation: expect.objectContaining({
          fields: expect.objectContaining({
            review_status: "needs-review",
            confidence: "0.43",
            confidence_reasons: expect.arrayContaining(["no explicit source"]),
          }),
        }),
      }),
    ])
    expect(suggestions[0].proposedOperation).toBeDefined()
    expect(page.content).not.toContain("review_status")
  })

  it("refreshes last_confirmed when recent reinforcement has no contradiction risk", () => {
    const page = wikiPage("attention", [
      "---",
      "type: concept",
      "title: Attention",
      "sources: [paper.md]",
      "last_confirmed: 2026-05-01",
      "reinforcement_count: 4",
      "---",
      "",
      "# Attention",
    ].join("\n"))
    page.evidence = evidence({
      pagePath: "wiki/concepts/attention.md",
      reinforcement: {
        frontmatterCount: 4,
        auditEventCount: 4,
        totalCount: 4,
        lastReinforcedAt: "2026-05-07T12:00:00.000Z",
      },
      sourceSupport: { sourceCount: 1, supportingRelationCount: 0 },
    })

    const suggestions = evaluateLifecycleSuggestions(snapshot([page]), {
      today: "2026-05-07",
    })

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "metadata-update",
        title: "Refresh last confirmed date",
        reasons: expect.arrayContaining(["latest reinforcement landed on 2026-05-07"]),
        proposedOperation: expect.objectContaining({
          fields: expect.objectContaining({ last_confirmed: "2026-05-07" }),
        }),
      }),
    ])
  })

  it("suggests promoting reinforced episodic pages to semantic memory", () => {
    const page = wikiPage("research-answer", [
      "---",
      "type: query",
      "title: Research Answer",
      "lifecycle: episodic",
      "sources: [a.md, b.md]",
      "last_confirmed: 2026-05-01",
      "reinforcement_count: 3",
      "---",
      "",
      "# Research Answer",
    ].join("\n"))

    const suggestions = evaluateLifecycleSuggestions(snapshot([page]), {
      today: "2026-05-07",
    })

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "metadata-update",
        title: "Promote to semantic memory",
        proposedOperation: expect.objectContaining({
          fields: expect.objectContaining({ lifecycle: "semantic" }),
        }),
      }),
    ])
    expect(suggestions[0].reasons.join(" ")).toContain("reinforcement")
  })

  it("suggests archiving stale unsupported pages instead of rewriting content", () => {
    const page = wikiPage("stale-note", [
      "---",
      "type: note",
      "title: Stale Note",
      "lifecycle: semantic",
      "last_confirmed: 2024-01-01",
      "---",
      "",
      "# Stale Note",
    ].join("\n"))
    page.evidence = evidence({
      pagePath: "wiki/concepts/stale-note.md",
      staleness: {
        lastConfirmed: "2024-01-01",
        ageDays: 857,
        stale: true,
      },
      risk: {
        contradictionCount: 0,
        supersededByCount: 0,
        openReviewItemCount: 0,
        flags: ["stale"],
      },
    })

    const suggestions = evaluateLifecycleSuggestions(snapshot([page]), {
      today: "2026-05-07",
    })

    expect(suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "metadata-update",
        severity: "warning",
        title: "Archive stale unsupported page",
        reasons: expect.arrayContaining([
          "stale page has no source support",
          "no reinforcement signals",
        ]),
        proposedOperation: expect.objectContaining({
          fields: expect.objectContaining({
            lifecycle: "archived",
            review_status: "stale",
          }),
        }),
      }),
    ]))
    for (const suggestion of suggestions) {
      expect(suggestion.reasons.length).toBeGreaterThan(0)
      expect(suggestion.proposedOperation).toBeDefined()
    }
    expect(page.content).not.toContain("lifecycle: archived")
  })
})

describe("memory ops relation cleanup rules", () => {
  it("suggests cleanup for unresolved typed relation targets with candidate pages", () => {
    const source = wikiPage("deep-research", [
      "---",
      "type: concept",
      "title: Deep Research",
      "uses: [tavily]",
      "---",
      "",
      "# Deep Research",
    ].join("\n"))
    const candidate = wikiPage("tavily-api", [
      "---",
      "type: entity",
      "title: Tavily API",
      "---",
      "",
      "# Tavily API",
    ].join("\n"))

    const suggestions = evaluateRelationCleanupSuggestions(snapshot([source, candidate]))

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "relation-cleanup",
        severity: "info",
        targetPath: "/project/wiki/concepts/deep-research.md",
        relation: expect.objectContaining({
          field: "uses",
          target: "tavily",
          candidateTarget: "tavily-api",
        }),
      }),
    ])
    expect(suggestions[0].detail).toContain("uses")
    expect(suggestions[0].detail).toContain("tavily-api")
  })

  it("reports dangling supersession fields as warnings", () => {
    const old = wikiPage("old-claim", [
      "---",
      "type: concept",
      "title: Old Claim",
      "superseded_by: [new-claim]",
      "---",
      "",
      "# Old Claim",
    ].join("\n"))

    const suggestions = evaluateRelationCleanupSuggestions(snapshot([old]))

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "relation-cleanup",
        severity: "warning",
        title: "Review dangling supersession",
        relation: expect.objectContaining({
          field: "superseded_by",
          target: "new-claim",
        }),
      }),
    ])
  })

  it("suggests reciprocal metadata for single-sided supersession links", () => {
    const newer = wikiPage("new-claim", [
      "---",
      "type: concept",
      "title: New Claim",
      "sources: [paper-a.md, paper-b.md]",
      "confidence: \"0.90\"",
      "last_confirmed: 2026-05-01",
      "supersedes: [old-claim]",
      "---",
      "",
      "# New Claim",
    ].join("\n"))
    const older = wikiPage("old-claim", [
      "---",
      "type: concept",
      "title: Old Claim",
      "sources: [paper-old.md]",
      "confidence: \"0.40\"",
      "last_confirmed: 2025-01-01",
      "---",
      "",
      "# Old Claim",
    ].join("\n"))

    const suggestions = evaluateRelationCleanupSuggestions(snapshot([newer, older]))

    expect(suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "metadata-update",
        severity: "info",
        targetPath: "/project/wiki/concepts/old-claim.md",
        title: "Add reciprocal supersession link",
        detail: expect.stringContaining("2 sources"),
        relation: expect.objectContaining({
          field: "superseded_by",
          target: "new-claim",
        }),
        proposedOperation: expect.objectContaining({
          fields: expect.objectContaining({
            superseded_by: ["new-claim"],
          }),
        }),
      }),
    ]))
    const reciprocal = suggestions.find((item) => item.title === "Add reciprocal supersession link")
    expect(reciprocal?.detail).toContain("confidence 0.90")
    expect(reciprocal?.detail).toContain("last_confirmed 2026-05-01")
  })

  it("creates review-only contradiction suggestions with evidence context", () => {
    const source = wikiPage("current-claim", [
      "---",
      "type: concept",
      "title: Current Claim",
      "sources: [paper-a.md, paper-b.md]",
      "confidence: \"0.88\"",
      "last_confirmed: 2026-05-01",
      "contradicts: [legacy-claim]",
      "---",
      "",
      "# Current Claim",
    ].join("\n"))
    const target = wikiPage("legacy-claim", [
      "---",
      "type: concept",
      "title: Legacy Claim",
      "sources: [paper-old.md]",
      "confidence: \"0.41\"",
      "last_confirmed: 2024-01-01",
      "---",
      "",
      "# Legacy Claim",
    ].join("\n"))

    const suggestions = evaluateRelationCleanupSuggestions(snapshot([source, target]))

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "review-action",
        severity: "warning",
        targetPath: "/project/wiki/concepts/current-claim.md",
        title: "Review contradiction pair",
        relation: expect.objectContaining({
          field: "contradicts",
          target: "legacy-claim",
        }),
      }),
    ])
    expect(suggestions[0].detail).toContain("2 sources")
    expect(suggestions[0].detail).toContain("confidence 0.88")
    expect(suggestions[0].detail).toContain("last_confirmed 2026-05-01")
    expect(suggestions[0].detail).toContain("1 source")
    expect(suggestions[0].reasons.join(" ")).toContain("human review")
    expect(suggestions[0].proposedOperation).toBeUndefined()
  })

  it("does not duplicate structural lint for ordinary body wikilinks", () => {
    const page = wikiPage("attention", [
      "---",
      "type: concept",
      "title: Attention",
      "---",
      "",
      "# Attention",
      "",
      "See [[missing-page]].",
    ].join("\n"))

    expect(evaluateRelationCleanupSuggestions(snapshot([page]))).toEqual([])
  })
})

function wikiPage(id: string, content: string): MemoryOpsWikiPage {
  return {
    id,
    fileName: `${id}.md`,
    path: `/project/wiki/concepts/${id}.md`,
    content,
    frontmatter: null,
  }
}

function evidence(
  overrides: Partial<NonNullable<MemoryOpsWikiPage["evidence"]>>,
): NonNullable<MemoryOpsWikiPage["evidence"]> {
  return {
    pagePath: overrides.pagePath ?? "wiki/concepts/page.md",
    recentUse: overrides.recentUse ?? { eventCount: 0 },
    reinforcement: overrides.reinforcement ?? {
      frontmatterCount: 0,
      auditEventCount: 0,
      totalCount: 0,
    },
    sourceSupport: overrides.sourceSupport ?? {
      sourceCount: 0,
      supportingRelationCount: 0,
    },
    staleness: overrides.staleness ?? { stale: false },
    risk: overrides.risk ?? {
      contradictionCount: 0,
      supersededByCount: 0,
      openReviewItemCount: 0,
      flags: [],
    },
  }
}

function snapshot(
  pages: MemoryOpsWikiPage[],
  options: {
    auditEvents?: MemoryOpsProjectSnapshot["audit"]["events"]
  } = {},
): MemoryOpsProjectSnapshot {
  return {
    projectPath: "/project",
    dataVersion: 0,
    pages,
    graph: extractTypedGraphFromPages(
      pages.map((page) => ({
        id: page.id,
        fileName: page.fileName,
        path: page.path,
        content: page.content,
      })),
    ),
    audit: { events: options.auditEvents ?? [], warnings: [] },
    reviewItems: [],
    conversations: [],
    chatMessages: [],
    stats: {
      pageCount: pages.length,
      reviewItemCount: 0,
      conversationCount: 0,
      chatMessageCount: 0,
      auditEventCount: options.auditEvents?.length ?? 0,
      auditWarningCount: 0,
      pageEvidenceCount: pages.length,
      pagesWithRecentUseCount: 0,
      pagesWithReinforcementCount: 0,
      pagesWithSourceSupportCount: 0,
      stalePageCount: 0,
      riskPageCount: 0,
    },
  }
}

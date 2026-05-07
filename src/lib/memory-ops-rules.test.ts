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
    },
  }
}

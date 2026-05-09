import { describe, expect, it } from "vitest"
import { extractTypedGraphFromPages } from "@/lib/typed-graph"
import type { MemoryOpsProjectSnapshot, MemoryOpsWikiPage } from "./memory-ops"
import {
  evaluateClaimSuggestions,
  evaluateLifecycleSuggestions,
  evaluateRelationCleanupSuggestions,
} from "./memory-ops-rules"
import { DEFAULT_MEMORY_OPS_POLICY } from "./memory-ops-policy"
import { normalizeClaimRecord, type ClaimRecord } from "./claims"

describe("memory ops lifecycle rules", () => {
  it("creates claim-level review suggestions without demoting the whole page", () => {
    const stale = normalizeClaimRecord({
      text: "Use the old retrieval stack.",
      page_path: "/project/wiki/concepts/search.md",
      status: "stale",
      source_refs: [{
        path: "raw/sources/search.md",
        snippet_hash: "snippet_stale",
      }],
      last_confirmed: "2025-01-01",
    }, { today: "2026-05-08" }).claim
    const contradicted = normalizeClaimRecord({
      text: "BM25 always beats vectors.",
      page_path: "/project/wiki/concepts/search.md",
      status: "contradicted",
      contradicts: ["claim_vector"],
      source_refs: [{
        path: "raw/sources/search.md",
        snippet_hash: "snippet_contradicted",
      }],
    }, { today: "2026-05-08" }).claim

    const suggestions = evaluateClaimSuggestions(snapshot([], {
      claims: [stale, contradicted],
    }), { today: "2026-05-08" })

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "review-action",
        severity: "info",
        title: "Review stale claim",
        targetPath: "/project/wiki/concepts/search.md",
      }),
      expect.objectContaining({
        kind: "review-action",
        severity: "warning",
        title: "Review contradicted claim",
        targetPath: "/project/wiki/concepts/search.md",
      }),
    ])
    expect(suggestions[0].proposedOperation).toBeUndefined()
    expect(suggestions[1].proposedOperation).toBeUndefined()
    expect(suggestions[0].reasons.join(" ")).toContain("does not demote the whole page")
  })

  it("creates review-only suggestions for claims with missing provenance", () => {
    const missingSource = normalizeClaimRecord({
      text: "Claim with no source refs.",
      page_path: "/project/wiki/concepts/search.md",
      status: "ok",
    }, { today: "2026-05-08" }).claim
    const pathOnly = normalizeClaimRecord({
      text: "Claim with path-only source refs.",
      page_path: "/project/wiki/concepts/search.md",
      status: "ok",
      source_refs: [{ path: "raw/sources/search.md" }],
    }, { today: "2026-05-08" }).claim

    const suggestions = evaluateClaimSuggestions(snapshot([], {
      claims: [missingSource, pathOnly],
    }), { today: "2026-05-08" })

    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "review-action",
        severity: "warning",
        title: "Review claim with no source refs",
      }),
      expect.objectContaining({
        kind: "review-action",
        severity: "info",
        title: "Review claim without snippet evidence",
      }),
    ])
    expect(suggestions[0].proposedOperation).toBeUndefined()
    expect(suggestions[1].proposedOperation).toBeUndefined()
  })

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

  it("uses custom lifecycle policy thresholds for stale and promotion suggestions", () => {
    const stalePage = wikiPage("young-semantic", [
      "---",
      "type: concept",
      "title: Young Semantic",
      "lifecycle: semantic",
      "last_confirmed: 2026-03-01",
      "---",
      "",
      "# Young Semantic",
    ].join("\n"))
    stalePage.evidence = evidence({
      staleness: {
        lastConfirmed: "2026-03-01",
        ageDays: 67,
        stale: true,
      },
      risk: {
        contradictionCount: 0,
        supersededByCount: 0,
        openReviewItemCount: 0,
        flags: ["stale"],
      },
    })
    const episodic = wikiPage("single-source-answer", [
      "---",
      "type: query",
      "title: Single Source Answer",
      "lifecycle: episodic",
      "sources: [a.md]",
      "reinforcement_count: 1",
      "last_confirmed: 2026-05-01",
      "---",
      "",
      "# Single Source Answer",
    ].join("\n"))

    const suggestions = evaluateLifecycleSuggestions(
      snapshot([stalePage, episodic]),
      {
        today: "2026-05-07",
        policy: {
          ...DEFAULT_MEMORY_OPS_POLICY,
          name: "fast-moving",
          halfLives: {
            ...DEFAULT_MEMORY_OPS_POLICY.halfLives,
            semantic: 30,
          },
          promotion: {
            minSources: 1,
            minReinforcement: 1,
          },
        },
      },
    )

    expect(suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetPath: "/project/wiki/concepts/young-semantic.md",
        title: "Archive stale unsupported page",
      }),
      expect.objectContaining({
        targetPath: "/project/wiki/concepts/single-source-answer.md",
        title: "Promote to semantic memory",
      }),
    ]))
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
    claims?: ClaimRecord[]
  } = {},
): MemoryOpsProjectSnapshot {
  const claims = options.claims ?? []
  return {
    projectPath: "/project",
    dataVersion: 0,
    policy: DEFAULT_MEMORY_OPS_POLICY,
    policyWarnings: [],
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
    schemaQualitySummary: null,
    reviewItems: [],
    conversations: [],
    chatMessages: [],
    claims,
    claimHealth: {
      claimCount: claims.length,
      staleCount: claims.filter((claim) => claim.status === "stale").length,
      contradictedCount: claims.filter((claim) => claim.status === "contradicted").length,
      supersededCount: claims.filter((claim) => claim.status === "superseded").length,
      orphanCount: 0,
      reinforcedCount: claims.filter((claim) => Number(claim.reinforcement_count) > 0).length,
      missingSourceRefCount: claims.filter((claim) => claim.source_refs.length === 0).length,
      missingSnippetHashCount: claims.filter((claim) =>
        claim.source_refs.length > 0 &&
        claim.source_refs.every((ref) => !ref.snippet_hash)
      ).length,
    },
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
      claimCount: claims.length,
      staleClaimCount: claims.filter((claim) => claim.status === "stale").length,
      contradictedClaimCount: claims.filter((claim) => claim.status === "contradicted").length,
      supersededClaimCount: claims.filter((claim) => claim.status === "superseded").length,
      orphanClaimCount: 0,
      reinforcedClaimCount: claims.filter((claim) => Number(claim.reinforcement_count) > 0).length,
      claimsMissingSourceRefCount: claims.filter((claim) => claim.source_refs.length === 0).length,
      claimsMissingSnippetHashCount: claims.filter((claim) =>
        claim.source_refs.length > 0 &&
        claim.source_refs.every((ref) => !ref.snippet_hash)
      ).length,
      historicalConflictCandidateCount: 0,
      historicalConflictSuggestionCount: 0,
      historicalConflictWarningCount: 0,
      selfHealingCandidateCount: 0,
      selfHealingWarningCount: 0,
    },
    selfHealingSummary: {
      candidateCount: 0,
      claimProvenanceCandidateCount: 0,
      claimIndexCandidateCount: 0,
      consolidationQueueCandidateCount: 0,
      relationCleanupCandidateCount: 0,
      schemaWarningCandidateCount: 0,
      policyWarningCandidateCount: 0,
      warnings: [],
      actions: [],
    },
  }
}

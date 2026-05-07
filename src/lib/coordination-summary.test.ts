import { describe, expect, it } from "vitest"
import type { AuditEvent } from "@/lib/audit-timeline"
import type { SchemaDriftFinding } from "@/lib/schema-drift"
import type { ReviewItem } from "@/stores/review-store"
import { buildCoordinationSummary } from "./coordination-summary"

describe("coordination summary", () => {
  it("builds a stable summary from audit-only projects", () => {
    const summary = buildCoordinationSummary({
      now: Date.parse("2026-05-07T12:00:00.000Z"),
      auditEvents: [
        event({
          timestamp: "2026-05-07T02:00:00.000Z",
          action: "memory.write",
          actor: "system",
          targetPath: "wiki/concepts/search.md",
          changes: { status: "applied" },
        }),
        event({
          timestamp: "2026-05-07T03:00:00.000Z",
          action: "digest.save",
          actor: "user",
          targetPath: "wiki/queries/search-notes.md",
          changes: { status: "applied" },
        }),
      ],
    })

    expect(summary.generatedAt).toBe("2026-05-07T12:00:00.000Z")
    expect(summary.totals).toMatchObject({
      auditEventCount: 2,
      actorCount: 2,
      targetCount: 2,
      pendingReviewCount: 0,
      blockedFindingCount: 0,
    })
    expect(summary.actors.map((actor) => actor.actor)).toEqual(["user", "system"])
    expect(summary.recentEvents.map((item) => item.action)).toEqual([
      "digest.save",
      "memory.write",
    ])
  })

  it("redacts private event details while keeping locators", () => {
    const summary = buildCoordinationSummary({
      auditEvents: [
        event({
          timestamp: "2026-05-07T04:00:00.000Z",
          action: "memory.write",
          actor: "agent",
          targetPath: "wiki/entities/private-lead.md",
          pagePath: "wiki/entities/private-lead.md",
          sourcePath: "raw/sources/private.pdf",
          scope: "private",
          reasons: ["contains confidential customer detail"],
        }),
      ],
    })

    expect(summary.totals.privateEventCount).toBe(1)
    expect(summary.recentEvents[0]).toMatchObject({
      targetPath: "wiki/entities/private-lead.md",
      pagePath: undefined,
      sourcePath: undefined,
      private: true,
      reasonText: "1 private reason redacted",
    })
  })

  it("summarizes pending reviews and blocked schema findings", () => {
    const summary = buildCoordinationSummary({
      reviewItems: [
        review({
          id: "review-1",
          title: "Confirm stale claim",
          affectedPages: ["wiki/concepts/old.md"],
          createdAt: 1,
        }),
        review({
          id: "review-2",
          title: "Already handled",
          resolved: true,
          createdAt: 2,
        }),
      ],
      schemaFindings: [
        finding({
          id: "drift-1",
          kind: "dangling-relation",
          targetPath: "wiki/concepts/a.md",
          field: "supports",
          proposedOperation: undefined,
        }),
        finding({
          id: "drift-2",
          kind: "invalid-score",
          targetPath: "wiki/concepts/b.md",
          proposedOperation: {
            kind: "metadata-patch",
            targetPath: "wiki/concepts/b.md",
            fields: { quality_score: "0.5" },
            reason: "normalize quality score",
          },
        }),
      ],
    })

    expect(summary.pendingReviews).toEqual([
      expect.objectContaining({
        id: "review-1",
        targetPath: "wiki/concepts/old.md",
      }),
    ])
    expect(summary.blockedFindings).toEqual([
      expect.objectContaining({
        id: "drift-1",
        reviewOnly: true,
      }),
      expect.objectContaining({
        id: "drift-2",
        reviewOnly: false,
      }),
    ])
  })

  it("surfaces private promotion candidates unless blocked", () => {
    const summary = buildCoordinationSummary({
      auditEvents: [
        event({
          timestamp: "2026-05-07T04:00:00.000Z",
          action: "memory.write",
          actor: "agent",
          targetPath: "wiki/entities/private-lead.md",
          scope: "private",
        }),
        event({
          timestamp: "2026-05-07T05:00:00.000Z",
          action: "memory.write",
          actor: "agent",
          targetPath: "wiki/entities/blocked.md",
          scope: "private",
        }),
      ],
      schemaFindings: [
        finding({
          id: "drift-blocked",
          kind: "missing-required-field",
          targetPath: "wiki/entities/blocked.md",
        }),
      ],
    })

    expect(summary.promotionCandidates).toEqual([
      {
        targetPath: "wiki/entities/private-lead.md",
        reason: "private scoped activity may need shared promotion review",
        lastTimestamp: "2026-05-07T04:00:00.000Z",
      },
    ])
  })
})

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    action: "query.answer",
    actor: "system",
    ...overrides,
  }
}

function review(overrides: Partial<ReviewItem>): ReviewItem {
  return {
    id: "review",
    type: "confirm",
    title: "Review",
    description: "Needs review",
    options: [],
    resolved: false,
    createdAt: 0,
    ...overrides,
  }
}

function finding(overrides: Partial<SchemaDriftFinding>): SchemaDriftFinding {
  return {
    id: "finding",
    kind: "dangling-relation",
    severity: "warning",
    targetPath: "wiki/concepts/a.md",
    title: "Finding",
    detail: "Needs attention",
    reasons: ["reason"],
    ...overrides,
  }
}

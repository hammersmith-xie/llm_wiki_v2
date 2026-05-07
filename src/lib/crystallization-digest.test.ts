import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CrystallizationCandidate } from "./crystallize-candidates"
import {
  buildCrystallizationDigestPlan,
  recordCrystallizationDigestPreview,
  recordCrystallizationDigestSave,
} from "./crystallization-digest"

vi.mock("@/lib/wiki-automation-events", () => ({
  recordWikiAutomationEvent: vi.fn(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  })),
}))

import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"

const mockRecordWikiAutomationEvent = vi.mocked(recordWikiAutomationEvent)

beforeEach(() => {
  mockRecordWikiAutomationEvent.mockReset()
  mockRecordWikiAutomationEvent.mockImplementation(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  }))
})

describe("crystallization digest planner", () => {
  it("does not create a digest for low-score or unreferenced content", () => {
    expect(buildCrystallizationDigestPlan({
      candidate: candidate({ score: 0.3 }),
    })).toBeNull()

    expect(buildCrystallizationDigestPlan({
      candidate: candidate({
        references: [],
        content: [
          "# Cache Notes",
          "",
          "Recommendation: preserve this answer because it explains several tradeoffs in enough detail.",
          "Takeaway: the idea is useful, but it has no explicit source or wiki reference.",
        ].join("\n"),
      }),
    })).toBeNull()
  })

  it("builds conservative lessons, decisions, entities, relations, and page candidates", () => {
    const plan = buildCrystallizationDigestPlan({
      candidate: candidate(),
    })

    expect(plan).not.toBeNull()
    expect(plan?.dedupeKey).toBe("digest:content:graph")
    expect(plan?.decisions.map((item) => item.statement)).toEqual([
      "keep graph expansion query-time because [[concepts/typed-graph|Typed Graph]] changes with every page write.",
      "Next step: use [[concepts/bm25-ranking|BM25 Ranking]] as a lexical baseline before graph expansion.",
    ])
    expect(plan?.lessons.map((item) => item.text)).toEqual([
      "hybrid search needs BM25, vector, and graph streams to remain separately auditable.",
    ])
    expect(plan?.entities.map((entity) => entity.targetSlug)).toEqual([
      "typed-graph",
      "bm25-ranking",
    ])
    expect(plan?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "supports",
          source: "query-planner-tradeoffs",
          target: "typed-graph",
          targetPath: "wiki/concepts/typed-graph.md",
        }),
      ]),
    )
    expect(plan?.pageCandidates[0]).toMatchObject({
      type: "synthesis",
      targetPath: "wiki/synthesis/query-planner-tradeoffs.md",
    })
  })

  it("skips duplicate digest keys", () => {
    expect(buildCrystallizationDigestPlan({
      candidate: candidate(),
      existingDigestKeys: ["digest:content:graph"],
    })).toBeNull()
  })

  it("records preview events without maintenance dirty tracking", async () => {
    const plan = buildCrystallizationDigestPlan({ candidate: candidate() })
    expect(plan).not.toBeNull()

    await recordCrystallizationDigestPreview("/project", plan!)

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "digest.preview",
        projectPath: "/project",
        actor: "user",
        status: "dry-run",
        maintenance: false,
        summary: expect.objectContaining({
          dedupeKey: "digest:content:graph",
          sourceDedupeKey: "content:graph",
        }),
      }),
    )
  })

  it("records save events with dedupe key and target paths", async () => {
    const plan = buildCrystallizationDigestPlan({ candidate: candidate() })
    expect(plan).not.toBeNull()

    await recordCrystallizationDigestSave({
      projectPath: "/project",
      plan: plan!,
      targetPaths: ["wiki/queries/query-planner-tradeoffs.md"],
      appliedOperationCount: 2,
      skippedOperationCount: 1,
    })

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "digest.save",
        projectPath: "/project",
        actor: "user",
        targetPath: "wiki/queries/query-planner-tradeoffs.md",
        pagePath: "wiki/queries/query-planner-tradeoffs.md",
        status: "applied",
        summary: expect.objectContaining({
          dedupeKey: "digest:content:graph",
          targetPaths: [
            "wiki/queries/query-planner-tradeoffs.md",
            "wiki/synthesis/query-planner-tradeoffs.md",
          ],
          appliedOperationCount: 2,
          skippedOperationCount: 1,
        }),
      }),
    )
  })
})

function candidate(
  overrides: Partial<CrystallizationCandidate> = {},
): CrystallizationCandidate {
  return {
    id: "crystallize:chat:m-1",
    origin: "chat",
    sourceId: "m-1",
    title: "Query Planner Tradeoffs",
    content: [
      "# Query Planner Tradeoffs",
      "",
      "Decision: keep graph expansion query-time because [[concepts/typed-graph|Typed Graph]] changes with every page write.",
      "Takeaway: hybrid search needs BM25, vector, and graph streams to remain separately auditable.",
      "",
      "- Next step: use [[concepts/bm25-ranking|BM25 Ranking]] as a lexical baseline before graph expansion.",
    ].join("\n"),
    score: 0.78,
    reasons: ["2 explicit references", "contains decision signal"],
    references: [
      { title: "Typed Graph", path: "wiki/concepts/typed-graph.md" },
      { title: "BM25 Ranking", path: "wiki/concepts/bm25-ranking.md" },
    ],
    tags: ["chat"],
    dedupeKey: "content:graph",
    timestamp: 1,
    ...overrides,
  }
}

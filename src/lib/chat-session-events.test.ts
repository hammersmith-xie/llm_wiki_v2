import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  recordChatSessionEnd,
  recordChatSessionStart,
} from "./chat-session-events"

vi.mock("@/lib/wiki-automation-events", () => ({
  recordWikiAutomationEvent: vi.fn(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  })),
}))

vi.mock("@/lib/crystallization-digest", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crystallization-digest")>(
    "@/lib/crystallization-digest",
  )
  return {
    ...actual,
    recordCrystallizationDigestPreview: vi.fn(async (projectPath, plan) => ({
      action: "digest.preview",
      auditEvent: {
        action: "digest.preview",
        targetPath: plan.pageCandidates[0]?.targetPath,
      },
      projectPath,
    })),
  }
})

vi.mock("@/lib/consolidation-queue", () => ({
  addDigestPlanToConsolidationQueue: vi.fn(async (_input) => ({
    added: true,
    item: { id: "cq_graph", dedupeKey: "digest:graph" },
    items: [],
  })),
}))

import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"
import { recordCrystallizationDigestPreview } from "@/lib/crystallization-digest"
import { addDigestPlanToConsolidationQueue } from "@/lib/consolidation-queue"

const mockRecordWikiAutomationEvent = vi.mocked(recordWikiAutomationEvent)
const mockRecordCrystallizationDigestPreview = vi.mocked(recordCrystallizationDigestPreview)
const mockAddDigestPlanToConsolidationQueue = vi.mocked(addDigestPlanToConsolidationQueue)

beforeEach(() => {
  mockRecordWikiAutomationEvent.mockReset()
  mockRecordWikiAutomationEvent.mockImplementation(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  }))
  mockRecordCrystallizationDigestPreview.mockReset()
  mockRecordCrystallizationDigestPreview.mockImplementation(async (projectPath, plan) => ({
    action: "digest.preview",
    auditEvent: {
      action: "digest.preview",
      targetPath: plan.pageCandidates[0]?.targetPath,
    },
    projectPath,
  }))
  mockAddDigestPlanToConsolidationQueue.mockReset()
  mockAddDigestPlanToConsolidationQueue.mockResolvedValue({
    added: true,
    item: { id: "cq_graph", dedupeKey: "digest:graph" } as never,
    items: [],
  })
})

describe("chat session automation events", () => {
  it("records session start without marking maintenance dirty", async () => {
    await recordChatSessionStart({
      projectPath: "/project",
      conversationId: "conv-1",
      reason: "sidebar new chat",
    })

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith({
      type: "session.start",
      projectPath: "/project",
      actor: "user",
      status: "applied",
      reasons: ["conversation created", "sidebar new chat"],
      summary: {
        conversationId: "conv-1",
        messageCount: 0,
      },
      maintenance: false,
    })
  })

  it("records session end with response summary only", async () => {
    await recordChatSessionEnd({
      projectPath: "/project",
      conversationId: "conv-1",
      messageCount: 4,
      referencedPageCount: 2,
    })

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith({
      type: "session.end",
      projectPath: "/project",
      actor: "system",
      status: "applied",
      reasons: ["assistant response completed"],
      summary: {
        conversationId: "conv-1",
        messageCount: 4,
        referencedPageCount: 2,
        crystallizationCandidateCount: 0,
        crystallizationCandidates: [],
      },
      maintenance: false,
    })
    expect(mockRecordCrystallizationDigestPreview).not.toHaveBeenCalled()
  })

  it("records a digest preview for high-value session-end candidates", async () => {
    await recordChatSessionEnd({
      projectPath: "/project",
      conversationId: "conv-1",
      messageCount: 2,
      referencedPageCount: 2,
      messages: [
        {
          id: "a-1",
          role: "assistant",
          conversationId: "conv-1",
          timestamp: 1,
          content: [
            "# Graph Search Decision",
            "",
            "Summary: hybrid search needs BM25, vector, and graph streams to stay separately auditable.",
            "Recommendation: keep graph expansion query-time because [[concepts/typed-graph|Typed Graph]] changes after page writes.",
            "Next step: use [[concepts/bm25-ranking|BM25 Ranking]] as the lexical baseline before graph expansion.",
          ].join("\n"),
          references: [
            { title: "Typed Graph", path: "wiki/concepts/typed-graph.md" },
            { title: "BM25 Ranking", path: "wiki/concepts/bm25-ranking.md" },
          ],
        },
      ],
    })

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.end",
        summary: expect.objectContaining({
          crystallizationCandidateCount: 1,
          crystallizationCandidates: [
            expect.objectContaining({
              sourceId: "a-1",
              title: "Graph Search Decision",
              targetPaths: ["wiki/synthesis/graph-search-decision.md"],
            }),
          ],
        }),
      }),
    )
    expect(mockRecordCrystallizationDigestPreview).toHaveBeenCalledOnce()
    expect(mockRecordCrystallizationDigestPreview).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        source: expect.objectContaining({
          sourceId: "a-1",
          origin: "chat",
        }),
      }),
    )
    expect(mockAddDigestPlanToConsolidationQueue).toHaveBeenCalledWith({
      projectPath: "/project",
      plan: expect.objectContaining({
        source: expect.objectContaining({
          sourceId: "a-1",
          origin: "chat",
        }),
      }),
    })
  })

  it("does not record digest previews for errored sessions", async () => {
    await recordChatSessionEnd({
      projectPath: "/project",
      conversationId: "conv-1",
      status: "error",
      messages: [
        {
          id: "a-1",
          role: "assistant",
          conversationId: "conv-1",
          timestamp: 1,
          content: [
            "# Graph Search Decision",
            "",
            "Summary: hybrid search needs BM25, vector, and graph streams to stay separately auditable.",
            "Recommendation: keep graph expansion query-time because [[concepts/typed-graph|Typed Graph]] changes after page writes.",
            "Next step: use [[concepts/bm25-ranking|BM25 Ranking]] as the lexical baseline before graph expansion.",
          ].join("\n"),
          references: [{ title: "Typed Graph", path: "wiki/concepts/typed-graph.md" }],
        },
      ],
    })

    expect(mockRecordCrystallizationDigestPreview).not.toHaveBeenCalled()
    expect(mockAddDigestPlanToConsolidationQueue).not.toHaveBeenCalled()
  })

  it("skips recording when no project is open", async () => {
    await recordChatSessionStart({
      projectPath: null,
      conversationId: "conv-1",
    })

    expect(mockRecordWikiAutomationEvent).not.toHaveBeenCalled()
  })
})

import { describe, expect, it } from "vitest"
import type { DisplayMessage } from "@/stores/chat-store"
import { buildSessionCrystallizationPlans } from "./session-crystallization"

describe("session crystallization planning", () => {
  it("builds a digest preview plan from the best referenced assistant answer", () => {
    const plans = buildSessionCrystallizationPlans({
      conversationId: "conv-1",
      messages: [
        message({
          id: "u-1",
          role: "user",
          content: "How should we handle graph search?",
        }),
        message({
          id: "a-1",
          role: "assistant",
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
        }),
      ],
    })

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      conversationId: "conv-1",
      candidate: {
        origin: "chat",
        sourceId: "a-1",
        title: "Graph Search Decision",
      },
      digest: {
        source: {
          sourceId: "a-1",
          origin: "chat",
        },
      },
    })
    expect(plans[0].digest.summary.decisionCount).toBeGreaterThan(0)
    expect(plans[0].digest.pageCandidates[0].targetPath).toBe(
      "wiki/synthesis/graph-search-decision.md",
    )
  })

  it("does not build previews for low-value or unreferenced sessions", () => {
    expect(buildSessionCrystallizationPlans({
      conversationId: "conv-1",
      messages: [
        message({
          id: "a-1",
          role: "assistant",
          content: "Short answer without evidence.",
        }),
      ],
    })).toEqual([])
  })

  it("skips duplicate digest keys", () => {
    const first = buildSessionCrystallizationPlans({
      conversationId: "conv-1",
      messages: [highValueAssistantMessage()],
    })
    expect(first).toHaveLength(1)

    expect(buildSessionCrystallizationPlans({
      conversationId: "conv-1",
      messages: [highValueAssistantMessage()],
      existingDigestKeys: [first[0].digest.dedupeKey],
    })).toEqual([])
  })
})

function highValueAssistantMessage(): DisplayMessage {
  return message({
    id: "a-1",
    role: "assistant",
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
  })
}

function message(
  overrides: Partial<DisplayMessage> & Pick<DisplayMessage, "id" | "content">,
): DisplayMessage {
  return {
    role: "assistant",
    timestamp: 1,
    conversationId: "conv-1",
    ...overrides,
  }
}

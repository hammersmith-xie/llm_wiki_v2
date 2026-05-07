import { describe, expect, it } from "vitest"
import type { DisplayMessage } from "@/stores/chat-store"
import type { ResearchTask } from "@/stores/research-store"
import type { ReviewItem } from "@/stores/review-store"
import {
  collectCrystallizationCandidates,
  dedupeKeyForCrystallizationContent,
  scoreCrystallizationCandidate,
} from "./crystallize-candidates"

describe("crystallization candidate scoring", () => {
  it("does not suggest short unreferenced content", () => {
    expect(
      scoreCrystallizationCandidate({
        origin: "chat",
        sourceId: "m-1",
        content: "Sure, that sounds reasonable.",
        references: [],
        timestamp: 1,
      }),
    ).toBeNull()
  })

  it("scores long referenced answers with conclusions and displayable reasons", () => {
    const content = [
      "# Query Planner Tradeoffs",
      "",
      "The local planner should remain deterministic because the wiki already stores source pages and typed relations. It can score candidate saves from content length, references, and explicit decisions without calling another model.",
      "",
      "## Evidence",
      "- The answer cites [[query-planning]] and [[typed-graph]].",
      "- It includes enough detail for a future query page rather than a transient chat reply.",
      "",
      "## Conclusion",
      "Recommendation: save this as a query page so future searches can retrieve the decision and its evidence.",
      "",
      "Next steps: reuse the existing crystallization helper and keep auto-ingest optional.",
    ].join("\n")

    const candidate = scoreCrystallizationCandidate({
      origin: "chat",
      sourceId: "m-2",
      content,
      references: [
        { title: "Query Planning", path: "wiki/concepts/query-planning.md" },
        { title: "Typed Graph", path: "wiki/concepts/typed-graph.md" },
      ],
      timestamp: 2,
    })

    expect(candidate).toEqual(
      expect.objectContaining({
        origin: "chat",
        sourceId: "m-2",
        title: "Query Planner Tradeoffs",
        score: expect.any(Number),
        dedupeKey: dedupeKeyForCrystallizationContent(content),
      }),
    )
    expect(candidate?.score).toBeGreaterThanOrEqual(0.6)
    expect(candidate?.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("references"),
        expect.stringContaining("conclusion"),
        expect.stringContaining("decision"),
      ]),
    )
    expect(candidate?.references).toHaveLength(2)
  })

  it("does not repeat already saved content", () => {
    const content = [
      "# Saved Analysis",
      "",
      "## Conclusion",
      "Recommendation: keep this saved answer in the wiki because it is already crystallized.",
      "It cites [[saved-page]] and includes enough context to qualify otherwise.",
    ].join("\n")
    const dedupeKey = dedupeKeyForCrystallizationContent(content)

    expect(
      scoreCrystallizationCandidate({
        origin: "review",
        sourceId: "r-1",
        content,
        references: [{ title: "Saved Page", path: "wiki/queries/saved-page.md" }],
        existingDedupeKeys: [dedupeKey],
      }),
    ).toBeNull()
  })
})

describe("crystallization candidate collection", () => {
  it("collects chat, research, and review outputs while skipping saved sources and duplicates", () => {
    const chatMessage: DisplayMessage = {
      id: "m-1",
      role: "assistant",
      content: [
        "# Retrieval Notes",
        "",
        "## Conclusion",
        "Recommendation: preserve the retrieval notes because they cite concrete pages and capture a decision.",
        "The notes explain why [[graph-search]] should stay query-time rather than become a central database.",
      ].join("\n"),
      timestamp: 10,
      conversationId: "c-1",
      references: [{ title: "Graph Search", path: "wiki/concepts/graph-search.md" }],
    }
    const researchTask: ResearchTask = {
      id: "research-1",
      topic: "Memory Ops",
      status: "done",
      webResults: [
        {
          title: "Memory systems",
          url: "https://example.com/memory",
          snippet: "Long-term memory maintenance patterns.",
          source: "example.com",
        },
      ],
      synthesis: [
        "# Memory Ops",
        "",
        "## Summary",
        "This research synthesis has references and a concrete recommendation for periodic maintenance.",
        "Conclusion: keep the patrol deterministic, then allow a user-confirmed save.",
      ].join("\n"),
      savedPath: "wiki/queries/research-memory-ops.md",
      error: null,
      createdAt: 11,
    }
    const reviewItem: ReviewItem = {
      id: "review-1",
      type: "suggestion",
      title: "Save: Search evaluation plan",
      description: [
        "## Decision",
        "Recommendation: add deterministic scenarios for exact title, alias, and graph-only search results.",
        "Affected pages: [[search]] and [[typed-graph]].",
      ].join("\n"),
      affectedPages: ["wiki/concepts/search.md", "wiki/concepts/typed-graph.md"],
      options: [{ label: "Save", action: "save:abc" }],
      resolved: false,
      createdAt: 12,
    }

    const candidates = collectCrystallizationCandidates({
      chatMessages: [chatMessage, { ...chatMessage, id: "m-user", role: "user" }],
      researchTasks: [researchTask],
      reviewItems: [reviewItem, { ...reviewItem, id: "review-2", resolved: true }],
    })

    expect(candidates.map((candidate) => candidate.sourceId).sort()).toEqual([
      "m-1",
      "review-1",
    ])
    expect(candidates.every((candidate) => candidate.reasons.length > 0)).toBe(true)
  })
})

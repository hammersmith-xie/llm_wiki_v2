import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendQueryAuditEvent,
  appendReviewResolveAuditEvent,
  appendSearchAuditEvent,
} from "./audit-events"

vi.mock("@/lib/audit-timeline", () => ({
  appendAuditEvent: vi.fn(async () => {}),
}))
vi.mock("@/lib/memory-ops", () => ({
  recordMemoryOpsMaintenanceEvent: vi.fn(async () => {}),
}))

import { appendAuditEvent } from "@/lib/audit-timeline"
import { recordMemoryOpsMaintenanceEvent } from "@/lib/memory-ops"

const mockAppendAuditEvent = vi.mocked(appendAuditEvent)
const mockRecordMaintenanceEvent = vi.mocked(recordMemoryOpsMaintenanceEvent)

beforeEach(() => {
  mockAppendAuditEvent.mockReset()
  mockRecordMaintenanceEvent.mockReset()
})

describe("audit event helpers", () => {
  it("records explicit search runs with relative result paths and retrieval summary", async () => {
    await appendSearchAuditEvent("/project", {
      query: "hybrid search",
      results: [
        {
          path: "/project/wiki/concepts/hybrid-search.md",
          title: "Hybrid Search",
          snippet: "BM25 + vector + graph",
          titleMatch: true,
          score: 0.034,
          graphPath: ["search", "typed-graph"],
          retrieval: {
            rrfScore: 0.034,
            token: { rank: 1, rawScore: 31, rrf: 0.0164 },
            bm25: { rank: 1, rawScore: 9.2, rrf: 0 },
            vector: { rank: 3, rawScore: 0.82, rrf: 0.0158 },
            graph: { rank: 2, rawScore: 4, rrf: 0.0161, path: ["search", "typed-graph"] },
          },
          images: [],
        },
      ],
    })

    expect(mockAppendAuditEvent).toHaveBeenCalledWith("/project", {
      action: "search.run",
      actor: "user",
      targetPath: ".llm-wiki/audit.jsonl",
      retrieval: {
        query: "hybrid search",
        streams: [
          { name: "token", resultCount: 1 },
          { name: "bm25", resultCount: 1 },
          { name: "vector", resultCount: 1 },
          { name: "graph", resultCount: 1 },
        ],
        results: [
          {
            path: "wiki/concepts/hybrid-search.md",
            title: "Hybrid Search",
            rank: 1,
            score: 0.034,
            streams: ["token", "bm25", "vector", "graph"],
          },
        ],
      },
      after: { resultCount: 1 },
      reasons: ["explicit user search", "1 result returned"],
    })
    expect(mockRecordMaintenanceEvent).toHaveBeenCalledWith("/project", "search.run")
  })

  it("does not write audit events for empty searches", async () => {
    await appendSearchAuditEvent("/project", { query: "   ", results: [] })

    expect(mockAppendAuditEvent).not.toHaveBeenCalled()
    expect(mockRecordMaintenanceEvent).not.toHaveBeenCalled()
  })

  it("records answered wiki queries with cited page summaries", async () => {
    await appendQueryAuditEvent("/project", {
      query: "what does the graph add?",
      referencedPages: [
        { title: "Typed Graph", path: "/project/wiki/concepts/typed-graph.md" },
        { title: "Search", path: "wiki/concepts/search.md" },
      ],
    })

    expect(mockAppendAuditEvent).toHaveBeenCalledWith("/project", {
      action: "query.answer",
      actor: "system",
      targetPath: ".llm-wiki/chats",
      retrieval: {
        query: "what does the graph add?",
        streams: [{ name: "wiki-context", resultCount: 2 }],
        results: [
          { path: "wiki/concepts/typed-graph.md", title: "Typed Graph", rank: 1 },
          { path: "wiki/concepts/search.md", title: "Search", rank: 2 },
        ],
      },
      after: { referencedPageCount: 2 },
      reasons: ["2 wiki pages referenced"],
    })
    expect(mockRecordMaintenanceEvent).toHaveBeenCalledWith("/project", "query.answer")
  })

  it("records review resolutions with source and affected page context", async () => {
    await appendReviewResolveAuditEvent("/project", {
      item: {
        id: "review-1",
        type: "contradiction",
        title: "Check stale claim",
        description: "Old page conflicts with new source.",
        sourcePath: "raw/sources/new.pdf",
        affectedPages: ["/project/wiki/concepts/old-claim.md"],
        options: [],
        resolved: false,
        createdAt: 1,
      },
      resolvedAction: "Marked stale",
      outcome: "applied",
    })

    expect(mockAppendAuditEvent).toHaveBeenCalledWith("/project", {
      action: "review.resolve",
      actor: "user",
      targetPath: "wiki/concepts/old-claim.md",
      pagePath: "wiki/concepts/old-claim.md",
      sourcePath: "raw/sources/new.pdf",
      after: {
        reviewId: "review-1",
        type: "contradiction",
        title: "Check stale claim",
        resolvedAction: "Marked stale",
        outcome: "applied",
        affectedPages: ["wiki/concepts/old-claim.md"],
      },
      reasons: ["Check stale claim", "Marked stale"],
    })
    expect(mockRecordMaintenanceEvent).toHaveBeenCalledWith("/project", "review.resolve")
  })
})

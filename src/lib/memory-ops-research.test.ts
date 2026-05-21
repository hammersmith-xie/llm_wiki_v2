import { describe, expect, it, vi } from "vitest"
import { runMemoryOpsResearchEvidence } from "./memory-ops-research"
import type { MemoryOpsResearchCandidate } from "./memory-ops-research-types"
import type { SearchApiConfig } from "@/stores/wiki-store"

const candidate: MemoryOpsResearchCandidate = {
  id: "suggestion:test",
  kind: "suggestion",
  targetPath: "wiki/test.md",
  title: "Review stale API claim",
  query: "API claim support",
  summary: "The API claim may be stale.",
  reasons: ["stale claim"],
  suggestionId: "test",
}

describe("memory ops research evidence", () => {
  it("runs local evidence without web configuration", async () => {
    const report = await runMemoryOpsResearchEvidence("/project", [candidate], {
      providers: ["local"],
      readFileImpl: vi.fn(async () => "---\ntitle: API Claim\n---\n\n# API Claim\n\nThe API claim has support."),
      now: new Date("2026-05-21T00:00:00.000Z"),
    })

    expect(report.summary.candidateCount).toBe(1)
    expect(report.summary.evidenceCount).toBe(1)
    expect(report.results[0]?.verdict).toBe("supported")
    expect(report.results[0]?.evidence[0]?.path).toBe("wiki/test.md")
  })

  it("marks web search unavailable when provider is not configured", async () => {
    const report = await runMemoryOpsResearchEvidence("/project", [candidate], {
      providers: ["web-search"],
      searchConfig: { provider: "none", apiKey: "" },
    })

    expect(report.results[0]?.verdict).toBe("unavailable")
    expect(report.results[0]?.warnings[0]).toContain("not configured")
  })

  it("normalizes web search results into evidence", async () => {
    const searchConfig: SearchApiConfig = { provider: "tavily", apiKey: "test-key" }
    const report = await runMemoryOpsResearchEvidence("/project", [candidate], {
      providers: ["web-search"],
      searchConfig,
      webSearchImpl: vi.fn(async () => [{
        title: "API claim support",
        url: "https://example.com/api",
        snippet: "API claim support remains valid.",
        source: "example.com",
      }]),
    })

    expect(report.results[0]?.verdict).toBe("supported")
    expect(report.results[0]?.evidence[0]?.url).toBe("https://example.com/api")
  })

  it("runs deep research as bounded multi-query web evidence", async () => {
    const searchConfig: SearchApiConfig = { provider: "tavily", apiKey: "test-key" }
    const search = vi.fn(async (query: string) => [{
      title: query.includes("latest") ? "Latest API evidence" : "API claim support",
      url: query.includes("latest")
        ? "https://example.com/latest"
        : "https://example.com/api",
      snippet: "API claim support remains valid.",
      source: "example.com",
    }])

    const report = await runMemoryOpsResearchEvidence("/project", [candidate], {
      providers: ["deep-research"],
      searchConfig,
      webSearchImpl: search,
      maxResultsPerProvider: 2,
    })

    expect(search).toHaveBeenCalledTimes(3)
    expect(report.results[0]?.providerResults[0]?.provider).toBe("deep-research")
    expect(report.results[0]?.evidence).toHaveLength(2)
    expect(report.results[0]?.verdict).toBe("supported")
  })
})

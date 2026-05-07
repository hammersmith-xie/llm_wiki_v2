import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import fs from "node:fs/promises"
import { realFs, createTempProject } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

const mockSearchByEmbedding =
  vi.fn<(...args: unknown[]) => Promise<Array<{ id: string; score: number }>>>()
vi.mock("./embedding", () => ({
  searchByEmbedding: (...args: unknown[]) => mockSearchByEmbedding(...args),
}))

const mockBuildTypedGraph = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const mockGraphRankPages = vi.fn<
  (...args: unknown[]) => Array<{
    id: string
    score: number
    path: string[]
    pathTypes?: string[]
    pathDirections?: string[]
  }>
>()
vi.mock("@/lib/typed-graph", () => ({
  buildTypedGraph: (...args: unknown[]) => mockBuildTypedGraph(...args),
  graphRankPages: (...args: unknown[]) => mockGraphRankPages(...args),
}))

import {
  formatSearchEvalReport,
  runSearchEval,
  runSearchWikiEval,
  summarizeSearchEvalForMemoryOps,
} from "./search-eval"
import { useWikiStore } from "@/stores/wiki-store"

interface Ctx {
  tmp: { path: string; cleanup: () => Promise<void> }
}

let ctx: Ctx | undefined

beforeEach(() => {
  mockSearchByEmbedding.mockReset()
  mockBuildTypedGraph.mockReset()
  mockGraphRankPages.mockReset()
  mockBuildTypedGraph.mockResolvedValue({
    nodes: new Map(),
    edges: [],
    adjacency: new Map(),
    dataVersion: 0,
  })
  mockGraphRankPages.mockReturnValue([])
  useWikiStore.getState().setEmbeddingConfig({
    enabled: false,
    endpoint: "",
    apiKey: "",
    model: "",
  })
})

afterEach(async () => {
  if (ctx) {
    await ctx.tmp.cleanup()
    ctx = undefined
  }
})

describe("search eval harness", () => {
  it("runs lexical scenarios against a temp wiki for exact title, alias, and CJK queries", async () => {
    ctx = await setupProject({
      "wiki/concepts/attention.md": page(
        "Attention",
        "aliases: [attn]",
        "The attention mechanism weights tokens.",
      ),
      "wiki/concepts/tavily-api.md": page(
        "Tavily API",
        "aliases: [web search api, tavily]",
        "Search provider integration notes.",
      ),
      "wiki/concepts/attention-zh.md": page(
        "注意力机制",
        "aliases: []",
        "注意力机制是 Transformer 架构的核心组件之一。",
      ),
    })

    const report = await runSearchWikiEval(ctx.tmp.path, [
      {
        id: "exact-title",
        query: "attention",
        expectedTopPaths: ["wiki/concepts/attention.md"],
      },
      {
        id: "alias",
        query: "web search api",
        expectedInTopK: [{ path: "wiki/concepts/tavily-api.md", topK: 1 }],
      },
      {
        id: "cjk",
        query: "注意力机制",
        expectedTopPaths: ["wiki/concepts/attention-zh.md"],
      },
    ])

    expect(report.summary).toEqual({
      scenarioCount: 3,
      passedCount: 3,
      failedCount: 0,
    })
    expect(report.results.every((result) => result.passed)).toBe(true)
    expect(report.results[0].topResults[0]).toMatchObject({
      rank: 1,
      path: "wiki/concepts/attention.md",
      streams: [
        { name: "token", rank: 1 },
        { name: "bm25", rank: 1 },
      ],
    })
  })

  it("runs deterministic vector-only and graph-only scenarios with mocked embedding enabled", async () => {
    ctx = await setupProject({
      "wiki/concepts/seed.md": page("Seed", "aliases: []", "attention seed page."),
      "wiki/concepts/vector-only.md": page("Vector Only", "aliases: []", "semantic match page."),
      "wiki/concepts/graph-only.md": page("Graph Only", "aliases: []", "connected page."),
    })
    useWikiStore.getState().setEmbeddingConfig({
      enabled: true,
      endpoint: "http://test/v1/embeddings",
      apiKey: "",
      model: "test-embed",
    })
    mockSearchByEmbedding.mockImplementation(async (_projectPath, query) => {
      if (String(query).includes("semantic retrieval")) {
        return [{ id: "vector-only", score: 0.9 }]
      }
      return []
    })
    const graphOnlyPath = path.join(ctx.tmp.path, "wiki/concepts/graph-only.md")
    mockBuildTypedGraph.mockResolvedValue({
      nodes: new Map([
        [
          "graph-only",
          {
            id: "graph-only",
            title: "Graph Only",
            type: "concept",
            path: graphOnlyPath,
            sources: [],
            confidence: 0.8,
          },
        ],
      ]),
      edges: [],
      adjacency: new Map(),
      dataVersion: 0,
    })
    mockGraphRankPages.mockImplementation((_graph, query) => {
      if (String(query).includes("attention")) {
        return [
          {
            id: "graph-only",
            score: 1,
            path: ["seed", "graph-only"],
            pathTypes: ["uses"],
            pathDirections: ["forward"],
          },
        ]
      }
      return []
    })

    const report = await runSearchWikiEval(ctx.tmp.path, [
      {
        id: "vector-only",
        query: "semantic retrieval signal",
        expectedInTopK: [{ path: "wiki/concepts/vector-only.md", topK: 1 }],
      },
      {
        id: "graph-only",
        query: "attention",
        expectedInTopK: [{ path: "wiki/concepts/graph-only.md", topK: 3 }],
      },
    ])

    expect(report.summary.failedCount).toBe(0)
    expect(report.results.map((result) => result.id)).toEqual(["vector-only", "graph-only"])
    expect(report.results[0].topResults[0].streams).toContainEqual(
      expect.objectContaining({ name: "vector", rank: 1 }),
    )
    expect(report.results[1].topResults.some((result) =>
      result.streams.some((stream) =>
        stream.name === "graph" &&
          stream.path?.join(" > ") === "seed > graph-only" &&
          stream.pathTypes?.includes("uses"),
      ),
    )).toBe(true)
  })

  it("summarizes BM25-only and contradiction-deprioritize scenarios for Memory Ops", async () => {
    const report = await runSearchEval(
      [
        {
          id: "bm25-only",
          query: "rare evidence",
          expectedInTopK: [{ path: "wiki/concepts/bm25.md", topK: 1 }],
        },
        {
          id: "contradiction-deprioritize",
          query: "outdated claim",
          expectedTopPaths: ["wiki/concepts/current.md"],
          expectedOutsideTopK: [{ path: "wiki/concepts/old-claim.md", topK: 1 }],
        },
      ],
      async (query) => {
        if (query === "rare evidence") {
          return [
            result("wiki/concepts/bm25.md", "BM25", {
              retrieval: {
                rrfScore: 1 / 61,
                bm25: { rank: 1, rawScore: 7.5, rrf: 1 / 61 },
              },
            }),
          ]
        }
        return [
          result("wiki/concepts/current.md", "Current", {
            retrieval: {
              rrfScore: 1 / 61,
              token: { rank: 1, rawScore: 420, rrf: 1 / 61 },
            },
          }),
          result("wiki/concepts/old-claim.md", "Old Claim", {
            retrieval: {
              rrfScore: 1 / 62,
              token: { rank: 2, rawScore: 100, rrf: 1 / 62 },
            },
          }),
        ]
      },
    )

    expect(report.summary).toMatchObject({
      scenarioCount: 2,
      passedCount: 2,
      failedCount: 0,
    })
    expect(report.results[0].topResults[0].streams).toEqual([
      { name: "bm25", rank: 1, rawScore: 7.5, contribution: 1 / 61 },
    ])

    const summary = summarizeSearchEvalForMemoryOps(report)
    expect(summary).toMatchObject({
      status: "pass",
      scenarioCount: 2,
      failedCount: 0,
      failedScenarios: [],
      streamCounts: {
        bm25: 1,
        token: 2,
      },
    })
  })

  it("reports top-rank, top-k, and excluded-path failures with ranked paths", async () => {
    const report = await runSearchEval(
      [
        {
          id: "failing-case",
          query: "rope",
          expectedTopPaths: ["wiki/concepts/rope.md"],
          expectedInTopK: [{ path: "wiki/concepts/attention.md", topK: 2 }],
          excludedPaths: ["wiki/concepts/random.md"],
        },
      ],
      async () => [
        result("wiki/concepts/random.md", "Random"),
        result("wiki/concepts/rope.md", "RoPE"),
      ],
    )

    expect(report.summary).toEqual({
      scenarioCount: 1,
      passedCount: 0,
      failedCount: 1,
    })
    expect(report.results[0].rankedPaths).toEqual([
      "wiki/concepts/random.md",
      "wiki/concepts/rope.md",
    ])
    expect(report.results[0].failures.map((failure) => failure.kind).sort()).toEqual([
      "excluded-path-present",
      "missing-from-top-k",
      "top-rank-mismatch",
    ])

    expect(report.results[0].topResults.map((result) => result.path)).toEqual([
      "wiki/concepts/random.md",
      "wiki/concepts/rope.md",
    ])
    expect(report.results[0].failures[0]).toMatchObject({
      query: "rope",
      topKPaths: ["wiki/concepts/random.md", "wiki/concepts/rope.md"],
    })
    expect(formatSearchEvalReport(report)).toContain(
      "FAIL failing-case: rope | top 5: wiki/concepts/random.md, wiki/concepts/rope.md",
    )
    expect(summarizeSearchEvalForMemoryOps(report).failedScenarios[0]).toMatchObject({
      id: "failing-case",
      query: "rope",
      topKPaths: ["wiki/concepts/random.md", "wiki/concepts/rope.md"],
    })
  })
})

async function setupProject(files: Record<string, string>): Promise<Ctx> {
  const tmp = await createTempProject("search-eval")
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(tmp.path, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, "utf-8")
  }
  return { tmp }
}

function page(title: string, frontmatter: string, body: string): string {
  return `---\ntitle: ${title}\n${frontmatter}\n---\n\n# ${title}\n\n${body}\n`
}

function result(
  path: string,
  title: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    path,
    title,
    score: 1,
    snippet: "",
    titleMatch: false,
    images: [],
    ...overrides,
  }
}

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { FileNode } from "@/types/wiki"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"
import {
  buildTypedGraph,
  clearTypedGraphCache,
  extractTypedGraphFromPages,
  graphRankPages,
} from "./typed-graph"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  clearTypedGraphCache()
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
})

describe("typed graph", () => {
  it("extracts explicit typed edges and fallback mention edges", () => {
    const graph = extractTypedGraphFromPages([
      {
        id: "rag",
        fileName: "rag.md",
        path: "/p/wiki/concepts/rag.md",
        content: [
          "---",
          "type: concept",
          "title: RAG",
          "sources: [rag-paper.md]",
          "uses: [vector-search]",
          "depends_on: [embedding]",
          "supports: [llm-wiki]",
          "confidence: 0.80",
          "---",
          "",
          "# RAG",
          "",
          "Mentions [[chunking]].",
        ].join("\n"),
      },
      page("vector-search", "Vector Search"),
      page("embedding", "Embedding"),
      page("llm-wiki", "LLM Wiki"),
      page("chunking", "Chunking"),
      page("rag-paper", "RAG Paper"),
    ])

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "rag", target: "vector-search", type: "uses", explicit: true }),
        expect.objectContaining({ source: "rag", target: "embedding", type: "depends_on", explicit: true }),
        expect.objectContaining({ source: "rag", target: "llm-wiki", type: "supports", explicit: true }),
        expect.objectContaining({ source: "rag", target: "rag-paper", type: "derived_from", explicit: true }),
        expect.objectContaining({ source: "rag", target: "chunking", type: "mentions", explicit: false }),
      ]),
    )
  })

  it("reverses superseded_by into a supersedes edge from the newer page", () => {
    const graph = extractTypedGraphFromPages([
      {
        id: "old-claim",
        fileName: "old-claim.md",
        path: "/p/wiki/concepts/old-claim.md",
        content: [
          "---",
          "type: concept",
          "title: Old Claim",
          "superseded_by: [new-claim]",
          "---",
          "",
          "# Old Claim",
        ].join("\n"),
      },
      page("new-claim", "New Claim"),
    ])

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "new-claim",
          target: "old-claim",
          type: "supersedes",
          explicit: true,
        }),
      ]),
    )
  })

  it("resolves typed relationship targets through page aliases", () => {
    const graph = extractTypedGraphFromPages([
      {
        id: "deep-research",
        fileName: "deep-research.md",
        path: "/p/wiki/concepts/deep-research.md",
        content: [
          "---",
          "type: concept",
          "title: Deep Research",
          "uses: [tavily]",
          "---",
          "",
          "# Deep Research",
        ].join("\n"),
      },
      {
        id: "tavily-api",
        fileName: "tavily-api.md",
        path: "/p/wiki/entities/tavily-api.md",
        content: [
          "---",
          "type: entity",
          "title: Tavily Search API",
          "aliases: [tavily]",
          "confidence: 0.8",
          "---",
          "",
          "# Tavily Search API",
        ].join("\n"),
      },
    ])

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "deep-research",
          target: "tavily-api",
          type: "uses",
        }),
      ]),
    )
  })

  it("graph traversal ranks connected pages from a query seed", () => {
    const graph = extractTypedGraphFromPages([
      {
        id: "attention",
        fileName: "attention.md",
        path: "/p/wiki/concepts/attention.md",
        content: [
          "---",
          "type: concept",
          "title: Attention",
          "related: [flash-attention]",
          "confidence: 0.9",
          "---",
          "",
          "# Attention",
        ].join("\n"),
      },
      page("flash-attention", "Flash Attention"),
    ])

    const ranks = graphRankPages(graph, "attention", { maxDepth: 1 })

    expect(ranks[0].id).toBe("attention")
    expect(ranks.map((r) => r.id)).toContain("flash-attention")
    expect(ranks.find((r) => r.id === "flash-attention")?.path).toEqual([
      "attention",
      "flash-attention",
    ])
    expect(
      (ranks.find((r) => r.id === "flash-attention") as unknown as { pathTypes?: string[] })
        ?.pathTypes,
    ).toEqual(["related_to"])
    expect(
      (ranks.find((r) => r.id === "flash-attention") as unknown as { pathDirections?: string[] })
        ?.pathDirections,
    ).toEqual(["forward"])
  })

  it("preserves original edge direction when traversal follows reverse adjacency", () => {
    const graph = extractTypedGraphFromPages([
      {
        id: "deep-research",
        fileName: "deep-research.md",
        path: "/p/wiki/concepts/deep-research.md",
        content: [
          "---",
          "type: concept",
          "title: Deep Research",
          "uses: [tavily]",
          "confidence: 0.9",
          "---",
          "",
          "# Deep Research",
        ].join("\n"),
      },
      page("tavily", "Tavily"),
    ])

    const ranks = graphRankPages(graph, "tavily", { maxDepth: 1 })
    const deepResearch = ranks.find((r) => r.id === "deep-research")

    expect(deepResearch?.path).toEqual(["tavily", "deep-research"])
    expect((deepResearch as unknown as { pathTypes?: string[] })?.pathTypes).toEqual(["uses"])
    expect(
      (deepResearch as unknown as { pathDirections?: string[] })?.pathDirections,
    ).toEqual(["reverse"])
  })

  it("uses lightweight frontmatter seed text for graph traversal queries", () => {
    const graph = extractTypedGraphFromPages([
      {
        id: "deep-research",
        fileName: "deep-research.md",
        path: "/p/wiki/concepts/deep-research.md",
        content: [
          "---",
          "type: concept",
          "title: Deep Research",
          "aliases: [query rewriting]",
          "tags: [retrieval]",
          "summary: Breaks one question into multiple web searches.",
          "uses: [tavily]",
          "confidence: 0.8",
          "---",
          "",
          "# Deep Research",
        ].join("\n"),
      },
      page("tavily", "Tavily"),
    ])

    const ranks = graphRankPages(graph, "query rewriting", { maxDepth: 1 })

    expect(ranks[0].id).toBe("deep-research")
    expect(ranks.map((r) => r.id)).toContain("tavily")
    expect(ranks.find((r) => r.id === "tavily")?.path).toEqual([
      "deep-research",
      "tavily",
    ])
  })

  it("caches typed graphs by project path and data version", async () => {
    const projectAPath = "/project-a/wiki/concepts/a.md"
    const projectBPath = "/project-b/wiki/concepts/b.md"
    mockListDirectory.mockImplementation(async (wikiRoot) => {
      if (wikiRoot === "/project-a/wiki") return [fileNode("a.md", projectAPath)]
      if (wikiRoot === "/project-b/wiki") return [fileNode("b.md", projectBPath)]
      return []
    })
    mockReadFile.mockImplementation(async (filePath) => {
      if (filePath === projectAPath) return page("a", "Project A").content
      if (filePath === projectBPath) return page("b", "Project B").content
      return ""
    })

    const graphA = await buildTypedGraph("/project-a", 1)
    const graphAAgain = await buildTypedGraph("/project-a", 1)
    const graphB = await buildTypedGraph("/project-b", 1)

    expect(graphAAgain).toBe(graphA)
    expect(graphA.nodes.has("a")).toBe(true)
    expect(graphB.nodes.has("b")).toBe(true)
    expect(graphB.nodes.has("a")).toBe(false)
    expect(mockListDirectory).toHaveBeenCalledTimes(2)
  })
})

function page(id: string, title: string) {
  return {
    id,
    fileName: `${id}.md`,
    path: `/p/wiki/concepts/${id}.md`,
    content: [
      "---",
      "type: concept",
      `title: ${title}`,
      "confidence: 0.7",
      "---",
      "",
      `# ${title}`,
    ].join("\n"),
  }
}

function fileNode(name: string, path: string): FileNode {
  return {
    name,
    path,
    is_dir: false,
    children: [],
  } as FileNode
}

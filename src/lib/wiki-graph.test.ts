import { describe, expect, it, vi, beforeEach } from "vitest"
import type { FileNode } from "@/types/wiki"
import type { RetrievalNode } from "./graph-relevance"

type LeidenCall = {
  options: {
    resolution?: number
    weighted?: boolean
  }
  weights: number[]
}

const leidenCalls = vi.hoisted((): LeidenCall[] => [])

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("./graph-relevance", () => ({
  buildRetrievalGraph: vi.fn(async () => ({ nodes: new Map(), dataVersion: 1 })),
  calculateRelevance: vi.fn(() => 1),
}))

vi.mock("@aflsolutions/graphology-communities-leiden", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@aflsolutions/graphology-communities-leiden")>()
  const wrapped = vi.fn((graph, options) => {
    const weights: number[] = []
    graph.forEachEdge((_edge: string, attributes: { weight?: number }) => {
      weights.push(attributes.weight ?? 1)
    })
    leidenCalls.push({ options, weights })
    return actual.default(graph, options)
  })
  return { default: wrapped }
})

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({ dataVersion: 1 }),
  },
}))

import { listDirectory, readFile } from "@/commands/fs"
import { buildRetrievalGraph, calculateRelevance } from "./graph-relevance"
import { buildWikiGraph } from "./wiki-graph"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockBuildRetrievalGraph = vi.mocked(buildRetrievalGraph)
const mockCalculateRelevance = vi.mocked(calculateRelevance)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockBuildRetrievalGraph.mockReset()
  mockBuildRetrievalGraph.mockResolvedValue({ nodes: new Map(), dataVersion: 1 })
  mockCalculateRelevance.mockReset()
  mockCalculateRelevance.mockReturnValue(1)
  leidenCalls.length = 0
})

describe("wiki graph", () => {
  it("includes v2 typed relationship arrays as visual graph edges", async () => {
    mockListDirectory.mockResolvedValue([
      fileNode("rag.md", "/p/wiki/concepts/rag.md"),
      fileNode("vector-search.md", "/p/wiki/concepts/vector-search.md"),
      fileNode("embedding.md", "/p/wiki/concepts/embedding.md"),
      fileNode("llm-wiki.md", "/p/wiki/concepts/llm-wiki.md"),
    ])
    mockReadFile.mockImplementation(async (path) => {
      if (path.endsWith("/rag.md")) {
        return [
          "---",
          "type: concept",
          "title: RAG",
          "uses: [vector-search]",
          "depends_on: [embedding]",
          "supports: [llm-wiki]",
          "confidence: 0.8",
          "---",
          "",
          "# RAG",
          "",
          "No wikilinks here.",
        ].join("\n")
      }
      if (path.endsWith("/vector-search.md")) return page("Vector Search")
      if (path.endsWith("/embedding.md")) return page("Embedding")
      if (path.endsWith("/llm-wiki.md")) return page("LLM Wiki")
      return ""
    })

    const graph = await buildWikiGraph("/p")

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "rag",
          target: "vector-search",
          relationshipTypes: ["uses"],
        }),
        expect.objectContaining({
          source: "rag",
          target: "embedding",
          relationshipTypes: ["depends_on"],
        }),
        expect.objectContaining({
          source: "rag",
          target: "llm-wiki",
          relationshipTypes: ["supports"],
        }),
      ]),
    )
    expect(graph.nodes.find((node) => node.id === "rag")?.linkCount).toBe(3)
  })

  it("groups strongly linked wiki neighborhoods into Leiden communities", async () => {
    mockListDirectory.mockResolvedValue([
      fileNode("alpha-1.md", "/p/wiki/concepts/alpha-1.md"),
      fileNode("alpha-2.md", "/p/wiki/concepts/alpha-2.md"),
      fileNode("alpha-3.md", "/p/wiki/concepts/alpha-3.md"),
      fileNode("beta-1.md", "/p/wiki/concepts/beta-1.md"),
      fileNode("beta-2.md", "/p/wiki/concepts/beta-2.md"),
      fileNode("beta-3.md", "/p/wiki/concepts/beta-3.md"),
    ])
    const ids = ["alpha-1", "alpha-2", "alpha-3", "beta-1", "beta-2", "beta-3"]
    mockBuildRetrievalGraph.mockResolvedValue({
      dataVersion: 1,
      nodes: new Map(ids.map((id) => [id, retrievalNode(id)])),
    })
    mockCalculateRelevance.mockImplementation((nodeA, nodeB) => {
      const communities = new Map([
        ["alpha-1", "alpha"],
        ["alpha-2", "alpha"],
        ["alpha-3", "alpha"],
        ["beta-1", "beta"],
        ["beta-2", "beta"],
        ["beta-3", "beta"],
      ])
      return communities.get(nodeA.id) === communities.get(nodeB.id) ? 10 : 0.1
    })
    mockReadFile.mockImplementation(async (path) => {
      if (path.endsWith("/alpha-1.md")) return linkedPage("Alpha 1", ["alpha-2", "alpha-3"])
      if (path.endsWith("/alpha-2.md")) return linkedPage("Alpha 2", ["alpha-1", "alpha-3"])
      if (path.endsWith("/alpha-3.md")) return linkedPage("Alpha 3", ["alpha-1", "alpha-2", "beta-1"])
      if (path.endsWith("/beta-1.md")) return linkedPage("Beta 1", ["beta-2", "beta-3", "alpha-3"])
      if (path.endsWith("/beta-2.md")) return linkedPage("Beta 2", ["beta-1", "beta-3"])
      if (path.endsWith("/beta-3.md")) return linkedPage("Beta 3", ["beta-1", "beta-2"])
      return ""
    })

    const graph = await buildWikiGraph("/p")
    const communityById = new Map(graph.nodes.map((node) => [node.id, node.community]))
    const alphaCommunity = communityById.get("alpha-1")
    const betaCommunity = communityById.get("beta-1")

    expect(new Set(graph.nodes.map((node) => node.community))).toEqual(new Set([0, 1]))
    expect(alphaCommunity).not.toBe(betaCommunity)
    expect(communityById.get("alpha-2")).toBe(alphaCommunity)
    expect(communityById.get("alpha-3")).toBe(alphaCommunity)
    expect(communityById.get("beta-2")).toBe(betaCommunity)
    expect(communityById.get("beta-3")).toBe(betaCommunity)
    expect(graph.communities).toEqual([
      expect.objectContaining({ id: 0, nodeCount: 3, cohesion: 1 }),
      expect.objectContaining({ id: 1, nodeCount: 3, cohesion: 1 }),
    ])
    expect(leidenCalls).toHaveLength(1)
    expect(leidenCalls[0].options).toMatchObject({ resolution: 1, weighted: true })
    expect(leidenCalls[0].weights).toEqual(expect.arrayContaining([10, 0.1]))
  })
})

function fileNode(name: string, path: string): FileNode {
  return {
    name,
    path,
    is_dir: false,
    children: [],
  } as FileNode
}

function page(title: string): string {
  return ["---", "type: concept", `title: ${title}`, "---", "", `# ${title}`].join("\n")
}

function linkedPage(title: string, links: string[]): string {
  return [
    "---",
    "type: concept",
    `title: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
    ...links.map((link) => `[[${link}]]`),
  ].join("\n")
}

function retrievalNode(id: string): RetrievalNode {
  return {
    id,
    title: id,
    type: "concept",
    path: `/p/wiki/concepts/${id}.md`,
    sources: [],
    outLinks: new Set(),
    inLinks: new Set(),
  }
}

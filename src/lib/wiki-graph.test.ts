import { describe, expect, it, vi, beforeEach } from "vitest"
import type { FileNode } from "@/types/wiki"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("./graph-relevance", () => ({
  buildRetrievalGraph: vi.fn(async () => ({ nodes: new Map(), dataVersion: 1 })),
  calculateRelevance: vi.fn(() => 1),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({ dataVersion: 1 }),
  },
}))

import { listDirectory, readFile } from "@/commands/fs"
import { buildWikiGraph } from "./wiki-graph"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
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

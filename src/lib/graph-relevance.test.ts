import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"
import { buildRetrievalGraph, clearGraphCache } from "./graph-relevance"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  clearGraphCache()
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
})

describe("retrieval graph", () => {
  it("caches graphs by project path and data version", async () => {
    const projectAPath = "/project-a/wiki/concepts/a.md"
    const projectBPath = "/project-b/wiki/concepts/b.md"

    mockListDirectory.mockImplementation(async (wikiRoot) => {
      if (wikiRoot === "/project-a/wiki") return [fileNode("a.md", projectAPath)]
      if (wikiRoot === "/project-b/wiki") return [fileNode("b.md", projectBPath)]
      return []
    })
    mockReadFile.mockImplementation(async (filePath) => {
      if (filePath === projectAPath) return page("Project A")
      if (filePath === projectBPath) return page("Project B")
      return ""
    })

    const graphA = await buildRetrievalGraph("/project-a", 1)
    const graphAAgain = await buildRetrievalGraph("/project-a", 1)
    const graphB = await buildRetrievalGraph("/project-b", 1)

    expect(graphAAgain).toBe(graphA)
    expect(graphA.nodes.has("a")).toBe(true)
    expect(graphB.nodes.has("b")).toBe(true)
    expect(graphB.nodes.has("a")).toBe(false)
    expect(mockListDirectory).toHaveBeenCalledTimes(2)
  })
})

function page(title: string): string {
  return [
    "---",
    "type: concept",
    `title: ${title}`,
    "---",
    "",
    `# ${title}`,
  ].join("\n")
}

function fileNode(name: string, path: string): FileNode {
  return {
    name,
    path,
    is_dir: false,
    children: [],
  } as FileNode
}

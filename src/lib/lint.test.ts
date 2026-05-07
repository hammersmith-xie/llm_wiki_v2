import { describe, it, expect, beforeEach, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"

// Mock LLM + Tauri FS — the lint runner also touches the activity store
// (we leave that real so we can assert status transitions).
vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
}))

import { runSemanticLint, runStructuralLint } from "./lint"
import { streamChat } from "./llm-client"
import { readFile, listDirectory } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"

const mockStreamChat = vi.mocked(streamChat)
const mockReadFile = vi.mocked(readFile)
const mockListDirectory = vi.mocked(listDirectory)

function fakeLlmConfig(): LlmConfig {
  return {
    provider: "openai",
    apiKey: "k",
    model: "m",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 128000,
  }
}

function makeFileNode(name: string, content: string): { node: FileNode; content: string } {
  return {
    node: {
      name,
      path: `/project/wiki/${name}`,
      is_dir: false,
      children: [],
    } as FileNode,
    content,
  }
}

beforeEach(() => {
  mockStreamChat.mockReset()
  mockReadFile.mockReset()
  mockListDirectory.mockReset()
  useWikiStore.getState().setOutputLanguage("auto")
  useActivityStore.setState({ items: [] })
})

describe("runSemanticLint — language directive", () => {
  it("uses explicit user setting", async () => {
    const pages = [
      makeFileNode("a.md", "Page A content here"),
      makeFileNode("b.md", "Page B content here"),
    ]
    mockListDirectory.mockResolvedValue(pages.map((p) => p.node))
    mockReadFile.mockImplementation(async (path) => {
      const match = pages.find((p) => p.node.path === path)
      return match?.content ?? ""
    })
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onToken("")
      cb.onDone()
    })

    useWikiStore.getState().setOutputLanguage("Korean")
    await runSemanticLint("/project", fakeLlmConfig())

    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
  })

  it("auto mode detects from the concatenated page summaries", async () => {
    const cjkContent = "这是一篇关于注意力机制和神经网络的长中文页面"
    const pages = [
      makeFileNode("attention.md", cjkContent),
      makeFileNode("transformer.md", cjkContent),
    ]
    mockListDirectory.mockResolvedValue(pages.map((p) => p.node))
    mockReadFile.mockImplementation(async (path) => {
      const match = pages.find((p) => p.node.path === path)
      return match?.content ?? ""
    })
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onToken("")
      cb.onDone()
    })

    useWikiStore.getState().setOutputLanguage("auto")
    await runSemanticLint("/project", fakeLlmConfig())

    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Chinese")
  })

  it("explicit setting wins over source language", async () => {
    const pages = [makeFileNode("x.md", "これは日本語の内容です")]
    mockListDirectory.mockResolvedValue(pages.map((p) => p.node))
    mockReadFile.mockResolvedValue(pages[0].content)
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onToken("")
      cb.onDone()
    })

    useWikiStore.getState().setOutputLanguage("English")
    await runSemanticLint("/project", fakeLlmConfig())

    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: English")
    expect(prompt).not.toContain("MANDATORY OUTPUT LANGUAGE: Japanese")
  })

  it("documents v2 lifecycle and typed relationship lint signals", async () => {
    const page = makeFileNode("deep-research.md", [
      "---",
      "type: concept",
      "title: Deep Research",
      "lifecycle: semantic",
      "review_status: needs-review",
      "uses: [tavily]",
      "---",
      "",
      "# Deep Research",
    ].join("\n"))
    mockListDirectory.mockResolvedValue([page.node])
    mockReadFile.mockResolvedValue(page.content)
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onDone()
    })

    await runSemanticLint("/project", fakeLlmConfig())

    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("LLM Wiki v2 metadata")
    expect(prompt).toContain("lifecycle, confidence, review_status")
    expect(prompt).toContain("uses, depends_on, contradicts, supports, supersedes, superseded_by")
  })
})

describe("runStructuralLint — lifecycle metadata", () => {
  it("emits lifecycle semantic warnings for superseded pages", async () => {
    const page = makeFileNode("old.md", [
      "---",
      "type: concept",
      "title: Old",
      "sources: [old.md]",
      "superseded_by: [new]",
      "---",
      "",
      "# Old",
      "",
      "[[new]]",
    ].join("\n"))
    const target = makeFileNode("new.md", "---\ntype: concept\ntitle: New\n---\n\n# New\n\n[[old]]")
    mockListDirectory.mockResolvedValue([page.node, target.node])
    mockReadFile.mockImplementation(async (path) => {
      if (path === page.node.path) return page.content
      if (path === target.node.path) return target.content
      return ""
    })

    const out = await runStructuralLint("/project")

    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "semantic",
          severity: "warning",
          page: "old.md",
          detail: expect.stringContaining("[superseded]"),
        }),
      ]),
    )
  })
})

describe("runStructuralLint — v2 frontmatter relationships", () => {
  it("treats typed relationship arrays as outbound and inbound links", async () => {
    const source = makeFileNode("deep-research.md", [
      "---",
      "type: concept",
      "title: Deep Research",
      "uses: [tavily]",
      "---",
      "",
      "# Deep Research",
      "",
      "No body wikilinks here.",
    ].join("\n"))
    const target = makeFileNode("tavily.md", [
      "---",
      "type: entity",
      "title: Tavily",
      "---",
      "",
      "# Tavily",
      "",
      "[[deep-research]]",
    ].join("\n"))
    mockListDirectory.mockResolvedValue([source.node, target.node])
    mockReadFile.mockImplementation(async (path) => {
      if (path === source.node.path) return source.content
      if (path === target.node.path) return target.content
      return ""
    })

    const out = await runStructuralLint("/project")

    expect(out).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "no-outlinks", page: "deep-research.md" }),
        expect.objectContaining({ type: "orphan", page: "tavily.md" }),
      ]),
    )
  })

  it("resolves frontmatter relationship refs through target title and alias metadata", async () => {
    const source = makeFileNode("deep-research.md", [
      "---",
      "type: concept",
      "title: Deep Research",
      "uses: [tavily]",
      "---",
      "",
      "# Deep Research",
    ].join("\n"))
    const target = makeFileNode("tavily-api.md", [
      "---",
      "type: entity",
      "title: Tavily Search API",
      "aliases: [tavily]",
      "---",
      "",
      "# Tavily Search API",
    ].join("\n"))
    mockListDirectory.mockResolvedValue([source.node, target.node])
    mockReadFile.mockImplementation(async (path) => {
      if (path === source.node.path) return source.content
      if (path === target.node.path) return target.content
      return ""
    })

    const out = await runStructuralLint("/project")

    expect(out).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "broken-link", page: "deep-research.md" }),
        expect.objectContaining({ type: "orphan", page: "tavily-api.md" }),
      ]),
    )
  })
})

describe("runSemanticLint — activity & early returns", () => {
  it("logs a running activity item and marks done", async () => {
    mockListDirectory.mockResolvedValue([makeFileNode("a.md", "content").node])
    mockReadFile.mockResolvedValue("content")
    mockStreamChat.mockImplementation(async (_c, _m, cb) => {
      cb.onDone()
    })

    await runSemanticLint("/project", fakeLlmConfig())
    const items = useActivityStore.getState().items
    expect(items).toHaveLength(1)
    // Final state after run completes
    expect(items[0].type).toBe("lint")
    expect(["done", "error"]).toContain(items[0].status)
  })

  it("returns empty and marks done when wiki has no pages", async () => {
    mockListDirectory.mockResolvedValue([])

    const result = await runSemanticLint("/project", fakeLlmConfig())
    expect(result).toEqual([])
    expect(mockStreamChat).not.toHaveBeenCalled()

    const items = useActivityStore.getState().items
    expect(items[0].detail).toMatch(/no wiki pages/i)
  })

  it("marks error status when wiki directory read fails", async () => {
    mockListDirectory.mockRejectedValue(new Error("ENOENT"))
    await runSemanticLint("/project", fakeLlmConfig())
    const items = useActivityStore.getState().items
    expect(items[0].status).toBe("error")
  })
})

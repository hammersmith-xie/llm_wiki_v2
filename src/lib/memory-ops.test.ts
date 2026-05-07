import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"
import { scanMemoryOpsProject } from "./memory-ops"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
})

describe("memory ops project scanner", () => {
  it("returns a stable empty snapshot when wiki and state files are missing", async () => {
    mockListDirectory.mockRejectedValue(new Error("missing wiki"))
    mockReadFile.mockRejectedValue(new Error("missing state"))

    const snapshot = await scanMemoryOpsProject("/project", { dataVersion: 7 })

    expect(snapshot.projectPath).toBe("/project")
    expect(snapshot.dataVersion).toBe(7)
    expect(snapshot.pages).toEqual([])
    expect(snapshot.graph.nodes.size).toBe(0)
    expect(snapshot.audit.events).toEqual([])
    expect(snapshot.audit.warnings).toEqual([])
    expect(snapshot.reviewItems).toEqual([])
    expect(snapshot.conversations).toEqual([])
    expect(snapshot.chatMessages).toEqual([])
    expect(snapshot.stats).toMatchObject({
      pageCount: 0,
      reviewItemCount: 0,
      chatMessageCount: 0,
      auditEventCount: 0,
    })
    expect(mockListDirectory.mock.calls.map((call) => call[0])).toEqual(["/project/wiki"])
  })

  it("scans wiki pages, typed graph, review items, chat summaries, and audit warnings", async () => {
    const wikiTree: FileNode[] = [
      {
        name: "concepts",
        path: "/project/wiki/concepts",
        is_dir: true,
        children: [
          {
            name: "attention.md",
            path: "/project/wiki/concepts/attention.md",
            is_dir: false,
          },
        ],
      },
    ]
    mockListDirectory.mockImplementation(async (path) => {
      if (path.includes("/raw/")) throw new Error("scanner must not read raw sources")
      if (path === "/project/wiki") return wikiTree
      throw new Error(`unexpected listDirectory ${path}`)
    })
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/concepts/attention.md") {
        return [
          "---",
          "type: concept",
          "title: Attention",
          "uses: [transformer]",
          "confidence: 0.8",
          "---",
          "",
          "# Attention",
        ].join("\n")
      }
      if (path === "/project/.llm-wiki/audit.jsonl") {
        return [
          "{\"timestamp\":\"2026-05-07T00:00:00.000Z\",\"action\":\"ingest.write\",\"targetPath\":\"wiki/concepts/attention.md\"}",
          "not-json",
          "",
        ].join("\n")
      }
      if (path === "/project/.llm-wiki/review.json") {
        return JSON.stringify([
          {
            id: "review-1",
            type: "suggestion",
            title: "Review Attention",
            description: "Check stale claim",
            options: [],
            resolved: false,
            createdAt: 1,
          },
        ])
      }
      if (path === "/project/.llm-wiki/conversations.json") {
        return JSON.stringify([
          { id: "conv-1", title: "Attention", createdAt: 1, updatedAt: 2 },
        ])
      }
      if (path === "/project/.llm-wiki/chats/conv-1.json") {
        return JSON.stringify([
          {
            id: "msg-1",
            role: "assistant",
            content: "Answer",
            timestamp: 2,
            conversationId: "conv-1",
            references: [{ title: "Attention", path: "/project/wiki/concepts/attention.md" }],
          },
        ])
      }
      throw new Error(`unexpected readFile ${path}`)
    })

    const snapshot = await scanMemoryOpsProject("/project", { dataVersion: 42 })

    expect(snapshot.pages.map((page) => page.id)).toEqual(["attention"])
    expect(snapshot.graph.nodes.get("attention")).toMatchObject({
      title: "Attention",
      type: "concept",
    })
    expect(snapshot.audit.events).toHaveLength(1)
    expect(snapshot.audit.warnings).toEqual([
      expect.objectContaining({ line: 2 }),
    ])
    expect(snapshot.reviewItems).toHaveLength(1)
    expect(snapshot.conversations).toHaveLength(1)
    expect(snapshot.chatMessages).toHaveLength(1)
    expect(snapshot.stats).toMatchObject({
      pageCount: 1,
      reviewItemCount: 1,
      chatMessageCount: 1,
      auditEventCount: 1,
      auditWarningCount: 1,
    })
  })
})

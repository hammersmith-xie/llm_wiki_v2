import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"
import { scanMemoryOpsProject, runMemoryOpsPatrol } from "./memory-ops"
import { useActivityStore } from "@/stores/activity-store"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
}))

import { appendFile, createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"

const mockAppendFile = vi.mocked(appendFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockCreateDirectory.mockReset()
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  useActivityStore.setState({ items: [] })
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

  it("runs a patrol, records activity, and appends an audit summary", async () => {
    mockListDirectory.mockResolvedValue([
      {
        name: "old.md",
        path: "/project/wiki/concepts/old.md",
        is_dir: false,
      },
    ])
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/concepts/old.md") {
        return [
          "---",
          "type: concept",
          "title: Old",
          "sources: [paper.md]",
          "last_confirmed: 2025-01-01",
          "---",
          "",
          "# Old",
        ].join("\n")
      }
      if (path === "/project/.llm-wiki/audit.jsonl") return ""
      throw new Error(`missing ${path}`)
    })

    const report = await runMemoryOpsPatrol("/project", {
      dataVersion: 9,
      today: "2026-05-07",
    })

    expect(report.snapshot.dataVersion).toBe(9)
    expect(report.suggestions).toHaveLength(1)
    expect(report.stats.suggestionCount).toBe(1)
    expect(useActivityStore.getState().items[0]).toMatchObject({
      type: "maintenance",
      title: "Memory Ops patrol",
      status: "done",
    })
    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"memory_ops.patrol\""),
    )
  })

  it("marks the patrol activity as error when audit writing fails", async () => {
    mockListDirectory.mockResolvedValue([])
    mockReadFile.mockRejectedValue(new Error("missing"))
    mockAppendFile.mockRejectedValueOnce(new Error("disk full"))

    await expect(runMemoryOpsPatrol("/project")).rejects.toThrow("disk full")

    expect(useActivityStore.getState().items[0]).toMatchObject({
      type: "maintenance",
      title: "Memory Ops patrol",
      status: "error",
      detail: expect.stringContaining("disk full"),
    })
  })
})

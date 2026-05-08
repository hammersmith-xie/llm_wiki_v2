import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
  createDirectory: vi.fn(),
}))

vi.mock("@/lib/wiki-automation-events", () => ({
  recordWikiAutomationEvent: vi.fn(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  })),
}))

import { appendFile, readFile, writeFile, listDirectory, createDirectory } from "@/commands/fs"
import { streamChat } from "./llm-client"
import { executeIngestWrites } from "./ingest"
import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"

const mockAppendFile = vi.mocked(appendFile)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockListDirectory = vi.mocked(listDirectory)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockStreamChat = vi.mocked(streamChat)
const mockRecordWikiAutomationEvent = vi.mocked(recordWikiAutomationEvent)

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

beforeEach(() => {
  mockAppendFile.mockReset()
  mockAppendFile.mockResolvedValue(undefined as unknown as void)
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockListDirectory.mockReset()
  mockCreateDirectory.mockReset()
  mockStreamChat.mockReset()
  mockReadFile.mockRejectedValue(new Error("ENOENT"))
  mockWriteFile.mockResolvedValue(undefined as unknown as void)
  mockListDirectory.mockResolvedValue([])
  mockCreateDirectory.mockResolvedValue(undefined as unknown as void)
  mockRecordWikiAutomationEvent.mockReset()
  mockRecordWikiAutomationEvent.mockImplementation(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  }))
  useChatStore.setState({
    conversations: [{ id: "c1", title: "Chat", createdAt: 0, updatedAt: 0 }],
    activeConversationId: "c1",
    messages: [],
    isStreaming: false,
    streamingContent: "",
    mode: "chat",
    ingestSource: null,
  })
  useReviewStore.setState({ items: [] })
})

describe("executeIngestWrites", () => {
  it("routes chat FILE-block writes through v2 lifecycle enrichment", async () => {
    mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken([
        "---FILE: wiki/concepts/chat-written.md---",
        "---",
        "type: concept",
        "title: Chat Written",
        "created: 2026-05-07",
        "updated: 2026-05-07",
        "tags: []",
        "related: []",
        "sources: []",
        "---",
        "",
        "# Chat Written",
        "",
        "Conclusion: chat-written pages should preserve claim-level evidence.",
        "---END FILE---",
      ].join("\n"))
      callbacks.onDone()
    })

    const writtenPaths = await executeIngestWrites("/project", fakeLlmConfig())

    expect(writtenPaths).toEqual(["/project/wiki/concepts/chat-written.md"])
    const pageWrite = mockWriteFile.mock.calls.find(
      ([path]) => path === "/project/wiki/concepts/chat-written.md",
    )
    expect(pageWrite?.[1]).toContain("lifecycle: semantic")
    expect(pageWrite?.[1]).toContain("<!-- claim:")
    expect(pageWrite?.[1]).toContain("confidence:")
    expect(pageWrite?.[1]).toContain("review_status:")
    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "memory.write",
        projectPath: "/project",
        targetPath: "wiki/concepts/chat-written.md",
        pagePath: "wiki/concepts/chat-written.md",
        status: "applied",
      }),
    )
    const claimCall = mockAppendFile.mock.calls.find(([path]) => path === "/project/.llm-wiki/claims.jsonl")
    expect(claimCall?.[1]).toContain("chat-written pages should preserve claim-level evidence")
  })

  it("does not generate claims for listing pages and does not block on claim write failure", async () => {
    mockAppendFile.mockImplementation(async (path) => {
      if (path === "/project/.llm-wiki/claims.jsonl") throw new Error("claim disk full")
    })
    mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken([
        "---FILE: wiki/index.md---",
        "# Wiki Index",
        "",
        "Conclusion: listing pages should not become claim sources.",
        "---END FILE---",
        "---FILE: wiki/concepts/claimable.md---",
        "---",
        "type: concept",
        "title: Claimable",
        "created: 2026-05-07",
        "updated: 2026-05-07",
        "tags: []",
        "related: []",
        "sources: []",
        "---",
        "",
        "# Claimable",
        "",
        "Finding: claim write failure should not block ingest writes.",
        "---END FILE---",
      ].join("\n"))
      callbacks.onDone()
    })

    const writtenPaths = await executeIngestWrites("/project", fakeLlmConfig())

    expect(writtenPaths).toEqual([
      "/project/wiki/index.md",
      "/project/wiki/concepts/claimable.md",
    ])
    const indexWrite = mockWriteFile.mock.calls.find(([path]) => path === "/project/wiki/index.md")
    expect(indexWrite?.[1]).not.toContain("<!-- claim:")
    const contentWrite = mockWriteFile.mock.calls.find(([path]) => path === "/project/wiki/concepts/claimable.md")
    expect(contentWrite?.[1]).toContain("<!-- claim:")
  })

  it("skips risky content page writes when pre-write conflict evidence requires review", async () => {
    const existingPage = [
      "---",
      "type: concept",
      "title: Risky",
      "created: 2026-05-07",
      "updated: 2026-05-07",
      "tags: []",
      "related: []",
      "sources: []",
      "---",
      "",
      "# Risky",
      "",
      "Existing content should survive.",
    ].join("\n")
    const contradictedClaim = {
      claim_id: "claim_old",
      text: "Risky writes should be reviewed before landing.",
      page_path: "wiki/concepts/risky.md",
      source_refs: [],
      lifecycle: "semantic",
      status: "contradicted",
      confidence: "0.30",
      confidence_reasons: ["contradiction signal present"],
      last_confirmed: "2026-05-07",
      reinforcement_count: "0",
      supports: [],
      contradicts: [],
      supersedes: [],
      superseded_by: [],
      scope: "shared",
      created_at: "2026-05-07",
      updated_at: "2026-05-07",
    }
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/schema.md" || path === "/project/wiki/index.md") return ""
      if (path === "/project/wiki/concepts/risky.md") return existingPage
      if (path === "/project/.llm-wiki/claims.jsonl") return `${JSON.stringify(contradictedClaim)}\n`
      return ""
    })
    mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken([
        "---FILE: wiki/concepts/risky.md---",
        "---",
        "type: concept",
        "title: Risky",
        "created: 2026-05-08",
        "updated: 2026-05-08",
        "tags: []",
        "related: []",
        "sources: []",
        "---",
        "",
        "# Risky",
        "",
        "Finding: Risky writes should be reviewed before landing.",
        "---END FILE---",
        "---FILE: wiki/concepts/safe.md---",
        "---",
        "type: concept",
        "title: Safe",
        "created: 2026-05-08",
        "updated: 2026-05-08",
        "tags: []",
        "related: []",
        "sources: []",
        "---",
        "",
        "# Safe",
        "",
        "Finding: safe writes should still land.",
        "---END FILE---",
      ].join("\n"))
      callbacks.onDone()
    })

    const writtenPaths = await executeIngestWrites("/project", fakeLlmConfig())

    expect(writtenPaths).toEqual(["/project/wiki/concepts/safe.md"])
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      "/project/wiki/concepts/risky.md",
      expect.any(String),
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/wiki/concepts/safe.md",
      expect.stringContaining("safe writes should still land"),
    )
    const reviewItems = useReviewStore.getState().items
    expect(reviewItems).toHaveLength(1)
    expect(reviewItems[0]).toMatchObject({
      type: "contradiction",
      title: "Pre-write conflict: wiki/concepts/risky.md",
      affectedPages: ["wiki/concepts/risky.md"],
    })
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"conflict.preview\""),
    )
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"conflict.review\""),
    )
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"conflict.accept\""),
    )
    const reviewAudit = mockAppendFile.mock.calls.find(([, contents]) =>
      String(contents).includes("\"action\":\"conflict.review\"")
    )
    expect(reviewAudit?.[1]).toContain("\"reviewItemId\":\"review-")
  })
})

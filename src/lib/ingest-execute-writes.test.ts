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

import { appendFile, readFile, writeFile, createDirectory } from "@/commands/fs"
import { streamChat } from "./llm-client"
import { executeIngestWrites } from "./ingest"
import { useChatStore } from "@/stores/chat-store"
import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"

const mockAppendFile = vi.mocked(appendFile)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
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
  mockCreateDirectory.mockReset()
  mockStreamChat.mockReset()
  mockReadFile.mockRejectedValue(new Error("ENOENT"))
  mockWriteFile.mockResolvedValue(undefined as unknown as void)
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
})

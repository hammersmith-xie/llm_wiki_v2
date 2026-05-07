import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
  createDirectory: vi.fn(),
}))

import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { streamChat } from "./llm-client"
import { executeIngestWrites } from "./ingest"
import { useChatStore } from "@/stores/chat-store"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockStreamChat = vi.mocked(streamChat)

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
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockCreateDirectory.mockReset()
  mockStreamChat.mockReset()
  mockReadFile.mockRejectedValue(new Error("ENOENT"))
  mockWriteFile.mockResolvedValue(undefined as unknown as void)
  mockCreateDirectory.mockResolvedValue(undefined as unknown as void)
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
        "Generated from a chat discussion.",
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
    expect(pageWrite?.[1]).toContain("confidence:")
    expect(pageWrite?.[1]).toContain("review_status:")
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  recordChatSessionEnd,
  recordChatSessionStart,
} from "./chat-session-events"

vi.mock("@/lib/wiki-automation-events", () => ({
  recordWikiAutomationEvent: vi.fn(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  })),
}))

import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"

const mockRecordWikiAutomationEvent = vi.mocked(recordWikiAutomationEvent)

beforeEach(() => {
  mockRecordWikiAutomationEvent.mockReset()
  mockRecordWikiAutomationEvent.mockImplementation(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  }))
})

describe("chat session automation events", () => {
  it("records session start without marking maintenance dirty", async () => {
    await recordChatSessionStart({
      projectPath: "/project",
      conversationId: "conv-1",
      reason: "sidebar new chat",
    })

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith({
      type: "session.start",
      projectPath: "/project",
      actor: "user",
      status: "applied",
      reasons: ["conversation created", "sidebar new chat"],
      summary: {
        conversationId: "conv-1",
        messageCount: 0,
      },
      maintenance: false,
    })
  })

  it("records session end with response summary only", async () => {
    await recordChatSessionEnd({
      projectPath: "/project",
      conversationId: "conv-1",
      messageCount: 4,
      referencedPageCount: 2,
    })

    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith({
      type: "session.end",
      projectPath: "/project",
      actor: "system",
      status: "applied",
      reasons: ["assistant response completed"],
      summary: {
        conversationId: "conv-1",
        messageCount: 4,
        referencedPageCount: 2,
      },
      maintenance: false,
    })
  })

  it("skips recording when no project is open", async () => {
    await recordChatSessionStart({
      projectPath: null,
      conversationId: "conv-1",
    })

    expect(mockRecordWikiAutomationEvent).not.toHaveBeenCalled()
  })
})

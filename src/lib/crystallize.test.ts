import { describe, expect, it, vi, beforeEach } from "vitest"
import { writeCrystallizedQueryPage } from "./crystallize"
import { writeConfirmedCrystallizationCandidate } from "./crystallize-candidates"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
}))

vi.mock("@/lib/wiki-automation-events", () => ({
  recordWikiAutomationEvent: vi.fn(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  })),
}))

import { appendFile, readFile, writeFile, createDirectory } from "@/commands/fs"
import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"

const mockAppendFile = vi.mocked(appendFile)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockRecordWikiAutomationEvent = vi.mocked(recordWikiAutomationEvent)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockCreateDirectory.mockReset()
  mockRecordWikiAutomationEvent.mockReset()
  mockRecordWikiAutomationEvent.mockImplementation(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  }))
})

describe("writeCrystallizedQueryPage", () => {
  it("writes lifecycle metadata, typed supports links, source refs, and an audit event", async () => {
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/sources/paper.md") {
        return "---\ntype: source\nsources: [paper.pdf]\n---\n\n# Paper"
      }
      if (path === "/project/.llm-wiki/audit.jsonl") return ""
      return ""
    })

    const result = await writeCrystallizedQueryPage({
      projectPath: "/project",
      filePath: "/project/wiki/queries/answer.md",
      title: "Answer",
      body: "# Answer\n\nContent",
      date: "2026-05-06",
      origin: "chat-save",
      tags: ["research"],
      references: [
        { title: "Attention", path: "/project/wiki/concepts/attention.md" },
        { title: "Paper", path: "/project/wiki/sources/paper.md" },
        { title: "Raw", path: "/project/raw/sources/raw-note.pdf" },
      ],
    })

    expect(result.relativePath).toBe("wiki/queries/answer.md")
    expect(result.supports).toEqual(["attention", "paper"])
    expect(result.sources).toEqual(["paper.pdf", "raw-note.pdf"])

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/wiki/queries/answer.md",
      expect.stringContaining("supports: [\"attention\", \"paper\"]"),
    )
    const pageContent = mockWriteFile.mock.calls[0][1]
    expect(pageContent).toContain("lifecycle: episodic")
    expect(pageContent).toContain('confidence: "')
    expect(pageContent).toContain('origin: "chat-save"')
    expect(pageContent).toContain('reinforcement_count: "2"')

    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"crystallize.query\""),
    )
    const auditCall = mockAppendFile.mock.calls.find(([path]) => path === "/project/.llm-wiki/audit.jsonl")
    const auditEvent = JSON.parse(String(auditCall?.[1]))
    expect(auditEvent).toMatchObject({
      schemaVersion: 1,
      category: "crystallize",
      action: "crystallize.query",
      actor: "system",
      pagePath: "wiki/queries/answer.md",
    })
    expect(mockRecordWikiAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "memory.write",
        projectPath: "/project",
        targetPath: "wiki/queries/answer.md",
        pagePath: "wiki/queries/answer.md",
        status: "applied",
      }),
    )
  })

  it("records candidate score and reasons in the crystallize audit event", async () => {
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/.llm-wiki/audit.jsonl") return ""
      return ""
    })

    await writeCrystallizedQueryPage({
      projectPath: "/project",
      filePath: "/project/wiki/queries/candidate.md",
      title: "Candidate",
      body: "# Candidate\n\nContent with [[evidence]].",
      date: "2026-05-07",
      origin: "chat-save",
      tags: [],
      candidate: {
        origin: "chat",
        sourceId: "m-1",
        score: 0.84,
        reasons: ["2 explicit references", "contains conclusion signal"],
        dedupeKey: "content:abc123",
      },
    })

    const auditCall = mockAppendFile.mock.calls.find(([path]) => path === "/project/.llm-wiki/audit.jsonl")
    expect(auditCall?.[1]).toContain('"candidate"')
    expect(auditCall?.[1]).toContain('"score":0.84')
    expect(auditCall?.[1]).toContain('"contains conclusion signal"')
    expect(auditCall?.[1]).toContain('"dedupeKey":"content:abc123"')
  })

  it("writes a confirmed candidate through the existing crystallized query path", async () => {
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/.llm-wiki/audit.jsonl") return ""
      return ""
    })

    const result = await writeConfirmedCrystallizationCandidate({
      projectPath: "/project",
      filePath: "/project/wiki/queries/retrieval-notes.md",
      date: "2026-05-07",
      candidate: {
        id: "crystallize:chat:m-1",
        origin: "chat",
        sourceId: "m-1",
        title: "Retrieval Notes",
        content: "# Retrieval Notes\n\n## Conclusion\nSave this cited answer.",
        score: 0.72,
        reasons: ["1 explicit reference", "contains conclusion signal"],
        references: [{ title: "Search", path: "/project/wiki/concepts/search.md" }],
        tags: ["chat"],
        dedupeKey: "content:retrieval",
        timestamp: 1,
      },
    })

    expect(result.relativePath).toBe("wiki/queries/retrieval-notes.md")
    expect(result.supports).toEqual(["search"])
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/wiki/queries/retrieval-notes.md",
      expect.stringContaining('origin: "chat-candidate"'),
    )
    const auditCall = mockAppendFile.mock.calls.find(([path]) => path === "/project/.llm-wiki/audit.jsonl")
    expect(auditCall?.[1]).toContain('"candidate"')
    expect(auditCall?.[1]).toContain('"sourceId":"m-1"')
  })
})

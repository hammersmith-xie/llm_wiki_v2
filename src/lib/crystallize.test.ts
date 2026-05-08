import { describe, expect, it, vi, beforeEach } from "vitest"
import { writeCrystallizedQueryPage } from "./crystallize"
import { writeConfirmedCrystallizationCandidate } from "./crystallize-candidates"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => {}),
  listDirectory: vi.fn(async () => []),
  createDirectory: vi.fn(async () => {}),
}))

vi.mock("@/lib/wiki-automation-events", () => ({
  recordWikiAutomationEvent: vi.fn(async (input) => ({
    action: input.type,
    auditEvent: { action: input.type },
  })),
}))

import { appendFile, readFile, writeFile, listDirectory, createDirectory } from "@/commands/fs"
import { recordWikiAutomationEvent } from "@/lib/wiki-automation-events"

const mockAppendFile = vi.mocked(appendFile)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockListDirectory = vi.mocked(listDirectory)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockRecordWikiAutomationEvent = vi.mocked(recordWikiAutomationEvent)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockListDirectory.mockReset()
  mockListDirectory.mockResolvedValue([])
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

  it("writes claim anchors and claim records for claim-friendly saved pages", async () => {
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/.llm-wiki/audit.jsonl") return ""
      return ""
    })

    const result = await writeCrystallizedQueryPage({
      projectPath: "/project",
      filePath: "/project/wiki/queries/claim-save.md",
      title: "Claim Save",
      body: [
        "# Claim Save",
        "",
        "Conclusion: hybrid retrieval should expose token, BM25, vector, and graph streams separately.",
      ].join("\n"),
      date: "2026-05-08",
      origin: "chat-save",
      tags: ["research"],
      references: [{ title: "Search", path: "/project/wiki/concepts/search.md" }],
    })

    expect(result.claimWrite).toMatchObject({ claimCount: 1, warnings: [] })
    const pageContent = mockWriteFile.mock.calls[0][1]
    expect(pageContent).toContain("<!-- claim:")
    expect(pageContent).toContain('supports: ["search"]')
    expect(pageContent).toContain('reinforcement_count: "1"')

    const claimCall = mockAppendFile.mock.calls.find(([path]) => path === "/project/.llm-wiki/claims.jsonl")
    expect(claimCall?.[1]).toContain("hybrid retrieval should expose token")
    expect(claimCall?.[1]).toContain("\"page_path\":\"wiki/queries/claim-save.md\"")
    const claimAuditCall = mockAppendFile.mock.calls.find(([, contents]) =>
      String(contents).includes("\"action\":\"claim.write\""),
    )
    expect(claimAuditCall?.[1]).toContain("\"claimCount\":1")
  })

  it("does not block page save when claim index write fails", async () => {
    mockAppendFile.mockImplementation(async (path) => {
      if (path === "/project/.llm-wiki/claims.jsonl") throw new Error("disk full")
    })

    const result = await writeCrystallizedQueryPage({
      projectPath: "/project",
      filePath: "/project/wiki/queries/claim-warning.md",
      title: "Claim Warning",
      body: "Finding: claim write failure should not block the saved page.",
      date: "2026-05-08",
      origin: "chat-save",
    })

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/wiki/queries/claim-warning.md",
      expect.stringContaining("Finding: claim write failure should not block"),
    )
    expect(result.claimWrite?.error).toContain("disk full")
    expect(result.claimWrite?.claimCount).toBe(1)
  })

  it("returns review-only conflict result instead of overwriting risky crystallized pages", async () => {
    const existingPage = "# Existing\n\nKeep this page."
    const contradictedClaim = {
      claim_id: "claim_old",
      text: "Crystallized writes should be reviewed before replacing disputed knowledge.",
      page_path: "wiki/queries/risky.md",
      source_refs: [],
      lifecycle: "episodic",
      status: "contradicted",
      confidence: "0.30",
      confidence_reasons: ["contradiction signal present"],
      last_confirmed: "2026-05-08",
      reinforcement_count: "0",
      supports: [],
      contradicts: [],
      supersedes: [],
      superseded_by: [],
      scope: "shared",
      created_at: "2026-05-08",
      updated_at: "2026-05-08",
    }
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/queries/risky.md") return existingPage
      if (path === "/project/.llm-wiki/claims.jsonl") return `${JSON.stringify(contradictedClaim)}\n`
      return ""
    })

    const result = await writeCrystallizedQueryPage({
      projectPath: "/project",
      filePath: "/project/wiki/queries/risky.md",
      title: "Risky",
      body: "Finding: Crystallized writes should be reviewed before replacing disputed knowledge.",
      date: "2026-05-08",
      origin: "chat-save",
    })

    expect(result.conflict?.decision).toBe("review-only")
    expect(result.conflict?.classification).toBe("possible-contradiction")
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      "/project/wiki/queries/risky.md",
      expect.any(String),
    )
    expect(result.claimWrite).toBeUndefined()
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

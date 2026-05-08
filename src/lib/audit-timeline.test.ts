import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendAuditEvent,
  filterAuditEvents,
  readAuditTimeline,
} from "./audit-timeline"
import { appendLifecycleAuditEvent } from "./lifecycle"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => {}),
}))

import { appendFile, createDirectory, readFile, writeFile } from "@/commands/fs"

const mockAppendFile = vi.mocked(appendFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockCreateDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
})

describe("audit timeline", () => {
  it("appends an audit event to the project jsonl timeline without rewriting history", async () => {
    await appendAuditEvent("/project", {
      timestamp: "2026-05-07T00:00:00.000Z",
      action: "memory_ops.patrol",
      targetPath: "wiki/concepts/a.md",
      reasons: ["manual patrol"],
    })

    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"memory_ops.patrol\""),
    )
    const event = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(event).toMatchObject({
      schemaVersion: 1,
      timestamp: "2026-05-07T00:00:00.000Z",
      category: "memory_ops",
      action: "memory_ops.patrol",
      targetPath: "wiki/concepts/a.md",
      reasons: ["manual patrol"],
    })
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("redacts secrets before appending an audit event", async () => {
    await appendAuditEvent("/project", {
      timestamp: "2026-05-07T00:00:00.000Z",
      action: "memory_ops.apply",
      targetPath: "wiki/concepts/a.md",
      after: {
        body: "OPENAI_API_KEY=sk-proj-abc1234567890secret",
      },
    })

    const written = String(mockAppendFile.mock.calls[0][1])
    expect(written).not.toContain("sk-proj-abc")
    expect(written).toContain("OPENAI_API_KEY=[REDACTED:secret]")
  })

  it("normalizes the unified audit contract before appending", async () => {
    await appendAuditEvent("/project", {
      timestamp: "2026-05-07T00:00:00.000Z",
      action: "search.run",
      actor: "system",
      targetPath: "wiki\\concepts\\search.md",
      pagePath: "wiki/concepts/search.md",
      sourcePath: "raw\\sources\\paper.pdf",
      reasons: ["  query used wiki pages  ", "query used wiki pages", ""],
      retrieval: {
        query: "hybrid search",
        streams: [
          { name: "lexical", resultCount: 4 },
          { name: "graph", resultCount: 2 },
        ],
        results: [
          {
            path: "wiki\\concepts\\hybrid-search.md",
            title: "Hybrid Search",
            rank: 1,
            score: 0.032,
            streams: ["lexical", "graph"],
          },
        ],
      },
      changes: {
        status: "dry-run",
        diff: [{ field: "review_status", before: "ok", after: "stale" }],
      },
    })

    const written = String(mockAppendFile.mock.calls[0][1])
    const event = JSON.parse(written)

    expect(event).toMatchObject({
      schemaVersion: 1,
      action: "search.run",
      category: "search",
      actor: "system",
      targetPath: "wiki/concepts/search.md",
      pagePath: "wiki/concepts/search.md",
      sourcePath: "raw/sources/paper.pdf",
      reasons: ["query used wiki pages"],
      retrieval: {
        query: "hybrid search",
        streams: [
          { name: "lexical", resultCount: 4 },
          { name: "graph", resultCount: 2 },
        ],
        results: [
          {
            path: "wiki/concepts/hybrid-search.md",
            title: "Hybrid Search",
            rank: 1,
            score: 0.032,
            streams: ["lexical", "graph"],
          },
        ],
      },
      changes: {
        status: "dry-run",
        diff: [{ field: "review_status", before: "ok", after: "stale" }],
      },
    })
  })

  it("categorizes claim audit actions", async () => {
    await appendAuditEvent("/project", {
      timestamp: "2026-05-08T00:00:00.000Z",
      action: "claim.write",
      actor: "system",
      pagePath: "wiki/concepts/search.md",
      targetPath: ".llm-wiki/claims.jsonl",
      after: { claimCount: 1 },
    })

    const event = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(event).toMatchObject({
      category: "claim",
      action: "claim.write",
      pagePath: "wiki/concepts/search.md",
      targetPath: ".llm-wiki/claims.jsonl",
    })
  })

  it("categorizes conflict audit actions", async () => {
    await appendAuditEvent("/project", {
      timestamp: "2026-05-08T00:00:00.000Z",
      action: "conflict.review",
      actor: "system",
      pagePath: "wiki/concepts/search.md",
      targetPath: "wiki/concepts/search.md",
      after: { classification: "possible-contradiction" },
    })

    const event = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(event).toMatchObject({
      category: "conflict",
      action: "conflict.review",
      pagePath: "wiki/concepts/search.md",
    })
  })

  it("reads claim events while keeping bad audit lines as warnings", async () => {
    mockReadFile.mockResolvedValueOnce([
      "{\"timestamp\":\"2026-05-08T00:00:00.000Z\",\"action\":\"claim.review\",\"pagePath\":\"wiki/a.md\"}",
      "{bad",
    ].join("\n"))

    const result = await readAuditTimeline("/project")

    expect(result.events.map((event) => event.action)).toEqual(["claim.review"])
    expect(result.warnings).toEqual([
      expect.objectContaining({ line: 2, message: expect.stringContaining("Invalid audit JSON") }),
    ])
  })

  it("reads valid events while reporting bad jsonl lines", async () => {
    mockReadFile.mockResolvedValueOnce([
      "{\"timestamp\":\"2026-05-07T00:00:00.000Z\",\"action\":\"ingest.write\",\"pagePath\":\"wiki/a.md\"}",
      "not-json",
      "{\"timestamp\":\"2026-05-07T00:01:00.000Z\",\"action\":\"crystallize.query\",\"targetPath\":\"wiki/queries/q.md\"}",
      "",
    ].join("\n"))

    const result = await readAuditTimeline("/project")

    expect(result.events.map((event) => event.action)).toEqual([
      "ingest.write",
      "crystallize.query",
    ])
    expect(result.warnings).toEqual([
      expect.objectContaining({ line: 2, message: expect.stringContaining("Invalid audit JSON") }),
    ])
  })

  it("filters events by action and page path aliases", () => {
    const events = [
      {
        timestamp: "2026-05-07T00:00:00.000Z",
        action: "lifecycle.enrich",
        pagePath: "wiki/concepts/a.md",
      },
      {
        timestamp: "2026-05-07T00:01:00.000Z",
        action: "memory_ops.patrol",
        targetPath: "wiki/concepts/a.md",
      },
      {
        timestamp: "2026-05-07T00:02:00.000Z",
        action: "memory_ops.patrol",
        targetPath: "wiki/concepts/b.md",
      },
    ]

    expect(filterAuditEvents(events, { action: "memory_ops.patrol" })).toHaveLength(2)
    expect(filterAuditEvents(events, { path: "wiki/concepts/a.md" }).map((e) => e.action)).toEqual([
      "lifecycle.enrich",
      "memory_ops.patrol",
    ])
  })

  it("keeps the lifecycle audit helper compatible with the unified timeline", async () => {
    mockReadFile.mockResolvedValueOnce("")

    await appendLifecycleAuditEvent("/project", {
      timestamp: "2026-05-07T00:00:00.000Z",
      action: "lifecycle.enrich",
      pagePath: "wiki/concepts/a.md",
      reasons: ["test"],
    })

    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"lifecycle.enrich\""),
    )
  })
})

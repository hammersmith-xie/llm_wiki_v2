import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendAuditEvent,
  filterAuditEvents,
  readAuditTimeline,
} from "./audit-timeline"
import { appendLifecycleAuditEvent } from "./lifecycle"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => {}),
}))

import { createDirectory, readFile, writeFile } from "@/commands/fs"

const mockCreateDirectory = vi.mocked(createDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockCreateDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
})

describe("audit timeline", () => {
  it("appends an audit event to the project jsonl timeline", async () => {
    mockReadFile.mockResolvedValueOnce("{\"action\":\"existing\"}\n")

    await appendAuditEvent("/project", {
      timestamp: "2026-05-07T00:00:00.000Z",
      action: "memory_ops.patrol",
      targetPath: "wiki/concepts/a.md",
      reasons: ["manual patrol"],
    })

    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      [
        "{\"action\":\"existing\"}",
        "{\"timestamp\":\"2026-05-07T00:00:00.000Z\",\"action\":\"memory_ops.patrol\",\"targetPath\":\"wiki/concepts/a.md\",\"reasons\":[\"manual patrol\"]}",
        "",
      ].join("\n"),
    )
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

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"lifecycle.enrich\""),
    )
  })
})

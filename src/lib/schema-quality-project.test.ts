import { beforeEach, describe, expect, it, vi } from "vitest"
import { runProjectSchemaQualityScan } from "./schema-quality-project"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("@/lib/audit-timeline", () => ({
  appendAuditEvent: vi.fn(async () => {}),
}))

import { listDirectory, readFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockAppendAuditEvent = vi.mocked(appendAuditEvent)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockAppendAuditEvent.mockReset()
  mockAppendAuditEvent.mockResolvedValue(undefined)
})

describe("project schema quality scan", () => {
  it("reads schema and wiki pages, then returns report suggestions", async () => {
    mockListDirectory.mockResolvedValue([
      {
        name: "concepts",
        path: "/project/wiki/concepts",
        is_dir: true,
        children: [
          {
            name: "stub.md",
            path: "/project/wiki/concepts/stub.md",
            is_dir: false,
          },
        ],
      },
    ])
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/schema.md") return "# Schema"
      if (path === "/project/wiki/concepts/stub.md") {
        return [
          "---",
          "type: concept",
          "title: Stub",
          "tags: []",
          "related: []",
          "created: 2026-05-07",
          "updated: 2026-05-07",
          "scope: shared",
          "---",
          "",
          "# Stub",
          "",
          "Tiny note.",
        ].join("\n")
      }
      return ""
    })

    const result = await runProjectSchemaQualityScan("/project")

    expect(result.report.summary.pageCount).toBe(1)
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ action: "schema.scan" }),
    )
  })
})

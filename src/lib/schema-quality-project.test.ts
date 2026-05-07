import { beforeEach, describe, expect, it, vi } from "vitest"
import { runProjectSchemaQualityScan } from "./schema-quality-project"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("@/lib/audit-timeline", () => ({
  appendAuditEvent: vi.fn(async () => {}),
}))

vi.mock("@/lib/project-store", () => ({
  saveSchemaQualitySummaryState: vi.fn(async () => {}),
}))

import { listDirectory, readFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import { saveSchemaQualitySummaryState } from "@/lib/project-store"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockAppendAuditEvent = vi.mocked(appendAuditEvent)
const mockSaveSchemaQualitySummaryState = vi.mocked(saveSchemaQualitySummaryState)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockAppendAuditEvent.mockReset()
  mockAppendAuditEvent.mockResolvedValue(undefined)
  mockSaveSchemaQualitySummaryState.mockReset()
  mockSaveSchemaQualitySummaryState.mockResolvedValue(undefined)
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

    const result = await runProjectSchemaQualityScan("/project", {
      dataVersion: 12,
      now: 1_777_777,
    })

    expect(result.report.summary.pageCount).toBe(1)
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.schemaQualitySummary).toMatchObject({
      scannedAt: 1_777_777,
      dataVersion: 12,
      pageCount: 1,
      suggestionCount: result.suggestions.length,
    })
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ action: "schema.scan" }),
    )
    expect(mockSaveSchemaQualitySummaryState).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        pageCount: 1,
        dataVersion: 12,
        suggestionCount: result.suggestions.length,
      }),
    )
  })

  it("can skip saving the summary for dry-run callers", async () => {
    mockListDirectory.mockRejectedValue(new Error("missing wiki"))
    mockReadFile.mockRejectedValue(new Error("missing schema"))

    await runProjectSchemaQualityScan("/project", {
      now: 2_000,
      persistSummary: false,
    })

    expect(mockSaveSchemaQualitySummaryState).not.toHaveBeenCalled()
  })
})

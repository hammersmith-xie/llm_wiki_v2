import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyMemoryOpsBatch,
  ignoreMemoryOpsBatch,
  isBatchApplicableMemoryOpsSuggestion,
  previewMemoryOpsBatch,
} from "./memory-ops-batch"
import type { MemoryOpsSuggestion } from "./memory-ops-rules"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
}))

import { appendFile, readFile, writeFile } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockAppendFile = vi.mocked(appendFile)

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockAppendFile.mockReset()
})

describe("memory ops batch", () => {
  it("previews only metadata-patch suggestions without writing files", async () => {
    mockReadFile.mockResolvedValueOnce("---\ntitle: A\nreview_status: ok\n---\n\nA")

    const result = await previewMemoryOpsBatch("/project", [
      suggestion("s1", "wiki/a.md", { review_status: "stale" }),
      reviewOnlySuggestion("s2", "wiki/b.md"),
    ])

    expect(result.ok).toBe(true)
    expect(result.summary).toMatchObject({
      selectedCount: 2,
      eligibleCount: 1,
      plannedCount: 1,
      ineligibleCount: 1,
      errorCount: 0,
    })
    expect(result.items[0]).toMatchObject({
      suggestionId: "s1",
      status: "planned",
      targetPath: "wiki/a.md",
      plan: {
        changed: true,
        diff: [{ field: "review_status", before: "ok", after: "stale" }],
      },
    })
    expect(result.items[1]).toMatchObject({
      suggestionId: "s2",
      status: "ineligible",
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it("marks preview items as errors without stopping later suggestions", async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error("missing file"))
      .mockResolvedValueOnce("---\ntitle: B\n---\n\nB")

    const result = await previewMemoryOpsBatch("/project", [
      suggestion("s1", "wiki/missing.md", { review_status: "stale" }),
      suggestion("s2", "wiki/b.md", { review_status: "needs-review" }),
    ])

    expect(result.ok).toBe(false)
    expect(result.summary).toMatchObject({
      selectedCount: 2,
      eligibleCount: 2,
      plannedCount: 1,
      errorCount: 1,
    })
    expect(result.items.map((item) => item.status)).toEqual(["error", "planned"])
    expect(result.items[0].error).toBe("missing file")
  })

  it("applies eligible suggestions sequentially and records per-item audits", async () => {
    mockReadFile
      .mockResolvedValueOnce("---\ntitle: A\nreview_status: ok\n---\n\nA")
      .mockResolvedValueOnce("---\ntitle: B\nreview_status: ok\n---\n\nB")
    mockWriteFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"))

    const result = await applyMemoryOpsBatch("/project", [
      suggestion("s1", "wiki/a.md", { review_status: "stale" }),
      suggestion("s2", "wiki/b.md", { review_status: "stale" }),
      reviewOnlySuggestion("s3", "wiki/c.md"),
    ])

    expect(result.ok).toBe(false)
    expect(result.summary).toMatchObject({
      selectedCount: 3,
      eligibleCount: 2,
      appliedCount: 1,
      unchangedCount: 0,
      ineligibleCount: 1,
      errorCount: 1,
    })
    expect(result.items.map((item) => item.status)).toEqual([
      "applied",
      "error",
      "ineligible",
    ])
    expect(mockWriteFile).toHaveBeenCalledTimes(2)
    expect(mockAppendFile).toHaveBeenCalledTimes(2)
    const firstAudit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(firstAudit).toMatchObject({
      action: "memory_ops.apply",
      targetPath: "wiki/a.md",
      after: {
        suggestionId: "s1",
        status: "applied",
      },
    })
    const secondAudit = JSON.parse(String(mockAppendFile.mock.calls[1][1]))
    expect(secondAudit).toMatchObject({
      action: "memory_ops.apply",
      targetPath: "wiki/b.md",
      after: {
        suggestionId: "s2",
        status: "error",
        error: "disk full",
      },
    })
  })

  it("keeps private-scope diffs out of apply audits", async () => {
    mockReadFile.mockResolvedValueOnce([
      "---",
      "title: Private",
      "scope: private",
      "review_status: ok",
      "---",
      "",
      "private body",
    ].join("\n"))
    mockWriteFile.mockResolvedValueOnce(undefined)

    await applyMemoryOpsBatch("/project", [
      suggestion("s1", "wiki/private.md", { review_status: "stale" }, { scope: "private" }),
    ])

    const written = String(mockAppendFile.mock.calls[0][1])
    expect(written).toContain("\"scope\":\"private\"")
    expect(written).not.toContain("private body")
    expect(written).not.toContain("\"diff\"")
  })

  it("ignores selected suggestions with auditable per-item events", async () => {
    const result = await ignoreMemoryOpsBatch("/project", [
      suggestion("s1", "wiki/a.md", { review_status: "stale" }),
      reviewOnlySuggestion("s2", "wiki/b.md"),
    ])

    expect(result.ok).toBe(true)
    expect(result.summary).toMatchObject({
      selectedCount: 2,
      ignoredCount: 2,
      errorCount: 0,
    })
    expect(result.items.map((item) => item.status)).toEqual(["ignored", "ignored"])
    expect(mockAppendFile).toHaveBeenCalledTimes(2)
    const audit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(audit).toMatchObject({
      action: "memory_ops.ignore",
      targetPath: "wiki/a.md",
      changes: { status: "ignored" },
      after: {
        suggestionId: "s1",
        kind: "metadata-update",
      },
    })
  })

  it("detects whether a suggestion can enter batch apply", () => {
    expect(isBatchApplicableMemoryOpsSuggestion(
      suggestion("s1", "wiki/a.md", { review_status: "stale" }),
    )).toBe(true)
    expect(isBatchApplicableMemoryOpsSuggestion(reviewOnlySuggestion("s2", "wiki/b.md"))).toBe(false)
  })
})

function suggestion(
  id: string,
  targetPath: string,
  fields: Record<string, string | string[]>,
  options: { scope?: "private" | "shared" } = {},
): MemoryOpsSuggestion {
  return {
    id,
    kind: "metadata-update",
    severity: "info",
    targetPath,
    title: `Suggestion ${id}`,
    detail: "Patch metadata.",
    reasons: [`Reason ${id}`],
    proposedOperation: {
      kind: "metadata-patch",
      targetPath,
      fields,
      reason: `Patch ${id}`,
      scope: options.scope,
    },
  }
}

function reviewOnlySuggestion(id: string, targetPath: string): MemoryOpsSuggestion {
  return {
    id,
    kind: "review-action",
    severity: "warning",
    targetPath,
    title: `Review ${id}`,
    detail: "Human review only.",
    reasons: [`Review reason ${id}`],
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyMemoryOpsBatch,
  buildMemoryOpsBatchAuditEvent,
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
    expect(mockAppendFile).toHaveBeenCalledTimes(1)
    const audit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(audit).toMatchObject({
      action: "memory_ops.batch_preview",
      changes: { status: "dry-run" },
      after: {
        summary: {
          selectedCount: 2,
          plannedCount: 1,
          ineligibleCount: 1,
        },
        categories: {
          lifecycle: 2,
        },
      },
    })
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
    expect(mockAppendFile).toHaveBeenCalledTimes(3)
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
    const batchAudit = JSON.parse(String(mockAppendFile.mock.calls[2][1]))
    expect(batchAudit).toMatchObject({
      action: "memory_ops.batch_apply",
      changes: { status: "error" },
      after: {
        summary: {
          selectedCount: 3,
          appliedCount: 1,
          errorCount: 1,
          ineligibleCount: 1,
        },
        categories: {
          lifecycle: 3,
        },
        items: [
          { suggestionId: "s1", status: "applied", changed: true },
          { suggestionId: "s2", status: "error", error: "disk full" },
          { suggestionId: "s3", status: "ineligible" },
        ],
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
    expect(mockAppendFile).toHaveBeenCalledTimes(3)
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
    const batchAudit = JSON.parse(String(mockAppendFile.mock.calls[2][1]))
    expect(batchAudit).toMatchObject({
      action: "memory_ops.batch_ignore",
      changes: { status: "ignored" },
      after: {
        summary: {
          selectedCount: 2,
          ignoredCount: 2,
        },
      },
    })
  })

  it("detects whether a suggestion can enter batch apply", () => {
    expect(isBatchApplicableMemoryOpsSuggestion(
      suggestion("s1", "wiki/a.md", { review_status: "stale" }),
    )).toBe(true)
    expect(isBatchApplicableMemoryOpsSuggestion(reviewOnlySuggestion("s2", "wiki/b.md"))).toBe(false)
  })

  it("builds batch summary audits without per-file private diffs", () => {
    const result = {
      ok: true,
      summary: {
        selectedCount: 1,
        eligibleCount: 1,
        plannedCount: 1,
        appliedCount: 0,
        unchangedCount: 0,
        ignoredCount: 0,
        ineligibleCount: 0,
        errorCount: 0,
      },
      items: [
        {
          suggestionId: "private",
          suggestionTitle: "Private stale",
          targetPath: "wiki/private.md",
          status: "planned" as const,
          plan: {
            kind: "metadata-patch" as const,
            dryRun: true as const,
            targetPath: "wiki/private.md",
            scope: "private",
            changed: true,
            diff: [{ field: "review_status", before: "ok", after: "stale" }],
            beforeContent: "private body",
            afterContent: "private body stale",
            rollback: {
              kind: "restore-content" as const,
              targetPath: "wiki/private.md",
              content: "private body",
              reason: "rollback",
            },
          },
        },
      ],
    }

    const event = buildMemoryOpsBatchAuditEvent(
      "memory_ops.batch_preview",
      [suggestion("private", "wiki/private.md", { review_status: "stale" }, { scope: "private" })],
      result,
    )

    const serialized = JSON.stringify(event)
    expect(event).toMatchObject({
      action: "memory_ops.batch_preview",
      after: {
        summary: { selectedCount: 1, plannedCount: 1 },
        categories: { lifecycle: 1 },
        items: [{ suggestionId: "private", status: "planned", changed: true }],
      },
    })
    expect(serialized).not.toContain("private body")
    expect(serialized).not.toContain("review_status")
    expect(serialized).not.toContain("stale")
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

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyMemoryOpsOperations,
  createMetadataPatchPlan,
} from "./memory-ops-executor"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

import { readFile, writeFile } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
})

describe("memory ops executor", () => {
  it("creates a dry-run metadata patch plan without writing files", () => {
    const content = [
      "---",
      "type: concept",
      "title: Attention",
      "review_status: ok",
      "---",
      "",
      "# Attention",
    ].join("\n")

    const plan = createMetadataPatchPlan({
      targetPath: "wiki/concepts/attention.md",
      content,
      fields: {
        review_status: "stale",
        confidence_reasons: ["last confirmed 400 days ago"],
      },
      reason: "stale patrol",
    })

    expect(plan.dryRun).toBe(true)
    expect(plan.changed).toBe(true)
    expect(plan.diff).toEqual([
      { field: "review_status", before: "ok", after: "stale" },
      { field: "confidence_reasons", before: undefined, after: ["last confirmed 400 days ago"] },
    ])
    expect(plan.afterContent).toContain("review_status: stale")
    expect(plan.afterContent).toContain("confidence_reasons: [\"last confirmed 400 days ago\"]")
    expect(plan.rollback).toEqual({
      kind: "restore-content",
      targetPath: "wiki/concepts/attention.md",
      content,
      reason: "Rollback metadata patch: stale patrol",
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("returns an unchanged dry-run plan when fields already match", () => {
    const content = [
      "---",
      "title: A",
      "review_status: stale",
      "---",
      "",
      "Body",
    ].join("\n")

    const plan = createMetadataPatchPlan({
      targetPath: "wiki/a.md",
      content,
      fields: { review_status: "stale" },
      reason: "noop",
    })

    expect(plan.changed).toBe(false)
    expect(plan.diff).toEqual([])
    expect(plan.afterContent).toBe(content)
  })

  it("applies operations sequentially and returns partial failure results", async () => {
    mockReadFile
      .mockResolvedValueOnce("---\ntitle: A\n---\n\nA")
      .mockResolvedValueOnce("---\ntitle: B\n---\n\nB")
    mockWriteFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"))

    const result = await applyMemoryOpsOperations("/project", [
      {
        kind: "metadata-patch",
        targetPath: "wiki/a.md",
        fields: { review_status: "stale" },
        reason: "first",
      },
      {
        kind: "metadata-patch",
        targetPath: "wiki/b.md",
        fields: { review_status: "stale" },
        reason: "second",
      },
    ])

    expect(result.ok).toBe(false)
    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toMatchObject({ status: "applied", targetPath: "wiki/a.md" })
    expect(result.results[1]).toMatchObject({
      status: "error",
      targetPath: "wiki/b.md",
      error: "disk full",
    })
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/wiki/a.md",
      expect.stringContaining("review_status: stale"),
    )
  })
})

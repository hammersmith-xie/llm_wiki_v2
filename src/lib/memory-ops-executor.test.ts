import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyMemoryOpsOperations,
  buildMemoryOpsPatchAuditEvent,
  createMetadataPatchPlan,
} from "./memory-ops-executor"
import { redactAuditEvent } from "@/lib/audit-redaction"

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

  it("builds an auditable dry-run event from a metadata patch plan", () => {
    const plan = createMetadataPatchPlan({
      targetPath: "wiki/concepts/attention.md",
      content: "---\ntitle: Attention\nreview_status: ok\n---\n\n# Attention",
      fields: { review_status: "stale" },
      reason: "stale patrol",
    })

    const event = buildMemoryOpsPatchAuditEvent({
      action: "memory_ops.preview",
      operation: {
        kind: "metadata-patch",
        targetPath: "wiki/concepts/attention.md",
        fields: { review_status: "stale" },
        reason: "stale patrol",
      },
      suggestionId: "suggestion-1",
      suggestionTitle: "Mark stale page",
      reasons: ["last confirmed 400 days ago"],
      plan,
    })

    expect(event).toMatchObject({
      action: "memory_ops.preview",
      actor: "user",
      targetPath: "wiki/concepts/attention.md",
      dryRun: true,
      changes: {
        status: "dry-run",
        diff: [{ field: "review_status", before: "ok", after: "stale" }],
      },
      after: {
        suggestionId: "suggestion-1",
        status: "dry-run",
        changed: true,
        diff: [{ field: "review_status", before: "ok", after: "stale" }],
      },
      reasons: ["Mark stale page", "last confirmed 400 days ago"],
    })
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

  it("builds an auditable apply event from an operation result", async () => {
    mockReadFile.mockResolvedValueOnce("---\ntitle: A\nreview_status: ok\n---\n\nA")
    mockWriteFile.mockResolvedValueOnce(undefined)

    const operation = {
      kind: "metadata-patch" as const,
      targetPath: "wiki/a.md",
      fields: { review_status: "stale" },
      reason: "stale patrol",
    }
    const result = await applyMemoryOpsOperations("/project", [operation])

    const event = buildMemoryOpsPatchAuditEvent({
      action: "memory_ops.apply",
      operation,
      suggestionId: "suggestion-1",
      suggestionTitle: "Mark stale page",
      reasons: ["last confirmed 400 days ago"],
      result: result.results[0],
    })

    expect(event).toMatchObject({
      action: "memory_ops.apply",
      actor: "user",
      targetPath: "wiki/a.md",
      changes: {
        status: "applied",
        diff: [{ field: "review_status", before: "ok", after: "stale" }],
      },
      after: {
        suggestionId: "suggestion-1",
        status: "applied",
        changed: true,
        diff: [{ field: "review_status", before: "ok", after: "stale" }],
      },
    })
  })

  it("omits private-scope diff and body content from patch audit events", () => {
    const content = [
      "---",
      "title: Private Claim",
      "scope: private",
      "review_status: ok",
      "---",
      "",
      "private body should not enter audit",
    ].join("\n")
    const plan = createMetadataPatchPlan({
      targetPath: "wiki/private/claim.md",
      content,
      fields: { review_status: "stale" },
      reason: "private stale patrol",
    })

    const event = buildMemoryOpsPatchAuditEvent({
      action: "memory_ops.preview",
      operation: {
        kind: "metadata-patch",
        targetPath: "wiki/private/claim.md",
        fields: { review_status: "stale" },
        reason: "private stale patrol",
      },
      suggestionId: "private-suggestion",
      suggestionTitle: "Mark private stale page",
      reasons: ["private reason"],
      plan,
    })
    const serialized = JSON.stringify(event)
    const redacted = redactAuditEvent(event)

    expect(plan.scope).toBe("private")
    expect(event.scope).toBe("private")
    expect(event.changes?.diff).toBeUndefined()
    expect(serialized).not.toContain("private body should not enter audit")
    expect(JSON.stringify(redacted)).not.toContain("Private Claim")
    expect(redacted).toMatchObject({
      action: "memory_ops.preview",
      scope: "private",
      targetPath: "wiki/private/claim.md",
      redacted: true,
    })
  })

  it("rejects metadata operations that escape the project root", async () => {
    const result = await applyMemoryOpsOperations("/project", [
      {
        kind: "metadata-patch",
        targetPath: "/tmp/outside.md",
        fields: { review_status: "stale" },
        reason: "outside project",
      },
    ])

    expect(result.ok).toBe(false)
    expect(result.results).toEqual([
      {
        targetPath: "/tmp/outside.md",
        status: "error",
        error: "Memory Ops target path escapes the project root: /tmp/outside.md",
      },
    ])
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("rejects metadata operations that traverse out of the project root", async () => {
    const result = await applyMemoryOpsOperations("/project", [
      {
        kind: "metadata-patch",
        targetPath: "../outside.md",
        fields: { review_status: "stale" },
        reason: "path traversal",
      },
    ])

    expect(result.ok).toBe(false)
    expect(result.results).toEqual([
      {
        targetPath: "../outside.md",
        status: "error",
        error: "Memory Ops target path contains parent traversal: ../outside.md",
      },
    ])
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyMemoryOpsRollback,
  buildMemoryOpsRollbackAuditEvent,
  previewMemoryOpsRollback,
} from "./memory-ops-rollback"

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

describe("memory ops rollback", () => {
  it("previews a safe rollback when current content matches the expected post-apply content", async () => {
    mockReadFile.mockResolvedValueOnce("patched content")

    const preview = await previewMemoryOpsRollback("/project", {
      rollback: rollback("wiki/a.md", "before"),
      expectedContent: "patched content",
    })

    expect(preview).toMatchObject({
      targetPath: "wiki/a.md",
      status: "safe",
      currentContent: "patched content",
      expectedContent: "patched content",
      rollbackContent: "before",
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("restores rollback content and records an audit event", async () => {
    mockReadFile.mockResolvedValueOnce("patched content")
    mockWriteFile.mockResolvedValueOnce(undefined)

    const result = await applyMemoryOpsRollback("/project", {
      rollback: rollback("wiki/a.md", "before"),
      expectedContent: "patched content",
      suggestionId: "s1",
      suggestionTitle: "Mark stale page",
    })

    expect(result).toMatchObject({
      targetPath: "wiki/a.md",
      status: "restored",
    })
    expect(mockWriteFile).toHaveBeenCalledWith("/project/wiki/a.md", "before")
    expect(mockAppendFile).toHaveBeenCalledTimes(1)
    const audit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(audit).toMatchObject({
      action: "memory_ops.rollback",
      targetPath: "wiki/a.md",
      changes: { status: "applied" },
      after: {
        suggestionId: "s1",
        status: "restored",
        rollback: {
          kind: "restore-content",
          targetPath: "wiki/a.md",
          restoredContentLength: 6,
          currentContentLength: 15,
          expectedContentLength: 15,
        },
      },
    })
    expect(JSON.stringify(audit)).not.toContain("before")
    expect(JSON.stringify(audit)).not.toContain("patched content")
  })

  it("refuses to restore when current content changed after the original operation", async () => {
    mockReadFile.mockResolvedValueOnce("user edit")

    const result = await applyMemoryOpsRollback("/project", {
      rollback: rollback("wiki/a.md", "before"),
      expectedContent: "after",
    })

    expect(result).toMatchObject({
      status: "conflict",
      reason: "Current content changed after the original Memory Ops operation.",
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
    const audit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(audit).toMatchObject({
      action: "memory_ops.rollback",
      changes: { status: "conflict" },
      after: { status: "conflict" },
    })
  })

  it("returns error for a missing target and does not create a file", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("file not found"))

    const result = await applyMemoryOpsRollback("/project", {
      rollback: rollback("wiki/missing.md", "before"),
      expectedContent: "after",
    })

    expect(result).toMatchObject({
      targetPath: "wiki/missing.md",
      status: "missing",
      error: "file not found",
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("rejects rollback paths that escape the project root", async () => {
    const result = await applyMemoryOpsRollback("/project", {
      rollback: rollback("../outside.md", "before"),
    })

    expect(result).toMatchObject({
      targetPath: "../outside.md",
      status: "error",
      error: "Memory Ops target path contains parent traversal: ../outside.md",
    })
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("does not include private rollback content in audit events", () => {
    const event = buildMemoryOpsRollbackAuditEvent(
      {
        rollback: rollback("wiki/private.md", "super secret before"),
        expectedContent: "super secret after",
        scope: "private",
      },
      {
        targetPath: "wiki/private.md",
        status: "restored",
        reason: "Rollback metadata patch",
        preview: {
          targetPath: "wiki/private.md",
          status: "safe",
          reason: "safe",
          currentContent: "super secret after",
          expectedContent: "super secret after",
          rollbackContent: "super secret before",
        },
      },
    )

    const serialized = JSON.stringify(event)
    expect(event).toMatchObject({
      action: "memory_ops.rollback",
      scope: "private",
      after: {
        rollback: {
          restoredContentLength: 19,
          currentContentLength: 18,
          expectedContentLength: 18,
        },
      },
    })
    expect(serialized).not.toContain("super secret before")
    expect(serialized).not.toContain("super secret after")
  })
})

function rollback(targetPath: string, content: string) {
  return {
    kind: "restore-content" as const,
    targetPath,
    content,
    reason: "Rollback metadata patch",
  }
}

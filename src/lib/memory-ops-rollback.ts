import { readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import {
  resolveMemoryOpsTargetPath,
  type RollbackRestoreContent,
} from "@/lib/memory-ops-executor"

export type MemoryOpsRollbackStatus =
  | "safe"
  | "conflict"
  | "missing"
  | "restored"
  | "error"

export interface MemoryOpsRollbackPreview {
  targetPath: string
  status: Exclude<MemoryOpsRollbackStatus, "restored">
  reason: string
  currentContent?: string
  expectedContent?: string
  rollbackContent: string
  error?: string
}

export interface MemoryOpsRollbackResult {
  targetPath: string
  status: MemoryOpsRollbackStatus
  reason: string
  preview?: MemoryOpsRollbackPreview
  error?: string
  auditError?: string
}

export interface MemoryOpsRollbackInput {
  rollback: RollbackRestoreContent
  expectedContent?: string
  suggestionId?: string
  suggestionTitle?: string
  scope?: "private" | "shared" | string
}

export async function previewMemoryOpsRollback(
  projectPath: string,
  input: MemoryOpsRollbackInput,
): Promise<MemoryOpsRollbackPreview> {
  try {
    const fullPath = resolveMemoryOpsTargetPath(projectPath, input.rollback.targetPath)
    const currentContent = await readFile(fullPath)
    const expectedContent = input.expectedContent
    const safe = expectedContent === undefined || currentContent === expectedContent

    return {
      targetPath: input.rollback.targetPath,
      status: safe ? "safe" : "conflict",
      reason: safe
        ? "Current content matches rollback precondition."
        : "Current content changed after the original Memory Ops operation.",
      currentContent,
      expectedContent,
      rollbackContent: input.rollback.content,
    }
  } catch (err) {
    const message = errorMessage(err)
    return {
      targetPath: input.rollback.targetPath,
      status: message.toLowerCase().includes("not found") ? "missing" : "error",
      reason: "Rollback target could not be read.",
      rollbackContent: input.rollback.content,
      error: message,
    }
  }
}

export async function applyMemoryOpsRollback(
  projectPath: string,
  input: MemoryOpsRollbackInput,
): Promise<MemoryOpsRollbackResult> {
  const preview = await previewMemoryOpsRollback(projectPath, input)
  if (preview.status !== "safe") {
    const result: MemoryOpsRollbackResult = {
      targetPath: input.rollback.targetPath,
      status: preview.status,
      reason: preview.reason,
      preview,
      error: preview.error,
    }
    result.auditError = await appendRollbackAuditSafely(projectPath, input, result)
    return result
  }

  try {
    await writeFile(
      resolveMemoryOpsTargetPath(projectPath, input.rollback.targetPath),
      input.rollback.content,
    )
    const result: MemoryOpsRollbackResult = {
      targetPath: input.rollback.targetPath,
      status: "restored",
      reason: input.rollback.reason,
      preview,
    }
    result.auditError = await appendRollbackAuditSafely(projectPath, input, result)
    return result
  } catch (err) {
    const result: MemoryOpsRollbackResult = {
      targetPath: input.rollback.targetPath,
      status: "error",
      reason: "Rollback restore failed.",
      preview,
      error: errorMessage(err),
    }
    result.auditError = await appendRollbackAuditSafely(projectPath, input, result)
    return result
  }
}

export function buildMemoryOpsRollbackAuditEvent(
  input: MemoryOpsRollbackInput,
  result: MemoryOpsRollbackResult,
) {
  return {
    action: "memory_ops.rollback",
    actor: "user" as const,
    scope: input.scope,
    targetPath: input.rollback.targetPath,
    changes: {
      status: result.status === "restored" ? "applied" : result.status,
    },
    after: {
      suggestionId: input.suggestionId,
      status: result.status,
      reason: result.reason,
      error: result.error,
      rollback: {
        kind: input.rollback.kind,
        targetPath: input.rollback.targetPath,
        restoredContentLength: input.rollback.content.length,
        currentContentLength: result.preview?.currentContent?.length,
        expectedContentLength: result.preview?.expectedContent?.length,
      },
    },
    reasons: [
      input.suggestionTitle ?? "",
      input.rollback.reason,
      result.error ?? "",
    ],
  }
}

async function appendRollbackAuditSafely(
  projectPath: string,
  input: MemoryOpsRollbackInput,
  result: MemoryOpsRollbackResult,
): Promise<string | undefined> {
  try {
    await appendAuditEvent(projectPath, buildMemoryOpsRollbackAuditEvent(input, result))
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

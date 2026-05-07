import { readFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import {
  applyMemoryOpsOperations,
  buildMemoryOpsPatchAuditEvent,
  createMetadataPatchPlan,
  resolveMemoryOpsTargetPath,
  type ApplyOperationResult,
  type MetadataPatchOperation,
  type MetadataPatchPlan,
} from "@/lib/memory-ops-executor"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"

export type MemoryOpsBatchItemStatus =
  | "planned"
  | "applied"
  | "unchanged"
  | "ignored"
  | "ineligible"
  | "error"

export interface MemoryOpsBatchItem {
  suggestionId: string
  suggestionTitle: string
  targetPath: string
  status: MemoryOpsBatchItemStatus
  operation?: MetadataPatchOperation
  plan?: MetadataPatchPlan
  applyResult?: ApplyOperationResult
  error?: string
  auditError?: string
}

export interface MemoryOpsBatchSummary {
  selectedCount: number
  eligibleCount: number
  plannedCount: number
  appliedCount: number
  unchangedCount: number
  ignoredCount: number
  ineligibleCount: number
  errorCount: number
}

export interface MemoryOpsBatchResult {
  ok: boolean
  summary: MemoryOpsBatchSummary
  items: MemoryOpsBatchItem[]
}

export function isBatchApplicableMemoryOpsSuggestion(
  suggestion: MemoryOpsSuggestion,
): boolean {
  return !!batchOperationForSuggestion(suggestion)
}

export async function previewMemoryOpsBatch(
  projectPath: string,
  suggestions: readonly MemoryOpsSuggestion[],
): Promise<MemoryOpsBatchResult> {
  const items: MemoryOpsBatchItem[] = []

  for (const suggestion of suggestions) {
    const operation = batchOperationForSuggestion(suggestion)
    if (!operation) {
      items.push(ineligibleBatchItem(suggestion))
      continue
    }

    try {
      const content = await readFile(resolveMemoryOpsTargetPath(projectPath, operation.targetPath))
      const plan = createMetadataPatchPlan({
        targetPath: operation.targetPath,
        content,
        fields: operation.fields,
        reason: operation.reason,
        scope: operation.scope,
      })
      items.push({
        suggestionId: suggestion.id,
        suggestionTitle: suggestion.title,
        targetPath: operation.targetPath,
        status: "planned",
        operation,
        plan,
      })
    } catch (err) {
      items.push({
        suggestionId: suggestion.id,
        suggestionTitle: suggestion.title,
        targetPath: operation.targetPath,
        status: "error",
        operation,
        error: errorMessage(err),
      })
    }
  }

  return buildBatchResult(suggestions.length, items)
}

export async function applyMemoryOpsBatch(
  projectPath: string,
  suggestions: readonly MemoryOpsSuggestion[],
): Promise<MemoryOpsBatchResult> {
  const items: MemoryOpsBatchItem[] = []

  for (const suggestion of suggestions) {
    const operation = batchOperationForSuggestion(suggestion)
    if (!operation) {
      items.push(ineligibleBatchItem(suggestion))
      continue
    }

    try {
      const result = await applyMemoryOpsOperations(projectPath, [operation])
      const first = result.results[0] ?? {
        targetPath: operation.targetPath,
        status: "error" as const,
        error: "Memory Ops operation returned no result",
      }
      const auditError = await appendPatchAuditSafely(projectPath, suggestion, operation, first)
      items.push({
        suggestionId: suggestion.id,
        suggestionTitle: suggestion.title,
        targetPath: operation.targetPath,
        status: first.status,
        operation,
        applyResult: first,
        plan: first.plan,
        error: first.error,
        auditError,
      })
    } catch (err) {
      items.push({
        suggestionId: suggestion.id,
        suggestionTitle: suggestion.title,
        targetPath: operation.targetPath,
        status: "error",
        operation,
        error: errorMessage(err),
      })
    }
  }

  return buildBatchResult(suggestions.length, items)
}

export async function ignoreMemoryOpsBatch(
  projectPath: string,
  suggestions: readonly MemoryOpsSuggestion[],
): Promise<MemoryOpsBatchResult> {
  const items: MemoryOpsBatchItem[] = []

  for (const suggestion of suggestions) {
    try {
      await appendAuditEvent(projectPath, {
        action: "memory_ops.ignore",
        actor: "user",
        targetPath: suggestion.targetPath,
        changes: { status: "ignored" },
        after: {
          suggestionId: suggestion.id,
          kind: suggestion.kind,
          severity: suggestion.severity,
          title: suggestion.title,
        },
        reasons: [suggestion.title, ...suggestion.reasons],
      })
      items.push({
        suggestionId: suggestion.id,
        suggestionTitle: suggestion.title,
        targetPath: suggestion.targetPath,
        status: "ignored",
      })
    } catch (err) {
      items.push({
        suggestionId: suggestion.id,
        suggestionTitle: suggestion.title,
        targetPath: suggestion.targetPath,
        status: "error",
        error: errorMessage(err),
      })
    }
  }

  return buildBatchResult(suggestions.length, items)
}

async function appendPatchAuditSafely(
  projectPath: string,
  suggestion: MemoryOpsSuggestion,
  operation: MetadataPatchOperation,
  result: ApplyOperationResult,
): Promise<string | undefined> {
  try {
    await appendAuditEvent(projectPath, buildMemoryOpsPatchAuditEvent({
      action: "memory_ops.apply",
      operation,
      suggestionId: suggestion.id,
      suggestionTitle: suggestion.title,
      reasons: suggestion.reasons,
      result,
    }))
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

function batchOperationForSuggestion(
  suggestion: MemoryOpsSuggestion,
): MetadataPatchOperation | undefined {
  const operation = suggestion.proposedOperation
  return operation?.kind === "metadata-patch" ? operation : undefined
}

function ineligibleBatchItem(suggestion: MemoryOpsSuggestion): MemoryOpsBatchItem {
  return {
    suggestionId: suggestion.id,
    suggestionTitle: suggestion.title,
    targetPath: suggestion.targetPath,
    status: "ineligible",
    error: "Suggestion has no metadata patch operation.",
  }
}

function buildBatchResult(
  selectedCount: number,
  items: MemoryOpsBatchItem[],
): MemoryOpsBatchResult {
  const summary = summarizeBatchItems(selectedCount, items)
  return {
    ok: summary.errorCount === 0,
    summary,
    items,
  }
}

function summarizeBatchItems(
  selectedCount: number,
  items: readonly MemoryOpsBatchItem[],
): MemoryOpsBatchSummary {
  const count = (status: MemoryOpsBatchItemStatus) =>
    items.filter((item) => item.status === status).length

  return {
    selectedCount,
    eligibleCount: items.filter((item) => item.status !== "ineligible").length,
    plannedCount: count("planned"),
    appliedCount: count("applied"),
    unchangedCount: count("unchanged"),
    ignoredCount: count("ignored"),
    ineligibleCount: count("ineligible"),
    errorCount: count("error"),
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

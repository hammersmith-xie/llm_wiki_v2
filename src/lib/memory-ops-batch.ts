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
import { categorizeMemoryOpsSuggestion } from "@/lib/memory-ops-ui"

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
  auditError?: string
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

  const result = buildBatchResult(suggestions.length, items)
  result.auditError = await appendBatchAuditSafely(projectPath, "memory_ops.batch_preview", suggestions, result)
  return result
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

  const result = buildBatchResult(suggestions.length, items)
  result.auditError = await appendBatchAuditSafely(projectPath, "memory_ops.batch_apply", suggestions, result)
  return result
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

  const result = buildBatchResult(suggestions.length, items)
  result.auditError = await appendBatchAuditSafely(projectPath, "memory_ops.batch_ignore", suggestions, result)
  return result
}

export function buildMemoryOpsBatchAuditEvent(
  action: "memory_ops.batch_preview" | "memory_ops.batch_apply" | "memory_ops.batch_ignore",
  suggestions: readonly MemoryOpsSuggestion[],
  result: MemoryOpsBatchResult,
) {
  return {
    action,
    actor: "user" as const,
    targetPath: ".llm-wiki/audit.jsonl",
    changes: {
      status: result.ok ? batchAuditStatusForAction(action) : "error",
    },
    after: {
      summary: result.summary,
      categories: countSuggestionCategories(suggestions),
      items: result.items.map((item) => ({
        suggestionId: item.suggestionId,
        targetPath: item.targetPath,
        status: item.status,
        changed: item.plan?.changed ?? item.applyResult?.plan?.changed,
        error: item.error,
        auditError: item.auditError,
      })),
    },
    reasons: [
      `${result.summary.selectedCount} suggestion${result.summary.selectedCount === 1 ? "" : "s"} selected`,
      `${result.summary.errorCount} error${result.summary.errorCount === 1 ? "" : "s"}`,
    ],
  }
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

async function appendBatchAuditSafely(
  projectPath: string,
  action: "memory_ops.batch_preview" | "memory_ops.batch_apply" | "memory_ops.batch_ignore",
  suggestions: readonly MemoryOpsSuggestion[],
  result: MemoryOpsBatchResult,
): Promise<string | undefined> {
  try {
    await appendAuditEvent(projectPath, buildMemoryOpsBatchAuditEvent(action, suggestions, result))
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

function batchAuditStatusForAction(
  action: "memory_ops.batch_preview" | "memory_ops.batch_apply" | "memory_ops.batch_ignore",
): string {
  if (action === "memory_ops.batch_preview") return "dry-run"
  if (action === "memory_ops.batch_ignore") return "ignored"
  return "applied"
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

function countSuggestionCategories(
  suggestions: readonly MemoryOpsSuggestion[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const suggestion of suggestions) {
    const category = categorizeMemoryOpsSuggestion(suggestion)
    counts[category] = (counts[category] ?? 0) + 1
  }
  return counts
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

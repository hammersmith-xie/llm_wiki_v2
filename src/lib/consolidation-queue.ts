import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"
import type { CrystallizationDigestPlan } from "@/lib/crystallization-digest"
import { normalizePath } from "@/lib/path-utils"

export const CONSOLIDATION_QUEUE_VERSION = 1

export type ConsolidationQueueStatus = "queued" | "accepted" | "dismissed" | "applied"

export interface ConsolidationQueueItem {
  id: string
  version: typeof CONSOLIDATION_QUEUE_VERSION
  status: ConsolidationQueueStatus
  dedupeKey: string
  sourceId: string
  sourceOrigin: string
  sourceTitle: string
  sourceScore: number
  sourceReasons: string[]
  targetPaths: string[]
  counts: CrystallizationDigestPlan["summary"]
  warnings: string[]
  createdAt: string
  updatedAt: string
  appliedTargetPaths?: string[]
}

export interface ConsolidationQueueReadResult {
  items: ConsolidationQueueItem[]
  warnings: string[]
}

export interface AddConsolidationQueueResult {
  item: ConsolidationQueueItem
  added: boolean
  items: ConsolidationQueueItem[]
}

export interface UpdateConsolidationQueueStatusInput {
  projectPath: string
  id: string
  status: ConsolidationQueueStatus
  appliedTargetPaths?: readonly string[]
  now?: Date
}

export function consolidationQueuePath(projectPath: string): string {
  return `${normalizeProjectPath(projectPath)}/.llm-wiki/consolidation-queue.json`
}

export async function readConsolidationQueue(
  projectPath: string,
): Promise<ConsolidationQueueReadResult> {
  let raw = ""
  try {
    raw = await readFile(consolidationQueuePath(projectPath))
  } catch {
    return { items: [], warnings: [] }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : []
    const warnings: string[] = []
    const items = values
      .map((value, index) => normalizeQueueItem(value, index, warnings))
      .filter((item): item is ConsolidationQueueItem => Boolean(item))
    return { items, warnings }
  } catch (err) {
    return {
      items: [],
      warnings: [`Invalid consolidation queue JSON: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

export async function addDigestPlanToConsolidationQueue(input: {
  projectPath: string
  plan: CrystallizationDigestPlan
  now?: Date
}): Promise<AddConsolidationQueueResult> {
  const pp = normalizeProjectPath(input.projectPath)
  const now = (input.now ?? new Date()).toISOString()
  const current = await readConsolidationQueue(pp)
  const existing = current.items.find((item) => item.dedupeKey === input.plan.dedupeKey)
  if (existing) {
    return { item: existing, added: false, items: current.items }
  }

  const item = queueItemFromDigestPlan(input.plan, now)
  const items = [...current.items, item]
  await writeQueue(pp, items)
  await appendAuditEvent(pp, {
    action: "consolidation.queue.add",
    category: "crystallize",
    actor: "system",
    targetPath: ".llm-wiki/consolidation-queue.json",
    changes: { status: "applied" },
    after: {
      id: item.id,
      dedupeKey: item.dedupeKey,
      sourceId: item.sourceId,
      sourceOrigin: item.sourceOrigin,
      targetPaths: item.targetPaths,
      counts: item.counts,
    },
    reasons: [
      "digest plan queued for user review",
      ...item.sourceReasons.slice(0, 4),
    ],
  })

  return { item, added: true, items }
}

export async function updateConsolidationQueueStatus(
  input: UpdateConsolidationQueueStatusInput,
): Promise<ConsolidationQueueItem | null> {
  const pp = normalizeProjectPath(input.projectPath)
  const current = await readConsolidationQueue(pp)
  const now = (input.now ?? new Date()).toISOString()
  const itemIndex = current.items.findIndex((item) => item.id === input.id)
  if (itemIndex < 0) return null
  const applied: ConsolidationQueueItem = {
    ...current.items[itemIndex],
    status: input.status,
    updatedAt: now,
    ...(input.appliedTargetPaths ? { appliedTargetPaths: [...input.appliedTargetPaths] } : {}),
  }
  const items = current.items.map((item, index) => index === itemIndex ? applied : item)

  await writeQueue(pp, items)
  await appendAuditEvent(pp, {
    action: "consolidation.queue.status",
    category: "crystallize",
    actor: "user",
    targetPath: ".llm-wiki/consolidation-queue.json",
    changes: { status: "applied" },
    after: {
      id: applied.id,
      status: applied.status,
      appliedTargetPaths: applied.appliedTargetPaths,
    },
    reasons: [`consolidation queue item marked ${applied.status}`],
  })
  return applied
}

export function queueItemFromDigestPlan(
  plan: CrystallizationDigestPlan,
  nowIso: string,
): ConsolidationQueueItem {
  return {
    id: `cq_${hashString(plan.dedupeKey)}`,
    version: CONSOLIDATION_QUEUE_VERSION,
    status: "queued",
    dedupeKey: plan.dedupeKey,
    sourceId: plan.source.sourceId,
    sourceOrigin: plan.source.origin,
    sourceTitle: plan.source.title,
    sourceScore: plan.source.score,
    sourceReasons: [...plan.source.reasons],
    targetPaths: plan.pageCandidates.map((candidate) => candidate.targetPath),
    counts: plan.summary,
    warnings: [...plan.warnings],
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

function normalizeQueueItem(
  value: unknown,
  index: number,
  warnings: string[],
): ConsolidationQueueItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push(`Queue item ${index + 1} is not an object; skipped.`)
    return null
  }
  const record = value as Record<string, unknown>
  const dedupeKey = stringValue(record.dedupeKey)
  const sourceId = stringValue(record.sourceId)
  if (!dedupeKey || !sourceId) {
    warnings.push(`Queue item ${index + 1} missing dedupeKey or sourceId; skipped.`)
    return null
  }
  const createdAt = stringValue(record.createdAt) || new Date(0).toISOString()
  const updatedAt = stringValue(record.updatedAt) || createdAt
  return {
    id: stringValue(record.id) || `cq_${hashString(dedupeKey)}`,
    version: CONSOLIDATION_QUEUE_VERSION,
    status: normalizeStatus(record.status),
    dedupeKey,
    sourceId,
    sourceOrigin: stringValue(record.sourceOrigin) || "unknown",
    sourceTitle: stringValue(record.sourceTitle) || "Untitled consolidation",
    sourceScore: scoreValue(record.sourceScore),
    sourceReasons: stringArray(record.sourceReasons),
    targetPaths: stringArray(record.targetPaths).map(normalizePath),
    counts: normalizeCounts(record.counts),
    warnings: stringArray(record.warnings),
    createdAt,
    updatedAt,
    ...(stringArray(record.appliedTargetPaths).length > 0
      ? { appliedTargetPaths: stringArray(record.appliedTargetPaths).map(normalizePath) }
      : {}),
  }
}

async function writeQueue(
  projectPath: string,
  items: readonly ConsolidationQueueItem[],
): Promise<void> {
  await createDirectory(`${projectPath}/.llm-wiki`).catch(() => {})
  await writeFile(
    consolidationQueuePath(projectPath),
    `${JSON.stringify({ version: CONSOLIDATION_QUEUE_VERSION, items }, null, 2)}\n`,
  )
}

function normalizeProjectPath(projectPath: string): string {
  return normalizePath(projectPath).replace(/\/$/, "")
}

function normalizeStatus(value: unknown): ConsolidationQueueStatus {
  const normalized = stringValue(value)
  if (
    normalized === "accepted" ||
    normalized === "dismissed" ||
    normalized === "applied"
  ) return normalized
  return "queued"
}

function normalizeCounts(value: unknown): CrystallizationDigestPlan["summary"] {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    lessonCount: nonNegativeInteger(record.lessonCount),
    decisionCount: nonNegativeInteger(record.decisionCount),
    entityCount: nonNegativeInteger(record.entityCount),
    relationCount: nonNegativeInteger(record.relationCount),
    pageCandidateCount: nonNegativeInteger(record.pageCandidateCount),
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean)
}

function scoreValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

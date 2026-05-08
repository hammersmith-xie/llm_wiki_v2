import { appendFile, createDirectory, readFile } from "@/commands/fs"
import { redactAuditEvent } from "@/lib/audit-redaction"
import { normalizePath } from "@/lib/path-utils"

export const AUDIT_SCHEMA_VERSION = 1

export type AuditEventCategory =
  | "query"
  | "search"
  | "ingest"
  | "review"
  | "crystallize"
  | "memory_ops"
  | "lifecycle"
  | "claim"
  | "schema"
  | "quality"
  | "other"

export type AuditEventActor = "user" | "system" | "agent"

export interface AuditRetrievalStreamSummary {
  name: string
  resultCount: number
}

export interface AuditRetrievalResultSummary {
  path: string
  title?: string
  snippet?: string
  rank?: number
  score?: number
  streams?: string[]
}

export interface AuditRetrievalSummary {
  query?: string
  streams?: AuditRetrievalStreamSummary[]
  results?: AuditRetrievalResultSummary[]
}

export interface AuditChangeDiffSummary {
  field: string
  before?: unknown
  after?: unknown
}

export interface AuditChangeSummary {
  status?: "dry-run" | "applied" | "ignored" | "error" | string
  diff?: AuditChangeDiffSummary[]
}

export interface AuditEvent {
  schemaVersion?: typeof AUDIT_SCHEMA_VERSION
  timestamp?: string
  action: string
  category?: AuditEventCategory
  actor?: AuditEventActor
  pagePath?: string
  targetPath?: string
  sourcePath?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reasons?: string[]
  retrieval?: AuditRetrievalSummary
  changes?: AuditChangeSummary
  scope?: "private" | "shared" | string
  dryRun?: boolean
  [key: string]: unknown
}

export interface AuditTimelineWarning {
  line: number
  message: string
  raw: string
}

export interface AuditTimelineResult {
  events: AuditEvent[]
  warnings: AuditTimelineWarning[]
}

export interface AuditEventFilter {
  action?: string | readonly string[]
  path?: string
}

export function auditTimelinePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/audit.jsonl`
}

export async function appendAuditEvent(
  projectPath: string,
  event: AuditEvent,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const dir = `${pp}/.llm-wiki`
  const path = auditTimelinePath(pp)
  const normalized = normalizeAuditEvent(event)
  const line = `${JSON.stringify(normalized)}\n`

  await createDirectory(dir).catch(() => {})
  await appendFile(path, line)
}

export async function readAuditTimeline(
  projectPath: string,
): Promise<AuditTimelineResult> {
  let raw = ""
  try {
    raw = await readFile(auditTimelinePath(projectPath))
  } catch {
    return { events: [], warnings: [] }
  }

  const events: AuditEvent[] = []
  const warnings: AuditTimelineWarning[] = []
  const lines = raw.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (!isAuditEvent(parsed)) {
        warnings.push({
          line: i + 1,
          message: "Invalid audit JSON: expected an object with an action.",
          raw: line,
        })
        continue
      }
      events.push(parsed)
    } catch (err) {
      warnings.push({
        line: i + 1,
        message: `Invalid audit JSON: ${err instanceof Error ? err.message : String(err)}`,
        raw: line,
      })
    }
  }

  return { events, warnings }
}

export function filterAuditEvents(
  events: readonly AuditEvent[],
  filter: AuditEventFilter,
): AuditEvent[] {
  const actions =
    typeof filter.action === "string"
      ? new Set([filter.action])
      : filter.action
        ? new Set(filter.action)
        : null
  const path = filter.path ? normalizePath(filter.path) : null

  return events.filter((event) => {
    if (actions && !actions.has(event.action)) return false
    if (path && !eventPaths(event).some((candidate) => normalizePath(candidate) === path)) {
      return false
    }
    return true
  })
}

function normalizeAuditEvent(event: AuditEvent): AuditEvent {
  const base: AuditEvent = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    timestamp: event.timestamp ?? new Date().toISOString(),
    category: event.category ?? categoryFromAction(event.action),
    ...event,
  }
  const pathNormalized = normalizePathFields(base) as AuditEvent
  const reasonNormalized = normalizeReasons(pathNormalized)
  return redactAuditEvent(reasonNormalized)
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { action?: unknown }).action === "string"
  )
}

function eventPaths(event: AuditEvent): string[] {
  return [event.pagePath, event.targetPath, event.sourcePath].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
}

function categoryFromAction(action: string): AuditEventCategory {
  const prefix = action.split(".")[0]
  if (prefix === "query") return "query"
  if (prefix === "search") return "search"
  if (prefix === "ingest") return "ingest"
  if (prefix === "review") return "review"
  if (prefix === "crystallize") return "crystallize"
  if (prefix === "lifecycle") return "lifecycle"
  if (prefix === "claim") return "claim"
  if (action === "schema.scan") return "schema"
  if (action === "quality.scan") return "quality"
  if (action === "digest.preview" || action === "digest.save") return "crystallize"
  if (prefix === "memory_ops") return "memory_ops"
  return "other"
}

function normalizeReasons(event: AuditEvent): AuditEvent {
  if (!Array.isArray(event.reasons)) return event
  const seen = new Set<string>()
  const reasons: string[] = []
  for (const reason of event.reasons) {
    const trimmed = String(reason).trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    reasons.push(trimmed)
  }
  if (reasons.length > 0) return { ...event, reasons }
  const { reasons: _reasons, ...rest } = event
  return rest
}

function normalizePathFields(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    return isPathKey(key) ? normalizePath(value) : value
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizePathFields(item, key))
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = normalizePathFields(childValue, childKey)
    }
    return out
  }

  return value
}

function isPathKey(key: string | undefined): boolean {
  return key === "pagePath" || key === "targetPath" || key === "sourcePath" || key === "path"
}

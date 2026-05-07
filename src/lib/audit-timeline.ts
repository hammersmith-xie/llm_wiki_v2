import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface AuditEvent {
  timestamp?: string
  action: string
  pagePath?: string
  targetPath?: string
  sourcePath?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reasons?: string[]
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
  const line = JSON.stringify(normalized)

  await createDirectory(dir).catch(() => {})
  let existing = ""
  try {
    existing = await readFile(path)
  } catch {
    existing = ""
  }

  const next =
    existing.trim().length > 0
      ? `${existing.replace(/\s*$/, "")}\n${line}\n`
      : `${line}\n`
  await writeFile(path, next)
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
  return {
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...event,
  }
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

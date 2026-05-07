import type {
  AuditEvent,
  AuditEventCategory,
  AuditTimelineWarning,
} from "@/lib/audit-timeline"
import { normalizePath } from "@/lib/path-utils"

export interface AuditTimelineUiFilter {
  category?: AuditEventCategory | "all"
  action?: string
  path?: string
  scope?: string
  status?: string
  text?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
}

export interface AuditTimelineEventSummary {
  event: AuditEvent
  timestamp?: string
  action: string
  category: AuditEventCategory | "other"
  actor?: string
  targetLabel: string
  status?: string
  scope?: string
  reasonText: string
  retrievalText?: string
  diffText?: string
}

export interface AuditTimelineWarningsSummary {
  count: number
  lines: number[]
  messages: string[]
}

export function filterAuditTimelineEvents(
  events: readonly AuditEvent[],
  filter: AuditTimelineUiFilter = {},
): AuditEvent[] {
  const normalizedAction = normalizeText(filter.action)
  const normalizedPath = filter.path ? normalizePath(filter.path) : ""
  const normalizedScope = normalizeText(filter.scope)
  const normalizedStatus = normalizeText(filter.status)
  const normalizedText = normalizeText(filter.text)
  const fromTime = filter.dateFrom ? Date.parse(filter.dateFrom) : Number.NEGATIVE_INFINITY
  const toTime = filter.dateTo ? Date.parse(filter.dateTo) : Number.POSITIVE_INFINITY
  const limit = Math.max(0, filter.limit ?? events.length)

  const results: AuditEvent[] = []
  for (const event of sortAuditTimelineEvents(events)) {
    if (filter.category && filter.category !== "all" && eventCategory(event) !== filter.category) continue
    if (normalizedAction && !normalizeText(event.action).includes(normalizedAction)) continue
    if (normalizedPath && !eventPathValues(event).some((path) => normalizePath(path).includes(normalizedPath))) continue
    if (normalizedScope && normalizeText(event.scope).trim() !== normalizedScope) continue
    if (normalizedStatus && normalizeText(eventStatus(event)).trim() !== normalizedStatus) continue
    if (normalizedText && !normalizeText(JSON.stringify(event)).includes(normalizedText)) continue
    const time = timestampValue(event.timestamp)
    if (time < fromTime || time > toTime) continue
    results.push(event)
    if (results.length >= limit) break
  }
  return results
}

export function summarizeAuditTimelineEvent(event: AuditEvent): AuditTimelineEventSummary {
  return {
    event,
    timestamp: event.timestamp,
    action: event.action,
    category: eventCategory(event),
    actor: event.actor,
    targetLabel: auditTimelineTargetLabel(event),
    status: eventStatus(event),
    scope: event.scope,
    reasonText: (event.reasons ?? []).join("; "),
    retrievalText: retrievalSummaryText(event),
    diffText: diffSummaryText(event),
  }
}

export function summarizeAuditTimelineWarnings(
  warnings: readonly AuditTimelineWarning[],
): AuditTimelineWarningsSummary {
  return {
    count: warnings.length,
    lines: warnings.map((warning) => warning.line),
    messages: warnings.map((warning) => warning.message),
  }
}

export function sortAuditTimelineEvents(events: readonly AuditEvent[]): AuditEvent[] {
  return [...events].sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp))
}

export function auditTimelineTargetLabel(event: AuditEvent): string {
  return event.targetPath ?? event.pagePath ?? event.sourcePath ?? ".llm-wiki/audit.jsonl"
}

function eventCategory(event: AuditEvent): AuditEventCategory | "other" {
  return event.category ?? "other"
}

function eventStatus(event: AuditEvent): string | undefined {
  const status = event.changes?.status
  if (typeof status === "string" && status.trim()) return status
  const afterStatus = event.after?.status
  return typeof afterStatus === "string" && afterStatus.trim() ? afterStatus : undefined
}

function eventPathValues(event: AuditEvent): string[] {
  const paths = [event.targetPath, event.pagePath, event.sourcePath].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  const retrievalPaths =
    event.retrieval?.results
      ?.map((result) => result.path)
      .filter((value): value is string => typeof value === "string" && value.length > 0) ?? []
  return [...paths, ...retrievalPaths]
}

function retrievalSummaryText(event: AuditEvent): string | undefined {
  const retrieval = event.retrieval
  if (!retrieval) return undefined
  const query = retrieval.query ? `query "${retrieval.query}"` : "retrieval"
  const streamCount = retrieval.streams?.length ?? 0
  const resultCount = retrieval.results?.length ?? 0
  return `${query}; ${streamCount} stream${streamCount === 1 ? "" : "s"}; ${resultCount} result${resultCount === 1 ? "" : "s"}`
}

function diffSummaryText(event: AuditEvent): string | undefined {
  const diff = event.changes?.diff
  if (!diff || diff.length === 0) return undefined
  return diff.map((item) => item.field).join(", ")
}

function timestampValue(timestamp: string | undefined): number {
  if (!timestamp) return 0
  const value = Date.parse(timestamp)
  return Number.isFinite(value) ? value : 0
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

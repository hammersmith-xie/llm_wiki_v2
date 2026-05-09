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

export interface AuditTimelineCountBucket {
  key: string
  count: number
  percentage: number
}

export interface AuditTimelineDayBucket extends AuditTimelineCountBucket {
  date: string
}

export interface AuditTimelineVisualizationSummary {
  totalCount: number
  activeDayCount: number
  categoryBuckets: AuditTimelineCountBucket[]
  statusBuckets: AuditTimelineCountBucket[]
  dayBuckets: AuditTimelineDayBucket[]
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

export function buildAuditTimelineVisualizationSummary(
  events: readonly AuditEvent[],
  options: { maxDayBuckets?: number; maxCategoryBuckets?: number; maxStatusBuckets?: number } = {},
): AuditTimelineVisualizationSummary {
  const sorted = sortAuditTimelineEvents(events)
  const totalCount = sorted.length
  const dayCounts = new Map<string, number>()
  const categoryCounts = new Map<string, number>()
  const statusCounts = new Map<string, number>()

  for (const event of sorted) {
    const day = dayKey(event.timestamp)
    if (day) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
    const category = eventCategory(event)
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
    const status = eventStatus(event) ?? "unknown"
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1)
  }

  const maxDayBuckets = Math.max(0, options.maxDayBuckets ?? 14)
  return {
    totalCount,
    activeDayCount: dayCounts.size,
    categoryBuckets: countBuckets(categoryCounts, totalCount, options.maxCategoryBuckets ?? 6),
    statusBuckets: countBuckets(statusCounts, totalCount, options.maxStatusBuckets ?? 6),
    dayBuckets: [...dayCounts.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, maxDayBuckets)
      .reverse()
      .map(([date, count]) => ({
        key: date,
        date,
        count,
        percentage: percentage(count, maxMapValue(dayCounts)),
      })),
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

function countBuckets(
  counts: ReadonlyMap<string, number>,
  totalCount: number,
  limit: number,
): AuditTimelineCountBucket[] {
  return [...counts.entries()]
    .sort(([aKey, aCount], [bKey, bCount]) => {
      if (bCount !== aCount) return bCount - aCount
      return aKey.localeCompare(bKey)
    })
    .slice(0, Math.max(0, limit))
    .map(([key, count]) => ({
      key,
      count,
      percentage: percentage(count, totalCount),
    }))
}

function dayKey(timestamp: string | undefined): string | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function maxMapValue(map: ReadonlyMap<string, number>): number {
  return Math.max(0, ...map.values())
}

function percentage(count: number, totalCount: number): number {
  if (totalCount <= 0) return 0
  return Math.round((count / totalCount) * 100)
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

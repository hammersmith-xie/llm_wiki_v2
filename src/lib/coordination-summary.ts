import type { AuditEvent } from "@/lib/audit-timeline"
import { auditTimelineTargetLabel, sortAuditTimelineEvents } from "@/lib/audit-timeline-ui"
import type { SchemaDriftFinding } from "@/lib/schema-drift"
import { normalizePath } from "@/lib/path-utils"
import type { ReviewItem } from "@/stores/review-store"

export interface CoordinationSummaryInput {
  auditEvents?: readonly AuditEvent[]
  reviewItems?: readonly ReviewItem[]
  schemaFindings?: readonly SchemaDriftFinding[]
  now?: number
  maxRecentEvents?: number
  maxTargets?: number
  maxPendingReviews?: number
  maxBlockedFindings?: number
}

export interface CoordinationActorActivity {
  actor: string
  eventCount: number
  lastAction?: string
  lastTimestamp?: string
  actionCounts: Record<string, number>
  targetPaths: string[]
}

export interface CoordinationRecentEvent {
  action: string
  actor: string
  targetPath: string
  pagePath?: string
  sourcePath?: string
  status?: string
  scope?: string
  timestamp?: string
  reasonText?: string
  private: boolean
}

export interface CoordinationTargetSummary {
  targetPath: string
  eventCount: number
  lastAction: string
  lastTimestamp?: string
  actors: string[]
  statuses: string[]
  scopes: string[]
}

export interface CoordinationPendingReview {
  id: string
  type: ReviewItem["type"]
  title: string
  targetPath?: string
  sourcePath?: string
  createdAt: number
  optionCount: number
}

export interface CoordinationBlockedFinding {
  id: string
  kind: string
  severity: string
  targetPath: string
  title: string
  field?: string
  candidateTarget?: string
  reviewOnly: boolean
}

export interface CoordinationPromotionCandidate {
  targetPath: string
  reason: string
  lastTimestamp?: string
}

export interface CoordinationSummary {
  generatedAt: string
  totals: {
    auditEventCount: number
    actorCount: number
    targetCount: number
    pendingReviewCount: number
    blockedFindingCount: number
    privateEventCount: number
  }
  actors: CoordinationActorActivity[]
  recentEvents: CoordinationRecentEvent[]
  targets: CoordinationTargetSummary[]
  pendingReviews: CoordinationPendingReview[]
  blockedFindings: CoordinationBlockedFinding[]
  promotionCandidates: CoordinationPromotionCandidate[]
}

const DEFAULT_MAX_RECENT_EVENTS = 20
const DEFAULT_MAX_TARGETS = 20
const DEFAULT_MAX_PENDING_REVIEWS = 20
const DEFAULT_MAX_BLOCKED_FINDINGS = 20

export function buildCoordinationSummary(
  input: CoordinationSummaryInput,
): CoordinationSummary {
  const events = sortAuditTimelineEvents(input.auditEvents ?? [])
  const maxRecentEvents = input.maxRecentEvents ?? DEFAULT_MAX_RECENT_EVENTS
  const maxTargets = input.maxTargets ?? DEFAULT_MAX_TARGETS
  const maxPendingReviews = input.maxPendingReviews ?? DEFAULT_MAX_PENDING_REVIEWS
  const maxBlockedFindings = input.maxBlockedFindings ?? DEFAULT_MAX_BLOCKED_FINDINGS

  const recentEvents = events.slice(0, maxRecentEvents).map(summarizeRecentEvent)
  const actors = summarizeActors(events)
  const targets = summarizeTargets(events).slice(0, maxTargets)
  const pendingReviews = summarizePendingReviews(input.reviewItems ?? [])
    .slice(0, maxPendingReviews)
  const blockedFindings = summarizeBlockedFindings(input.schemaFindings ?? [])
    .slice(0, maxBlockedFindings)
  const promotionCandidates = summarizePromotionCandidates(events, blockedFindings)
  const privateEventCount = events.filter(isPrivateEvent).length

  return {
    generatedAt: new Date(input.now ?? Date.now()).toISOString(),
    totals: {
      auditEventCount: events.length,
      actorCount: actors.length,
      targetCount: targets.length,
      pendingReviewCount: (input.reviewItems ?? []).filter((item) => !item.resolved).length,
      blockedFindingCount: (input.schemaFindings ?? []).filter(isBlockedFinding).length,
      privateEventCount,
    },
    actors,
    recentEvents,
    targets,
    pendingReviews,
    blockedFindings,
    promotionCandidates,
  }
}

function summarizeActors(events: readonly AuditEvent[]): CoordinationActorActivity[] {
  const byActor = new Map<string, CoordinationActorActivity>()
  for (const event of events) {
    const actor = event.actor ?? "unknown"
    const targetPath = normalizedTargetPath(event)
    const existing = byActor.get(actor)
    if (existing) {
      existing.eventCount += 1
      existing.actionCounts[event.action] = (existing.actionCounts[event.action] ?? 0) + 1
      if (targetPath && !existing.targetPaths.includes(targetPath)) {
        existing.targetPaths.push(targetPath)
      }
      if (timestampValue(event.timestamp) > timestampValue(existing.lastTimestamp)) {
        existing.lastAction = event.action
        existing.lastTimestamp = event.timestamp
      }
      continue
    }

    byActor.set(actor, {
      actor,
      eventCount: 1,
      lastAction: event.action,
      lastTimestamp: event.timestamp,
      actionCounts: { [event.action]: 1 },
      targetPaths: targetPath ? [targetPath] : [],
    })
  }

  return [...byActor.values()].sort((a, b) => {
    if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount
    return timestampValue(b.lastTimestamp) - timestampValue(a.lastTimestamp)
  })
}

function summarizeRecentEvent(event: AuditEvent): CoordinationRecentEvent {
  const privateEvent = isPrivateEvent(event)
  return {
    action: event.action,
    actor: event.actor ?? "unknown",
    targetPath: normalizedTargetPath(event),
    pagePath: privateEvent ? undefined : normalizeOptionalPath(event.pagePath),
    sourcePath: privateEvent ? undefined : normalizeOptionalPath(event.sourcePath),
    status: eventStatus(event),
    scope: event.scope,
    timestamp: event.timestamp,
    reasonText: privateEvent ? privateReasonText(event) : (event.reasons ?? []).join("; "),
    private: privateEvent,
  }
}

function summarizeTargets(events: readonly AuditEvent[]): CoordinationTargetSummary[] {
  const byTarget = new Map<string, CoordinationTargetSummary>()
  for (const event of events) {
    const targetPath = normalizedTargetPath(event)
    const actor = event.actor ?? "unknown"
    const status = eventStatus(event)
    const scope = event.scope
    const existing = byTarget.get(targetPath)
    if (existing) {
      existing.eventCount += 1
      if (!existing.actors.includes(actor)) existing.actors.push(actor)
      if (status && !existing.statuses.includes(status)) existing.statuses.push(status)
      if (scope && !existing.scopes.includes(scope)) existing.scopes.push(scope)
      if (timestampValue(event.timestamp) > timestampValue(existing.lastTimestamp)) {
        existing.lastAction = event.action
        existing.lastTimestamp = event.timestamp
      }
      continue
    }

    byTarget.set(targetPath, {
      targetPath,
      eventCount: 1,
      lastAction: event.action,
      lastTimestamp: event.timestamp,
      actors: [actor],
      statuses: status ? [status] : [],
      scopes: scope ? [scope] : [],
    })
  }

  return [...byTarget.values()].sort((a, b) => {
    if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount
    return timestampValue(b.lastTimestamp) - timestampValue(a.lastTimestamp)
  })
}

function summarizePendingReviews(
  reviewItems: readonly ReviewItem[],
): CoordinationPendingReview[] {
  return reviewItems
    .filter((item) => !item.resolved)
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      targetPath: normalizeOptionalPath(item.affectedPages?.[0]),
      sourcePath: normalizeOptionalPath(item.sourcePath),
      createdAt: item.createdAt,
      optionCount: item.options.length,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

function summarizeBlockedFindings(
  findings: readonly SchemaDriftFinding[],
): CoordinationBlockedFinding[] {
  return findings
    .filter(isBlockedFinding)
    .map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      severity: finding.severity,
      targetPath: normalizePath(finding.targetPath),
      title: finding.title,
      field: finding.field,
      candidateTarget: finding.candidateTarget,
      reviewOnly: !finding.proposedOperation,
    }))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "warning" ? -1 : 1
      return a.targetPath.localeCompare(b.targetPath)
    })
}

function summarizePromotionCandidates(
  events: readonly AuditEvent[],
  blockedFindings: readonly CoordinationBlockedFinding[],
): CoordinationPromotionCandidate[] {
  const blockedTargets = new Set(blockedFindings.map((finding) => finding.targetPath))
  const byTarget = new Map<string, CoordinationPromotionCandidate>()
  for (const event of events) {
    if (event.scope !== "private") continue
    const status = eventStatus(event)
    if (status && ["ignored", "error"].includes(status)) continue
    const targetPath = normalizedTargetPath(event)
    if (blockedTargets.has(targetPath)) continue
    const existing = byTarget.get(targetPath)
    if (existing && timestampValue(existing.lastTimestamp) >= timestampValue(event.timestamp)) {
      continue
    }
    byTarget.set(targetPath, {
      targetPath,
      reason: "private scoped activity may need shared promotion review",
      lastTimestamp: event.timestamp,
    })
  }
  return [...byTarget.values()].sort(
    (a, b) => timestampValue(b.lastTimestamp) - timestampValue(a.lastTimestamp),
  )
}

function isBlockedFinding(finding: SchemaDriftFinding): boolean {
  return finding.severity === "warning" || !finding.proposedOperation
}

function isPrivateEvent(event: AuditEvent): boolean {
  return event.scope === "private"
}

function privateReasonText(event: AuditEvent): string {
  const reasonCount = event.reasons?.length ?? 0
  return reasonCount > 0
    ? `${reasonCount} private reason${reasonCount === 1 ? "" : "s"} redacted`
    : "private event detail redacted"
}

function normalizedTargetPath(event: AuditEvent): string {
  return normalizePath(auditTimelineTargetLabel(event))
}

function normalizeOptionalPath(path: string | undefined): string | undefined {
  return path ? normalizePath(path) : undefined
}

function eventStatus(event: AuditEvent): string | undefined {
  const status = event.changes?.status
  if (typeof status === "string" && status.trim()) return status
  const afterStatus = event.after?.status
  return typeof afterStatus === "string" && afterStatus.trim() ? afterStatus : undefined
}

function timestampValue(timestamp: string | undefined): number {
  if (!timestamp) return 0
  const value = Date.parse(timestamp)
  return Number.isFinite(value) ? value : 0
}

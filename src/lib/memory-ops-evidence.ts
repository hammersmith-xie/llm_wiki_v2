import type { AuditEvent } from "@/lib/audit-timeline"
import { summarizeClaimProvenance } from "@/lib/claim-provenance"
import type { ClaimRecord } from "@/lib/claims"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { lifecycleMetadataFromFrontmatter } from "@/lib/lifecycle"
import {
  DEFAULT_MEMORY_OPS_POLICY,
  memoryOpsHalfLifeForLifecycle,
  type MemoryOpsPolicy,
} from "@/lib/memory-ops-policy"
import type {
  MemoryOpsClaimHealthSummary,
  MemoryOpsEvidenceRiskFlag,
  MemoryOpsPageEvidenceSummary,
  MemoryOpsSnapshotStats,
  MemoryOpsWikiPage,
} from "@/lib/memory-ops-types"
import { normalizePath } from "@/lib/path-utils"
import type { TypedGraph } from "@/lib/typed-graph"
import type { ReviewItem } from "@/stores/review-store"

const RECENT_USE_ACTION_PREFIXES = ["query.", "search.", "chat."]
const REINFORCING_ACTION_PREFIXES = [
  "chat.",
  "query.",
  "search.",
  "crystallize.",
  "review.resolve",
  "memory_ops.apply",
]

interface PageEvidenceContext {
  projectPath: string
  graph: TypedGraph
  auditEvents: readonly AuditEvent[]
  reviewItems: readonly ReviewItem[]
  today?: string
  policy: MemoryOpsPolicy
}

export function attachPageEvidence(
  pages: readonly MemoryOpsWikiPage[],
  context: PageEvidenceContext,
): MemoryOpsWikiPage[] {
  return pages.map((page) => ({
    ...page,
    evidence: buildPageEvidenceSummary(page, context),
  }))
}

export function buildPageEvidenceSummary(
  page: MemoryOpsWikiPage,
  context: PageEvidenceContext,
): MemoryOpsPageEvidenceSummary {
  const frontmatter = page.frontmatter ?? parseFrontmatter(page.content).frontmatter
  const pageKeys = pagePathKeys(context.projectPath, page)
  const relevantEvents = context.auditEvents.filter((event) =>
    auditEventReferencesPage(event, context.projectPath, pageKeys),
  )
  const recentUseEvents = relevantEvents.filter((event) =>
    hasActionPrefix(event, RECENT_USE_ACTION_PREFIXES),
  )
  const reinforcingEvents = relevantEvents.filter((event) =>
    hasActionPrefix(event, REINFORCING_ACTION_PREFIXES),
  )
  const metadata = lifecycleMetadataFromFrontmatter(frontmatter, context.today)
  const lastConfirmed =
    scalar(frontmatter?.last_confirmed) ??
    scalar(frontmatter?.updated) ??
    scalar(frontmatter?.created)
  const ageDays = lastConfirmed
    ? daysBetween(lastConfirmed, context.today ?? new Date().toISOString().slice(0, 10))
    : undefined
  const contradictionCount = arrayValue(frontmatter?.contradicts).length
  const supersededByCount = arrayValue(frontmatter?.superseded_by).length
  const openReviewItemCount = countOpenReviewItems(
    context.reviewItems,
    context.projectPath,
    pageKeys,
  )
  const stale =
    metadata.reviewStatus === "stale" ||
    metadata.reviewStatus === "contradicted" ||
    isStaleByAge(metadata.lifecycle, ageDays, context.policy)
  const flags: MemoryOpsEvidenceRiskFlag[] = []

  if (stale) flags.push("stale")
  if (metadata.reviewStatus === "contradicted" || contradictionCount > 0) {
    flags.push("contradicted")
  }
  if (supersededByCount > 0) flags.push("superseded")
  if (openReviewItemCount > 0) flags.push("open-review")

  const frontmatterReinforcementCount = parseInteger(
    scalar(frontmatter?.reinforcement_count),
  )
  const auditReinforcementCount = reinforcingEvents.length

  return {
    pagePath: toProjectRelativePath(context.projectPath, page.path),
    recentUse: {
      eventCount: recentUseEvents.length,
      lastUsedAt: latestTimestamp(recentUseEvents),
    },
    reinforcement: {
      frontmatterCount: frontmatterReinforcementCount,
      auditEventCount: auditReinforcementCount,
      totalCount: frontmatterReinforcementCount + auditReinforcementCount,
      lastReinforcedAt: latestTimestamp(reinforcingEvents),
    },
    sourceSupport: {
      sourceCount: arrayValue(frontmatter?.sources).length,
      supportingRelationCount: countSupportingRelations(context.graph, page.id),
    },
    staleness: {
      lastConfirmed,
      ageDays,
      stale,
    },
    risk: {
      contradictionCount,
      supersededByCount,
      openReviewItemCount,
      flags,
    },
  }
}

export function summarizeEvidenceStats(
  pages: readonly MemoryOpsWikiPage[],
): Pick<
  MemoryOpsSnapshotStats,
  | "pageEvidenceCount"
  | "pagesWithRecentUseCount"
  | "pagesWithReinforcementCount"
  | "pagesWithSourceSupportCount"
  | "stalePageCount"
  | "riskPageCount"
> {
  let pagesWithRecentUseCount = 0
  let pagesWithReinforcementCount = 0
  let pagesWithSourceSupportCount = 0
  let stalePageCount = 0
  let riskPageCount = 0

  for (const page of pages) {
    const evidence = page.evidence
    if (!evidence) continue
    if (evidence.recentUse.eventCount > 0) pagesWithRecentUseCount++
    if (evidence.reinforcement.totalCount > 0) pagesWithReinforcementCount++
    if (evidence.sourceSupport.sourceCount + evidence.sourceSupport.supportingRelationCount > 0) {
      pagesWithSourceSupportCount++
    }
    if (evidence.staleness.stale) stalePageCount++
    if (evidence.risk.flags.length > 0) riskPageCount++
  }

  return {
    pageEvidenceCount: pages.length,
    pagesWithRecentUseCount,
    pagesWithReinforcementCount,
    pagesWithSourceSupportCount,
    stalePageCount,
    riskPageCount,
  }
}

export function summarizeClaimHealth(
  claims: readonly ClaimRecord[],
  pages: readonly MemoryOpsWikiPage[],
  projectPath: string,
): MemoryOpsClaimHealthSummary {
  const pagePaths = new Set(pages.map((page) => toProjectRelativePath(projectPath, page.path)))
  let staleCount = 0
  let contradictedCount = 0
  let supersededCount = 0
  let orphanCount = 0
  let reinforcedCount = 0
  let missingSourceRefCount = 0
  let missingSnippetHashCount = 0

  for (const claim of claims) {
    const provenance = summarizeClaimProvenance(claim)
    if (claim.status === "stale") staleCount++
    if (claim.status === "contradicted") contradictedCount++
    if (claim.status === "superseded") supersededCount++
    if (!pagePaths.has(toProjectRelativePath(projectPath, claim.page_path))) orphanCount++
    if (parseInteger(claim.reinforcement_count) > 0) reinforcedCount++
    if (provenance.missingSourceRefs) missingSourceRefCount++
    if (provenance.missingSnippetHash) missingSnippetHashCount++
  }

  return {
    claimCount: claims.length,
    staleCount,
    contradictedCount,
    supersededCount,
    orphanCount,
    reinforcedCount,
    missingSourceRefCount,
    missingSnippetHashCount,
  }
}

function pagePathKeys(projectPath: string, page: MemoryOpsWikiPage): Set<string> {
  const relativePath = toProjectRelativePath(projectPath, page.path)
  return new Set([normalizePath(page.path), relativePath])
}

function auditEventReferencesPage(
  event: AuditEvent,
  projectPath: string,
  pageKeys: ReadonlySet<string>,
): boolean {
  return auditEventPaths(event)
    .map((path) => normalizeEvidencePath(projectPath, path))
    .some((path) => pageKeys.has(path))
}

function auditEventPaths(event: AuditEvent): string[] {
  const directPaths = [event.pagePath, event.targetPath, event.sourcePath].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  const retrievalPaths =
    event.retrieval?.results
      ?.map((result) => result.path)
      .filter((value): value is string => typeof value === "string" && value.length > 0) ?? []
  return [...directPaths, ...retrievalPaths]
}

function countOpenReviewItems(
  reviewItems: readonly ReviewItem[],
  projectPath: string,
  pageKeys: ReadonlySet<string>,
): number {
  let count = 0
  for (const item of reviewItems) {
    if (item.resolved) continue
    const paths = [...(item.affectedPages ?? []), item.sourcePath].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    if (paths.some((path) => pageKeys.has(normalizeEvidencePath(projectPath, path)))) {
      count++
    }
  }
  return count
}

function countSupportingRelations(graph: TypedGraph, pageId: string): number {
  return graph.edges.filter((edge) => edge.type === "supports" && edge.target === pageId).length
}

function isStaleByAge(
  lifecycle: string,
  ageDays: number | undefined,
  policy: MemoryOpsPolicy = DEFAULT_MEMORY_OPS_POLICY,
): boolean {
  if (ageDays === undefined) return false
  const halfLifeDays = memoryOpsHalfLifeForLifecycle(lifecycle, policy)
  return ageDays > halfLifeDays * policy.staleMultiplier
}

function hasActionPrefix(event: AuditEvent, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => event.action.startsWith(prefix))
}

function latestTimestamp(events: readonly AuditEvent[]): string | undefined {
  let latest: string | undefined
  let latestTime = Number.NEGATIVE_INFINITY
  for (const event of events) {
    if (!event.timestamp) continue
    const time = Date.parse(event.timestamp)
    if (!Number.isFinite(time) || time <= latestTime) continue
    latest = event.timestamp
    latestTime = time
  }
  return latest
}

function normalizeEvidencePath(projectPath: string, path: string): string {
  return toProjectRelativePath(projectPath, path)
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

function scalar(value: FrontmatterValue | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function arrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value
  if (value) return [value]
  return []
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(startDate)
  const end = Date.parse(endDate)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.floor((end - start) / 86_400_000)
}

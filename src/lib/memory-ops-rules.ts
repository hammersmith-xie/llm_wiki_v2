import {
  lifecycleMetadataFromFrontmatter,
  type LifecycleMetadata,
  type ReviewStatus,
} from "@/lib/lifecycle"
import type { MetadataPatchOperation } from "@/lib/memory-ops-executor"
import type {
  MemoryOpsPageEvidenceSummary,
  MemoryOpsProjectSnapshot,
  MemoryOpsWikiPage,
} from "@/lib/memory-ops"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"
import { WIKI_TYPED_RELATION_ARRAY_FIELDS } from "@/lib/wiki-frontmatter-fields"

export type MemoryOpsSuggestionKind = "metadata-update" | "relation-cleanup"
export type MemoryOpsSuggestionSeverity = "info" | "warning"

export interface MemoryOpsRelationIssue {
  field: string
  target: string
  candidateTarget?: string
}

export interface MemoryOpsSuggestion {
  id: string
  kind: MemoryOpsSuggestionKind
  severity: MemoryOpsSuggestionSeverity
  targetPath: string
  title: string
  detail: string
  reasons: string[]
  proposedOperation?: MetadataPatchOperation
  relation?: MemoryOpsRelationIssue
}

const REINFORCING_ACTION_PREFIXES = [
  "chat.",
  "query.",
  "search.",
  "crystallize.",
  "review.resolve",
  "memory_ops.apply",
]
const LOW_CONFIDENCE_THRESHOLD = 0.45

export function evaluateLifecycleSuggestions(
  snapshot: MemoryOpsProjectSnapshot,
  options: { today?: string } = {},
): MemoryOpsSuggestion[] {
  const suggestions: MemoryOpsSuggestion[] = []

  for (const page of snapshot.pages) {
    const frontmatter = page.frontmatter ?? parseFrontmatter(page.content).frontmatter
    const metadata = lifecycleMetadataFromFrontmatter(frontmatter, options.today)

    const staleSuggestion = staleMetadataSuggestion(page, frontmatter, metadata.reviewStatus, metadata.confidenceReasons)
    if (staleSuggestion) suggestions.push(staleSuggestion)

    const lowConfidenceSuggestion = lowConfidenceSuggestionForPage(page, frontmatter, metadata)
    if (lowConfidenceSuggestion) suggestions.push(lowConfidenceSuggestion)

    const refreshSuggestion = lastConfirmedRefreshSuggestion(page, frontmatter)
    if (refreshSuggestion) suggestions.push(refreshSuggestion)

    const reinforcementSuggestion = reinforcementCountSuggestion(snapshot, page, frontmatter)
    if (reinforcementSuggestion) suggestions.push(reinforcementSuggestion)

    const promotionSuggestion = promotionSuggestionForPage(page, frontmatter)
    if (promotionSuggestion) suggestions.push(promotionSuggestion)

    const archiveSuggestion = archiveSuggestionForPage(page, frontmatter, metadata)
    if (archiveSuggestion) suggestions.push(archiveSuggestion)
  }

  return suggestions
}

export function evaluateRelationCleanupSuggestions(
  snapshot: MemoryOpsProjectSnapshot,
): MemoryOpsSuggestion[] {
  const suggestions: MemoryOpsSuggestion[] = []
  const resolver = buildPageResolver(snapshot.pages)

  for (const page of snapshot.pages) {
    const frontmatter = page.frontmatter ?? parseFrontmatter(page.content).frontmatter
    for (const field of WIKI_TYPED_RELATION_ARRAY_FIELDS) {
      for (const target of arrayValue(frontmatter?.[field])) {
        if (resolver.has(page.id, target)) continue
        const candidate = resolver.findCandidate(page.id, target)
        const supersession = field === "supersedes" || field === "superseded_by"
        suggestions.push({
          id: suggestionId("relation", page.path, field, target),
          kind: "relation-cleanup",
          severity: supersession ? "warning" : "info",
          targetPath: page.path,
          title: supersession ? "Review dangling supersession" : "Review unresolved typed relation",
          detail: candidate
            ? `Field ${field} points to "${target}", which does not resolve. Candidate page: ${candidate}.`
            : `Field ${field} points to "${target}", which does not resolve to a wiki page.`,
          reasons: [
            `${field} is an explicit typed relationship field`,
            candidate ? `candidate target ${candidate}` : "no matching page, title, or alias found",
          ],
          relation: {
            field,
            target,
            candidateTarget: candidate,
          },
        })
      }
    }
  }

  return suggestions
}

function staleMetadataSuggestion(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
  reviewStatus: ReviewStatus,
  reasons: readonly string[],
): MemoryOpsSuggestion | null {
  if (reviewStatus !== "stale" && reviewStatus !== "contradicted") return null
  if (scalar(frontmatter?.review_status) === reviewStatus) return null

  const severity = reviewStatus === "contradicted" ? "warning" : "info"
  return {
    id: suggestionId("lifecycle", page.path, reviewStatus),
    kind: "metadata-update",
    severity,
    targetPath: page.path,
    title: reviewStatus === "contradicted" ? "Mark contradicted page" : "Mark stale page",
    detail: `Set review_status to ${reviewStatus}.`,
    reasons: reasons.length > 0 ? [...reasons] : [`review status resolved to ${reviewStatus}`],
    proposedOperation: {
      kind: "metadata-patch",
      targetPath: page.path,
      fields: { review_status: reviewStatus },
      reason: `Memory Ops lifecycle patrol: ${reviewStatus}`,
    },
  }
}

function lowConfidenceSuggestionForPage(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
  metadata: LifecycleMetadata,
): MemoryOpsSuggestion | null {
  if (metadata.reviewStatus !== "needs-review") return null
  if (scalar(frontmatter?.review_status) === "needs-review") return null
  if (metadata.confidence >= LOW_CONFIDENCE_THRESHOLD) return null

  const confidence = formatScore(metadata.confidence)
  const reason = `confidence ${confidence} is below ${formatScore(LOW_CONFIDENCE_THRESHOLD)}`
  return {
    id: suggestionId("lifecycle", page.path, "low-confidence"),
    kind: "metadata-update",
    severity: "warning",
    targetPath: page.path,
    title: "Mark low-confidence page for review",
    detail: "Set review_status to needs-review and persist confidence evidence.",
    reasons: [reason, ...metadata.confidenceReasons],
    proposedOperation: {
      kind: "metadata-patch",
      targetPath: page.path,
      fields: {
        review_status: "needs-review",
        confidence,
        confidence_reasons: metadata.confidenceReasons,
      },
      reason: `Memory Ops lifecycle patrol: ${reason}`,
    },
  }
}

function lastConfirmedRefreshSuggestion(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
): MemoryOpsSuggestion | null {
  const evidence = page.evidence
  if (!evidence?.reinforcement.lastReinforcedAt) return null
  if (!hasSourceSupport(evidence)) return null
  if (hasBlockingRisk(evidence)) return null

  const latestConfirmed = evidence.reinforcement.lastReinforcedAt.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latestConfirmed)) return null
  const current = scalar(frontmatter?.last_confirmed)
  if (current && latestConfirmed <= current) return null

  const reason = `latest reinforcement landed on ${latestConfirmed}`
  return {
    id: suggestionId("lifecycle", page.path, "last-confirmed", latestConfirmed),
    kind: "metadata-update",
    severity: "info",
    targetPath: page.path,
    title: "Refresh last confirmed date",
    detail: `Set last_confirmed to ${latestConfirmed}.`,
    reasons: [reason, "page has source support and no contradiction risk"],
    proposedOperation: {
      kind: "metadata-patch",
      targetPath: page.path,
      fields: { last_confirmed: latestConfirmed },
      reason: `Memory Ops lifecycle patrol: ${reason}`,
    },
  }
}

function reinforcementCountSuggestion(
  snapshot: MemoryOpsProjectSnapshot,
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
): MemoryOpsSuggestion | null {
  const current = parseInteger(scalar(frontmatter?.reinforcement_count))
  const count = page.evidence?.reinforcement.auditEventCount ?? countReinforcingAuditEvents(snapshot, page)
  if (count <= current) return null

  const reason = `${count} reinforcing audit event${count === 1 ? "" : "s"} reference${count === 1 ? "s" : ""} this page`
  return {
    id: suggestionId("reinforcement", page.path, String(count)),
    kind: "metadata-update",
    severity: "info",
    targetPath: page.path,
    title: "Update reinforcement count",
    detail: `Set reinforcement_count to ${count}.`,
    reasons: [reason],
    proposedOperation: {
      kind: "metadata-patch",
      targetPath: page.path,
      fields: { reinforcement_count: String(count) },
      reason: `Memory Ops lifecycle patrol: ${reason}`,
    },
  }
}

function archiveSuggestionForPage(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
  metadata: LifecycleMetadata,
): MemoryOpsSuggestion | null {
  if (scalar(frontmatter?.lifecycle) === "archived") return null

  const evidence = page.evidence
  const stale = evidence?.staleness.stale ?? metadata.reviewStatus === "stale"
  if (!stale) return null
  if (!isUnsupportedByEvidence(frontmatter, evidence)) return null
  if (hasRecentUseOrReinforcement(frontmatter, evidence)) return null
  if (hasBlockingRisk(evidence)) return null

  const reasons = [
    "stale page has no source support",
    "no reinforcement signals",
    "no recent use signals",
  ]
  return {
    id: suggestionId("lifecycle", page.path, "archive"),
    kind: "metadata-update",
    severity: "warning",
    targetPath: page.path,
    title: "Archive stale unsupported page",
    detail: "Set lifecycle to archived and keep review_status stale for traceability.",
    reasons,
    proposedOperation: {
      kind: "metadata-patch",
      targetPath: page.path,
      fields: {
        lifecycle: "archived",
        review_status: "stale",
      },
      reason: `Memory Ops lifecycle patrol: ${reasons.join("; ")}`,
    },
  }
}

function promotionSuggestionForPage(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
): MemoryOpsSuggestion | null {
  const lifecycle = scalar(frontmatter?.lifecycle)
  const sourceCount = arrayValue(frontmatter?.sources).length
  const reinforcementCount = parseInteger(scalar(frontmatter?.reinforcement_count))

  if (lifecycle !== "episodic") return null
  if (sourceCount < 2 || reinforcementCount < 3) return null

  const reason = `${sourceCount} sources and ${reinforcementCount} reinforcement signals support semantic promotion`
  return {
    id: suggestionId("promote", page.path, "semantic"),
    kind: "metadata-update",
    severity: "info",
    targetPath: page.path,
    title: "Promote to semantic memory",
    detail: "Set lifecycle to semantic.",
    reasons: [reason],
    proposedOperation: {
      kind: "metadata-patch",
      targetPath: page.path,
      fields: { lifecycle: "semantic" },
      reason: `Memory Ops lifecycle patrol: ${reason}`,
    },
  }
}

function countReinforcingAuditEvents(
  snapshot: MemoryOpsProjectSnapshot,
  page: MemoryOpsWikiPage,
): number {
  const pageKeys = new Set([
    normalizePath(page.path),
    toProjectRelativePath(snapshot.projectPath, page.path),
  ])

  let count = 0
  for (const event of snapshot.audit.events) {
    if (!REINFORCING_ACTION_PREFIXES.some((prefix) => event.action.startsWith(prefix))) {
      continue
    }
    const eventPaths = auditEventPaths(event).map((value) =>
      toProjectRelativePath(snapshot.projectPath, value),
    )
    if (eventPaths.some((path) => pageKeys.has(path))) count++
  }
  return count
}

function auditEventPaths(
  event: MemoryOpsProjectSnapshot["audit"]["events"][number],
): string[] {
  const directPaths = [event.pagePath, event.targetPath, event.sourcePath].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  const retrievalPaths =
    event.retrieval?.results
      ?.map((result) => result.path)
      .filter((value): value is string => typeof value === "string" && value.length > 0) ?? []
  return [...directPaths, ...retrievalPaths]
}

function hasSourceSupport(evidence: MemoryOpsPageEvidenceSummary): boolean {
  return evidence.sourceSupport.sourceCount + evidence.sourceSupport.supportingRelationCount > 0
}

function hasBlockingRisk(evidence: MemoryOpsPageEvidenceSummary | undefined): boolean {
  if (!evidence) return false
  return evidence.risk.flags.some((flag) => flag !== "stale")
}

function isUnsupportedByEvidence(
  frontmatter: Record<string, FrontmatterValue> | null,
  evidence: MemoryOpsPageEvidenceSummary | undefined,
): boolean {
  if (evidence) return !hasSourceSupport(evidence)
  return arrayValue(frontmatter?.sources).length === 0
}

function hasRecentUseOrReinforcement(
  frontmatter: Record<string, FrontmatterValue> | null,
  evidence: MemoryOpsPageEvidenceSummary | undefined,
): boolean {
  if (evidence) {
    return evidence.recentUse.eventCount > 0 || evidence.reinforcement.totalCount > 0
  }
  return parseInteger(scalar(frontmatter?.reinforcement_count)) > 0
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

function suggestionId(...parts: string[]): string {
  return parts.map((part) => normalizePath(part).replace(/[^a-z0-9_-]+/gi, "-")).join(":")
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

function formatScore(score: number): string {
  return score.toFixed(2)
}

function buildPageResolver(pages: readonly MemoryOpsWikiPage[]): {
  has: (sourceId: string, target: string) => boolean
  findCandidate: (sourceId: string, target: string) => string | undefined
} {
  const exact = new Map<string, string>()
  for (const page of pages) {
    const frontmatter = page.frontmatter ?? parseFrontmatter(page.content).frontmatter
    const keys = [
      page.id,
      page.fileName.replace(/\.md$/, ""),
      scalar(frontmatter?.title),
      ...arrayValue(frontmatter?.alias),
      ...arrayValue(frontmatter?.aliases),
    ].filter((value): value is string => !!value)
    for (const key of keys) {
      const normalized = normalizeRelationKey(key)
      if (!exact.has(normalized)) exact.set(normalized, page.id)
    }
  }

  const entries = [...exact.entries()]
  return {
    has: (sourceId, target) => {
      const resolved = exact.get(normalizeRelationKey(target))
      return !!resolved && resolved !== sourceId
    },
    findCandidate: (sourceId, target) => {
      const normalizedTarget = normalizeRelationKey(target)
      const candidates = entries
        .filter(([key, pageId]) => {
          if (pageId === sourceId) return false
          return key.includes(normalizedTarget) || normalizedTarget.includes(key)
        })
        .sort((a, b) => a[0].length - b[0].length)
      return candidates[0]?.[1]
    },
  }
}

function normalizeRelationKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "")
}

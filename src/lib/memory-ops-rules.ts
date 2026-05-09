import {
  lifecycleMetadataFromFrontmatter,
  type LifecycleMetadata,
  type ReviewStatus,
} from "@/lib/lifecycle"
import { calculateClaimCredibility } from "@/lib/claim-confidence"
import { summarizeClaimProvenance } from "@/lib/claim-provenance"
import type { MetadataPatchOperation } from "@/lib/memory-ops-executor"
import type {
  MemoryOpsPageEvidenceSummary,
  MemoryOpsProjectSnapshot,
  MemoryOpsWikiPage,
} from "@/lib/memory-ops"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"
import {
  WIKI_TYPED_RELATION_ARRAY_FIELDS,
  type WikiTypedRelationArrayField,
} from "@/lib/wiki-frontmatter-fields"
import {
  DEFAULT_MEMORY_OPS_POLICY,
  type MemoryOpsPolicy,
} from "@/lib/memory-ops-policy"

export type MemoryOpsSuggestionKind = "metadata-update" | "relation-cleanup" | "review-action"
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
export function evaluateLifecycleSuggestions(
  snapshot: MemoryOpsProjectSnapshot,
  options: { today?: string; policy?: MemoryOpsPolicy } = {},
): MemoryOpsSuggestion[] {
  const suggestions: MemoryOpsSuggestion[] = []
  const policy = options.policy ?? DEFAULT_MEMORY_OPS_POLICY

  for (const page of snapshot.pages) {
    const frontmatter = page.frontmatter ?? parseFrontmatter(page.content).frontmatter
    const metadata = lifecycleMetadataFromFrontmatter(frontmatter, options.today)

    const staleSuggestion = staleMetadataSuggestion(page, frontmatter, metadata.reviewStatus, metadata.confidenceReasons)
    if (staleSuggestion) suggestions.push(staleSuggestion)

    const lowConfidenceSuggestion = lowConfidenceSuggestionForPage(page, frontmatter, metadata, policy)
    if (lowConfidenceSuggestion) suggestions.push(lowConfidenceSuggestion)

    const refreshSuggestion = lastConfirmedRefreshSuggestion(page, frontmatter)
    if (refreshSuggestion) suggestions.push(refreshSuggestion)

    const reinforcementSuggestion = reinforcementCountSuggestion(snapshot, page, frontmatter)
    if (reinforcementSuggestion) suggestions.push(reinforcementSuggestion)

    const promotionSuggestion = promotionSuggestionForPage(page, frontmatter, policy)
    if (promotionSuggestion) suggestions.push(promotionSuggestion)

    const archiveSuggestion = archiveSuggestionForPage(page, frontmatter, metadata, policy)
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
        const resolvedTargetId = resolver.resolve(page.id, target)
        if (resolvedTargetId) {
          const targetPage = resolver.pageById(resolvedTargetId)
          const suggestion = targetPage
            ? resolvedRelationSuggestion(page, frontmatter, field, targetPage, resolver)
            : null
          if (suggestion) suggestions.push(suggestion)
          continue
        }
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

export function evaluateClaimSuggestions(
  snapshot: MemoryOpsProjectSnapshot,
  options: { today?: string } = {},
): MemoryOpsSuggestion[] {
  const suggestions: MemoryOpsSuggestion[] = []
  for (const claim of snapshot.claims) {
    const metadata = calculateClaimCredibility(claim, { today: options.today })
    const status = metadata.status
    if (status === "stale" || status === "contradicted" || status === "superseded") {
      const severity = status === "stale" ? "info" : "warning"
      suggestions.push({
        id: suggestionId("claim", claim.claim_id, status),
        kind: "review-action",
        severity,
        targetPath: claim.page_path,
        title: `Review ${status} claim`,
        detail: `${claim.scope === "private" ? "[private claim text redacted]" : claim.text}`,
        reasons: [
          `claim ${claim.claim_id} resolved to ${status}`,
          ...metadata.reasons,
          "claim-level review does not demote the whole page",
        ],
      })
    }

    const provenance = summarizeClaimProvenance(claim)
    if (provenance.missingSourceRefs) {
      suggestions.push({
        id: suggestionId("claim", claim.claim_id, "missing-source-refs"),
        kind: "review-action",
        severity: "warning",
        targetPath: claim.page_path,
        title: "Review claim with no source refs",
        detail: `${claim.scope === "private" ? "[private claim text redacted]" : claim.text}`,
        reasons: [
          `claim ${claim.claim_id} has no source_refs`,
          "claim provenance cannot be traced back to a local source path",
          "review-only suggestion; Memory Ops will not infer a source automatically",
        ],
      })
    } else if (provenance.missingSnippetHash) {
      suggestions.push({
        id: suggestionId("claim", claim.claim_id, "missing-snippet-hash"),
        kind: "review-action",
        severity: "info",
        targetPath: claim.page_path,
        title: "Review claim without snippet evidence",
        detail: `${claim.scope === "private" ? "[private claim text redacted]" : claim.text}`,
        reasons: [
          `claim ${claim.claim_id} has ${provenance.sourceRefCount} source ref${provenance.sourceRefCount === 1 ? "" : "s"} but no snippet_hash`,
          "path-only provenance is weaker than hashed local evidence",
          "review-only suggestion; Memory Ops will not rewrite claim records automatically",
        ],
      })
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
  policy: MemoryOpsPolicy,
): MemoryOpsSuggestion | null {
  if (metadata.reviewStatus !== "needs-review") return null
  if (scalar(frontmatter?.review_status) === "needs-review") return null
  if (metadata.confidence >= policy.lowConfidenceThreshold) return null

  const confidence = formatScore(metadata.confidence)
  const reason = `confidence ${confidence} is below ${formatScore(policy.lowConfidenceThreshold)}`
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
  policy: MemoryOpsPolicy,
): MemoryOpsSuggestion | null {
  if (scalar(frontmatter?.lifecycle) === "archived") return null

  const evidence = page.evidence
  const stale = evidence?.staleness.stale ?? metadata.reviewStatus === "stale"
  if (!stale) return null
  if (policy.archive.requireNoSourceSupport && !isUnsupportedByEvidence(frontmatter, evidence)) return null
  if (policy.archive.requireNoReinforcement && hasReinforcement(frontmatter, evidence)) return null
  if (policy.archive.requireNoRecentUse && hasRecentUse(evidence)) return null
  if (hasBlockingRisk(evidence)) return null

  const reasons = archiveReasons(policy)
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

function resolvedRelationSuggestion(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
  field: WikiTypedRelationArrayField,
  targetPage: MemoryOpsWikiPage,
  resolver: PageResolver,
): MemoryOpsSuggestion | null {
  if (field === "contradicts") {
    return contradictionReviewSuggestion(page, frontmatter, targetPage)
  }

  if (field === "supersedes") {
    return reciprocalSupersessionSuggestion({
      sourcePage: page,
      sourceFrontmatter: frontmatter,
      patchPage: targetPage,
      patchField: "superseded_by",
      patchValue: page.id,
      resolver,
    })
  }

  if (field === "superseded_by") {
    return reciprocalSupersessionSuggestion({
      sourcePage: page,
      sourceFrontmatter: frontmatter,
      patchPage: targetPage,
      patchField: "supersedes",
      patchValue: page.id,
      resolver,
    })
  }

  return null
}

function reciprocalSupersessionSuggestion(input: {
  sourcePage: MemoryOpsWikiPage
  sourceFrontmatter: Record<string, FrontmatterValue> | null
  patchPage: MemoryOpsWikiPage
  patchField: "supersedes" | "superseded_by"
  patchValue: string
  resolver: PageResolver
}): MemoryOpsSuggestion | null {
  const patchFrontmatter =
    input.patchPage.frontmatter ?? parseFrontmatter(input.patchPage.content).frontmatter
  if (
    relationFieldReferencesPage(
      input.patchPage,
      patchFrontmatter,
      input.patchField,
      input.patchValue,
      input.resolver,
    )
  ) {
    return null
  }

  const nextValues = uniqueStrings([
    ...arrayValue(patchFrontmatter?.[input.patchField]),
    input.patchValue,
  ])
  const detail = [
    "Supersession is one-sided.",
    describePageEvidence("source page", input.sourcePage, input.sourceFrontmatter),
    describePageEvidence("target page", input.patchPage, patchFrontmatter),
  ].join(" ")

  return {
    id: suggestionId("relation", "reciprocal", input.patchPage.path, input.patchField, input.patchValue),
    kind: "metadata-update",
    severity: "info",
    targetPath: input.patchPage.path,
    title: "Add reciprocal supersession link",
    detail,
    reasons: [
      "supersession should be explicit on both pages",
      describePageEvidence("source page", input.sourcePage, input.sourceFrontmatter),
    ],
    proposedOperation: {
      kind: "metadata-patch",
      targetPath: input.patchPage.path,
      fields: { [input.patchField]: nextValues },
      reason: "Memory Ops relation patrol: add reciprocal supersession link",
    },
    relation: {
      field: input.patchField,
      target: input.patchValue,
    },
  }
}

function contradictionReviewSuggestion(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
  targetPage: MemoryOpsWikiPage,
): MemoryOpsSuggestion {
  const targetFrontmatter =
    targetPage.frontmatter ?? parseFrontmatter(targetPage.content).frontmatter
  const detail = [
    "Contradiction requires human review before any metadata patch.",
    describePageEvidence("source page", page, frontmatter),
    describePageEvidence("target page", targetPage, targetFrontmatter),
  ].join(" ")

  return {
    id: suggestionId("relation", "contradiction", page.path, targetPage.id),
    kind: "review-action",
    severity: "warning",
    targetPath: page.path,
    title: "Review contradiction pair",
    detail,
    reasons: [
      "contradiction relationships require human review",
      describePageEvidence("source page", page, frontmatter),
      describePageEvidence("target page", targetPage, targetFrontmatter),
    ],
    relation: {
      field: "contradicts",
      target: targetPage.id,
    },
  }
}

function promotionSuggestionForPage(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
  policy: MemoryOpsPolicy,
): MemoryOpsSuggestion | null {
  const lifecycle = scalar(frontmatter?.lifecycle)
  const sourceCount = arrayValue(frontmatter?.sources).length
  const reinforcementCount = parseInteger(scalar(frontmatter?.reinforcement_count))

  if (lifecycle !== "episodic") return null
  if (
    sourceCount < policy.promotion.minSources ||
    reinforcementCount < policy.promotion.minReinforcement
  ) {
    return null
  }

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

function hasReinforcement(
  frontmatter: Record<string, FrontmatterValue> | null,
  evidence: MemoryOpsPageEvidenceSummary | undefined,
): boolean {
  if (evidence) return evidence.reinforcement.totalCount > 0
  return parseInteger(scalar(frontmatter?.reinforcement_count)) > 0
}

function hasRecentUse(evidence: MemoryOpsPageEvidenceSummary | undefined): boolean {
  return (evidence?.recentUse.eventCount ?? 0) > 0
}

function archiveReasons(policy: MemoryOpsPolicy): string[] {
  const reasons = ["stale page is eligible for archive policy"]
  if (policy.archive.requireNoSourceSupport) reasons.push("stale page has no source support")
  if (policy.archive.requireNoReinforcement) reasons.push("no reinforcement signals")
  if (policy.archive.requireNoRecentUse) reasons.push("no recent use signals")
  return reasons
}

function relationFieldReferencesPage(
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
  field: "supersedes" | "superseded_by",
  expectedPageId: string,
  resolver: PageResolver,
): boolean {
  return arrayValue(frontmatter?.[field]).some(
    (target) => resolver.resolve(page.id, target) === expectedPageId,
  )
}

function describePageEvidence(
  label: string,
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
): string {
  const sourceCount = arrayValue(frontmatter?.sources).length
  const confidence = scalar(frontmatter?.confidence) ?? "unknown"
  const lastConfirmed =
    scalar(frontmatter?.last_confirmed) ??
    scalar(frontmatter?.updated) ??
    scalar(frontmatter?.created) ??
    "unknown"
  return `${label} ${page.id}: ${sourceCount} source${sourceCount === 1 ? "" : "s"}, confidence ${confidence}, last_confirmed ${lastConfirmed}.`
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

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatScore(score: number): string {
  return score.toFixed(2)
}

interface PageResolver {
  resolve: (sourceId: string, target: string) => string | undefined
  pageById: (pageId: string) => MemoryOpsWikiPage | undefined
  findCandidate: (sourceId: string, target: string) => string | undefined
}

function buildPageResolver(pages: readonly MemoryOpsWikiPage[]): PageResolver {
  const exact = new Map<string, string>()
  const byId = new Map<string, MemoryOpsWikiPage>()
  for (const page of pages) {
    byId.set(page.id, page)
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
    resolve: (sourceId, target) => {
      const resolved = exact.get(normalizeRelationKey(target))
      return resolved && resolved !== sourceId ? resolved : undefined
    },
    pageById: (pageId) => byId.get(pageId),
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

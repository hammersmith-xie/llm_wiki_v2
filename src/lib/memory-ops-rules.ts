import {
  lifecycleMetadataFromFrontmatter,
  type ReviewStatus,
} from "@/lib/lifecycle"
import type { MetadataPatchOperation } from "@/lib/memory-ops-executor"
import type { MemoryOpsProjectSnapshot, MemoryOpsWikiPage } from "@/lib/memory-ops"
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
  "memory_ops.apply",
]

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

    const reinforcementSuggestion = reinforcementCountSuggestion(snapshot, page, frontmatter)
    if (reinforcementSuggestion) suggestions.push(reinforcementSuggestion)

    const promotionSuggestion = promotionSuggestionForPage(page, frontmatter)
    if (promotionSuggestion) suggestions.push(promotionSuggestion)
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

function reinforcementCountSuggestion(
  snapshot: MemoryOpsProjectSnapshot,
  page: MemoryOpsWikiPage,
  frontmatter: Record<string, FrontmatterValue> | null,
): MemoryOpsSuggestion | null {
  const current = parseInteger(scalar(frontmatter?.reinforcement_count))
  const count = countReinforcingAuditEvents(snapshot, page)
  if (count <= current) return null

  const reason = `${count} reinforcing audit events reference this page`
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
    const eventPaths = [event.pagePath, event.targetPath, event.sourcePath]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => normalizePath(value))
    if (eventPaths.some((path) => pageKeys.has(path))) count++
  }
  return count
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

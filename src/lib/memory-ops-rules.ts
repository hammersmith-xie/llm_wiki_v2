import {
  lifecycleMetadataFromFrontmatter,
  type ReviewStatus,
} from "@/lib/lifecycle"
import type { MetadataPatchOperation } from "@/lib/memory-ops-executor"
import type { MemoryOpsProjectSnapshot, MemoryOpsWikiPage } from "@/lib/memory-ops"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"

export type MemoryOpsSuggestionKind = "metadata-update"
export type MemoryOpsSuggestionSeverity = "info" | "warning"

export interface MemoryOpsSuggestion {
  id: string
  kind: MemoryOpsSuggestionKind
  severity: MemoryOpsSuggestionSeverity
  targetPath: string
  title: string
  detail: string
  reasons: string[]
  proposedOperation: MetadataPatchOperation
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

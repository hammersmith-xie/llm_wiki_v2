import { appendAuditEvent } from "@/lib/audit-timeline"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { WIKI_TYPED_RELATION_ARRAY_FIELDS } from "@/lib/wiki-frontmatter-fields"

export type LifecycleTier = "working" | "episodic" | "semantic" | "procedural" | "archived"
export type ReviewStatus = "ok" | "needs-review" | "stale" | "contradicted"
export type KnowledgeScope = "private" | "shared"

export interface LifecycleMetadata {
  lifecycle: LifecycleTier
  confidence: number
  confidenceReasons: string[]
  lastConfirmed: string
  reinforcementCount: number
  supersedes: string[]
  supersededBy: string[]
  qualityScore: number
  reviewStatus: ReviewStatus
  scope: KnowledgeScope
}

export interface LifecycleScoreInput {
  type?: string
  lifecycle?: string
  sources?: readonly string[]
  lastConfirmed?: string
  updated?: string
  created?: string
  reinforcementCount?: number
  supersedes?: readonly string[]
  supersededBy?: readonly string[]
  contradicts?: readonly string[]
  reviewStatus?: string
  scope?: string
  today?: string
}

export interface LifecycleLintIssue {
  kind: "stale" | "superseded" | "contradicted" | "low-confidence"
  severity: "warning" | "info"
  detail: string
}

export interface LifecycleAuditEvent {
  timestamp?: string
  action: string
  pagePath: string
  sourcePath?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reasons?: string[]
}

const LIFECYCLE_VALUES = new Set<LifecycleTier>([
  "working",
  "episodic",
  "semantic",
  "procedural",
  "archived",
])

const REVIEW_STATUS_VALUES = new Set<ReviewStatus>([
  "ok",
  "needs-review",
  "stale",
  "contradicted",
])

const SCOPE_VALUES = new Set<KnowledgeScope>(["private", "shared"])

const ARRAY_FIELDS = new Set([
  "confidence_reasons",
  ...WIKI_TYPED_RELATION_ARRAY_FIELDS,
])

export function lifecycleFromType(type?: string): LifecycleTier {
  const normalized = (type ?? "").toLowerCase()
  if (normalized === "query") return "episodic"
  if (normalized === "source") return "episodic"
  if (normalized === "synthesis" || normalized === "comparison") return "semantic"
  if (normalized === "overview") return "semantic"
  return "semantic"
}

export function calculateLifecycleMetadata(input: LifecycleScoreInput): LifecycleMetadata {
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const lifecycle = normalizeLifecycle(input.lifecycle) ?? lifecycleFromType(input.type)
  const sources = uniqueStrings(input.sources ?? [])
  const supersedes = uniqueStrings(input.supersedes ?? [])
  const supersededBy = uniqueStrings(input.supersededBy ?? [])
  const contradicts = uniqueStrings(input.contradicts ?? [])
  const reinforcementCount = Math.max(0, Math.floor(input.reinforcementCount ?? 0))
  const lastConfirmed = input.lastConfirmed || input.updated || input.created || today
  const ageDays = daysBetween(lastConfirmed, today)
  let reviewStatus = normalizeReviewStatus(input.reviewStatus)

  const reasons: string[] = []
  let score = 0.45

  if (lifecycle === "working") {
    score -= 0.08
    reasons.push("working memory starts provisional")
  } else if (lifecycle === "episodic") {
    score -= 0.02
    reasons.push("episodic memory is source/session-bound")
  } else if (lifecycle === "semantic") {
    score += 0.06
    reasons.push("semantic memory is consolidated")
  } else if (lifecycle === "procedural") {
    score += 0.1
    reasons.push("procedural memory decays slowly")
  } else if (lifecycle === "archived") {
    score -= 0.12
    reasons.push("archived memory is deprioritized")
  }

  if (sources.length > 0) {
    const sourceBoost = Math.min(0.25, sources.length * 0.07)
    score += sourceBoost
    reasons.push(`${sources.length} supporting source${sources.length === 1 ? "" : "s"}`)
  } else {
    score -= 0.08
    reasons.push("no explicit source")
  }

  if (reinforcementCount > 0) {
    const reinforcementBoost = Math.min(0.18, Math.log1p(reinforcementCount) * 0.055)
    score += reinforcementBoost
    reasons.push(`${reinforcementCount} reinforcement${reinforcementCount === 1 ? "" : "s"}`)
  }

  const halfLife = lifecycle === "procedural" ? 365 : lifecycle === "semantic" ? 180 : 45
  const agePenalty = Math.min(0.22, Math.max(0, ageDays) / halfLife * 0.08)
  if (agePenalty > 0.005) {
    score -= agePenalty
    reasons.push(`last confirmed ${Math.max(0, ageDays)} day${ageDays === 1 ? "" : "s"} ago`)
  }

  if (supersedes.length > 0) {
    score += Math.min(0.05, supersedes.length * 0.02)
    reasons.push(`supersedes ${supersedes.length} older item${supersedes.length === 1 ? "" : "s"}`)
  }

  if (supersededBy.length > 0) {
    score -= 0.35
    reasons.push(`superseded by ${supersededBy.length} newer item${supersededBy.length === 1 ? "" : "s"}`)
  }

  if (contradicts.length > 0 || reviewStatus === "contradicted") {
    score -= 0.25
    reasons.push("contradiction signal present")
  }

  const confidence = clamp01(score)
  if (!reviewStatus) {
    if (contradicts.length > 0) reviewStatus = "contradicted"
    else if (supersededBy.length > 0 || ageDays > halfLife * 2) reviewStatus = "stale"
    else if (confidence < 0.45) reviewStatus = "needs-review"
    else reviewStatus = "ok"
  }

  const qualityScore = clamp01(
    confidence
      - (reviewStatus === "contradicted" ? 0.18 : 0)
      - (reviewStatus === "stale" ? 0.1 : 0)
      - (reviewStatus === "needs-review" ? 0.06 : 0),
  )

  return {
    lifecycle,
    confidence,
    confidenceReasons: uniqueStrings(reasons).slice(0, 6),
    lastConfirmed,
    reinforcementCount,
    supersedes,
    supersededBy,
    qualityScore,
    reviewStatus,
    scope: normalizeScope(input.scope) ?? "shared",
  }
}

export function lifecycleMetadataFromFrontmatter(
  frontmatter: Record<string, FrontmatterValue> | null,
  today?: string,
): LifecycleMetadata {
  return calculateLifecycleMetadata({
    type: scalar(frontmatter?.type),
    lifecycle: scalar(frontmatter?.lifecycle),
    sources: arrayValue(frontmatter?.sources),
    lastConfirmed: scalar(frontmatter?.last_confirmed),
    updated: scalar(frontmatter?.updated),
    created: scalar(frontmatter?.created),
    reinforcementCount: parseInteger(scalar(frontmatter?.reinforcement_count)),
    supersedes: arrayValue(frontmatter?.supersedes),
    supersededBy: arrayValue(frontmatter?.superseded_by),
    contradicts: arrayValue(frontmatter?.contradicts),
    reviewStatus: scalar(frontmatter?.review_status),
    scope: scalar(frontmatter?.scope),
    today,
  })
}

export function enrichLifecycleFrontmatter(
  content: string,
  options: { today?: string } = {},
): { content: string; metadata: LifecycleMetadata; changed: boolean } {
  const parsed = parseFrontmatter(content)
  const metadata = lifecycleMetadataFromFrontmatter(parsed.frontmatter, options.today)
  const fields: Record<string, string | string[]> = {
    lifecycle: metadata.lifecycle,
    confidence: quotedScalar(formatScore(metadata.confidence)),
    confidence_reasons: metadata.confidenceReasons,
    last_confirmed: metadata.lastConfirmed,
    reinforcement_count: quotedScalar(String(metadata.reinforcementCount)),
    supersedes: metadata.supersedes,
    superseded_by: metadata.supersededBy,
    quality_score: quotedScalar(formatScore(metadata.qualityScore)),
    review_status: metadata.reviewStatus,
    scope: metadata.scope,
  }

  const next = setFrontmatterFields(content, fields)
  return { content: next, metadata, changed: next !== content }
}

export function lifecycleLintIssues(
  content: string,
  options: { today?: string } = {},
): LifecycleLintIssue[] {
  const parsed = parseFrontmatter(content)
  const metadata = lifecycleMetadataFromFrontmatter(parsed.frontmatter, options.today)
  const issues: LifecycleLintIssue[] = []

  if (metadata.supersededBy.length > 0) {
    issues.push({
      kind: "superseded",
      severity: "warning",
      detail: `Page is superseded by ${metadata.supersededBy.map((s) => `[[${s}]]`).join(", ")}.`,
    })
  }

  if (metadata.reviewStatus === "contradicted") {
    issues.push({
      kind: "contradicted",
      severity: "warning",
      detail: "Page has contradiction metadata and needs human review.",
    })
  }

  if (metadata.reviewStatus === "stale") {
    issues.push({
      kind: "stale",
      severity: "info",
      detail: `Page is marked stale; last confirmed ${metadata.lastConfirmed}.`,
    })
  }

  if (metadata.confidence < 0.4) {
    issues.push({
      kind: "low-confidence",
      severity: "info",
      detail: `Low confidence (${formatScore(metadata.confidence)}): ${metadata.confidenceReasons.join("; ")}.`,
    })
  }

  return issues
}

export async function appendLifecycleAuditEvent(
  projectPath: string,
  event: LifecycleAuditEvent,
): Promise<void> {
  await appendAuditEvent(projectPath, { ...event })
}

function setFrontmatterFields(
  content: string,
  fields: Record<string, string | string[]>,
): string {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n|$)/)
  if (!match) return content

  const [, open, body, close, afterCloseNewline] = match
  const lines = body.split(/\r?\n/)
  const consumed = new Set<string>()
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const keyMatch = line.match(/^([A-Za-z_][\w-]*):/)
    if (!keyMatch) {
      out.push(line)
      continue
    }
    const key = keyMatch[1]
    if (!(key in fields)) {
      out.push(line)
      continue
    }

    out.push(formatFrontmatterLine(key, fields[key]))
    consumed.add(key)

    if (ARRAY_FIELDS.has(key)) {
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i++
      }
    }
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!consumed.has(key)) out.push(formatFrontmatterLine(key, value))
  }

  return `${open}${out.join("\n")}${close}${afterCloseNewline}${content.slice(match[0].length)}`
}

function formatFrontmatterLine(key: string, value: string | string[]): string {
  if (Array.isArray(value)) {
    return `${key}: [${value.map(quoteYamlString).join(", ")}]`
  }
  return `${key}: ${quoteYamlScalar(value)}`
}

function quoteYamlScalar(value: string): string {
  if (isQuotedScalar(value)) return value
  if (/^[A-Za-z0-9_.\/-]+$/.test(value)) return value
  return quoteYamlString(value)
}

function quotedScalar(value: string): string {
  return quoteYamlString(value)
}

function isQuotedScalar(value: string): boolean {
  return /^"(?:[^"\\]|\\.)*"$/.test(value)
}

function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function scalar(value: FrontmatterValue | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function arrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return uniqueStrings(value)
  if (!value) return []
  return uniqueStrings([value])
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeLifecycle(value: string | undefined): LifecycleTier | undefined {
  const normalized = value?.toLowerCase()
  return normalized && LIFECYCLE_VALUES.has(normalized as LifecycleTier)
    ? normalized as LifecycleTier
    : undefined
}

function normalizeReviewStatus(value: string | undefined): ReviewStatus | undefined {
  const normalized = value?.toLowerCase()
  return normalized && REVIEW_STATUS_VALUES.has(normalized as ReviewStatus)
    ? normalized as ReviewStatus
    : undefined
}

function normalizeScope(value: string | undefined): KnowledgeScope | undefined {
  const normalized = value?.toLowerCase()
  return normalized && SCOPE_VALUES.has(normalized as KnowledgeScope)
    ? normalized as KnowledgeScope
    : undefined
}

function daysBetween(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`)
  const endMs = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return Math.floor((endMs - startMs) / 86_400_000)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function formatScore(value: number): string {
  return clamp01(value).toFixed(2)
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = String(value).trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

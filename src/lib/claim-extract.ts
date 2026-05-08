import { applyClaimCredibility } from "./claim-confidence"
import {
  normalizeClaimRecord,
  type ClaimLifecycle,
  type ClaimRecord,
  type ClaimScope,
  type ClaimSourceRef,
} from "./claims"

const DEFAULT_MAX_CLAIMS = 8
const CLAIM_SIGNAL =
  /\b(decision|recommendation|recommend|should|must|finding|conclusion|lesson|takeaway|insight|learned|implies)\b|决定|建议|应当|应该|必须|发现|结论|经验|启示|说明/i

export type ClaimCandidateOrigin =
  | "digest-decision"
  | "digest-lesson"
  | "markdown-signal"

export interface ClaimExtractionDigestDecision {
  id?: string
  statement?: string
  evidencePaths?: readonly string[]
}

export interface ClaimExtractionDigestLesson {
  id?: string
  text?: string
  evidencePaths?: readonly string[]
}

export interface ClaimExtractionDigestInput {
  decisions?: readonly ClaimExtractionDigestDecision[]
  lessons?: readonly ClaimExtractionDigestLesson[]
}

export interface ClaimExtractionInput {
  pagePath: string
  pageTitle?: string
  pageAnchor?: string
  content?: string
  digest?: ClaimExtractionDigestInput
  sourceRefs?: readonly ClaimSourceRef[]
  supports?: readonly string[]
  maxClaims?: number
  today?: string
  lifecycle?: ClaimLifecycle
  scope?: ClaimScope
}

export interface ClaimExtractionCandidate {
  origin: ClaimCandidateOrigin
  anchorText: string
  claim: ClaimRecord
}

export interface ClaimExtractionResult {
  claims: ClaimExtractionCandidate[]
  warnings: string[]
  skippedCount: number
}

interface DraftCandidate {
  origin: ClaimCandidateOrigin
  text: string
  anchorText: string
  pageAnchor?: string
  lifecycle: ClaimLifecycle
  sourceRefs: ClaimSourceRef[]
}

export function extractClaimCandidates(input: ClaimExtractionInput): ClaimExtractionResult {
  const warnings: string[] = []
  const markdownCandidates = input.digest ? [] : markdownSignalCandidates(input)
  const candidates = uniqueCandidateTexts([
    ...digestDecisionCandidates(input, warnings),
    ...digestLessonCandidates(input, warnings),
    ...markdownCandidates,
  ])
  const maxClaims = Math.max(0, Math.floor(input.maxClaims ?? DEFAULT_MAX_CLAIMS))
  const selected = candidates.slice(0, maxClaims)
  const skippedCount = Math.max(0, candidates.length - selected.length)

  if (skippedCount > 0) {
    warnings.push(`Skipped ${skippedCount} claim candidate${skippedCount === 1 ? "" : "s"} because maxClaims=${maxClaims}.`)
  }

  const claims = selected.flatMap((candidate) => {
    const normalized = normalizeClaimRecord({
      text: candidate.text,
      page_path: input.pagePath,
      page_title: input.pageTitle,
      page_anchor: candidate.pageAnchor ?? input.pageAnchor,
      source_refs: candidate.sourceRefs,
      lifecycle: input.lifecycle ?? candidate.lifecycle,
      scope: input.scope ?? "shared",
      supports: input.supports ?? [],
      created_at: input.today,
      updated_at: input.today,
      last_confirmed: input.today,
    }, { today: input.today })
    warnings.push(...normalized.warnings.filter((warning) =>
      warning !== "claim_id missing or invalid; generated a stable claim id."
    ))
    return [{
      origin: candidate.origin,
      anchorText: candidate.anchorText,
      claim: applyClaimCredibility(normalized.claim, { today: input.today }),
    }]
  })

  if (claims.length === 0) warnings.push("No high-value claim candidates found.")
  return { claims, warnings: uniqueStrings(warnings), skippedCount }
}

function digestDecisionCandidates(
  input: ClaimExtractionInput,
  warnings: string[],
): DraftCandidate[] {
  return (input.digest?.decisions ?? []).flatMap((decision, index) => {
    const text = normalizeClaimText(decision.statement ?? "")
    const id = decision.id ?? `decision-${index + 1}`
    if (!text) {
      warnings.push(`Skipped empty digest decision ${id}.`)
      return []
    }
    return [{
      origin: "digest-decision" as const,
      text,
      anchorText: text,
      pageAnchor: id,
      lifecycle: "semantic" as const,
      sourceRefs: mergeSourceRefs(input.sourceRefs, evidenceRefs(decision.evidencePaths)),
    }]
  })
}

function digestLessonCandidates(
  input: ClaimExtractionInput,
  warnings: string[],
): DraftCandidate[] {
  return (input.digest?.lessons ?? []).flatMap((lesson, index) => {
    const text = normalizeClaimText(lesson.text ?? "")
    const id = lesson.id ?? `lesson-${index + 1}`
    if (!text) {
      warnings.push(`Skipped empty digest lesson ${id}.`)
      return []
    }
    return [{
      origin: "digest-lesson" as const,
      text,
      anchorText: text,
      pageAnchor: id,
      lifecycle: "episodic" as const,
      sourceRefs: mergeSourceRefs(input.sourceRefs, evidenceRefs(lesson.evidencePaths)),
    }]
  })
}

function markdownSignalCandidates(input: ClaimExtractionInput): DraftCandidate[] {
  if (!input.content) return []
  return input.content
    .split(/\r?\n/)
    .map(stripMarkdownListPrefix)
    .map(normalizeClaimText)
    .filter((line) => line.length >= 32 && CLAIM_SIGNAL.test(line))
    .map((text) => ({
      origin: "markdown-signal" as const,
      text,
      anchorText: text,
      pageAnchor: input.pageAnchor,
      lifecycle: "semantic" as const,
      sourceRefs: [...(input.sourceRefs ?? [])],
    }))
}

function uniqueCandidateTexts(candidates: readonly DraftCandidate[]): DraftCandidate[] {
  const out: DraftCandidate[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = candidate.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

function evidenceRefs(paths: readonly string[] | undefined): ClaimSourceRef[] {
  return (paths ?? [])
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({ path }))
}

function mergeSourceRefs(
  base: readonly ClaimSourceRef[] | undefined,
  extra: readonly ClaimSourceRef[],
): ClaimSourceRef[] {
  const out: ClaimSourceRef[] = []
  const seen = new Set<string>()
  for (const ref of [...(base ?? []), ...extra]) {
    const key = [
      ref.path.trim().toLowerCase(),
      ref.anchor?.trim().toLowerCase() ?? "",
      ref.snippet_hash?.trim() ?? "",
    ].join("\n")
    if (!ref.path.trim() || seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

function stripMarkdownListPrefix(value: string): string {
  return value.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
}

function normalizeClaimText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

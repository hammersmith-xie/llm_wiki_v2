import { redactSensitiveText } from "@/lib/audit-redaction"
import type { ClaimStatus } from "@/lib/claims"
import { normalizePath } from "@/lib/path-utils"

export const PREWRITE_CANDIDATE_KINDS = [
  "ingest-page",
  "crystallization-page",
  "review-created-page",
] as const

export const PREWRITE_CLASSIFICATIONS = [
  "new",
  "reinforcement",
  "update",
  "duplicate",
  "possible-contradiction",
  "supersession",
  "uncertain",
] as const

export const PREWRITE_DECISIONS = ["allow", "review-only"] as const

export const PREWRITE_EVIDENCE_KINDS = ["page", "claim", "relation", "error"] as const

export type PreWriteCandidateKind = (typeof PREWRITE_CANDIDATE_KINDS)[number]
export type PreWriteClassification = (typeof PREWRITE_CLASSIFICATIONS)[number]
export type PreWriteDecision = (typeof PREWRITE_DECISIONS)[number]
export type PreWriteEvidenceKind = (typeof PREWRITE_EVIDENCE_KINDS)[number]

export type PreWriteSeverity = "info" | "warning" | "blocking"

export interface PreWriteClaimSummary {
  claimId?: string
  text: string
  status?: ClaimStatus
  pagePath?: string
  relation?: "supports" | "contradicts" | "supersedes" | "superseded-by"
}

export interface PreWriteCandidateInput {
  kind: PreWriteCandidateKind
  targetPath: string
  content: string
  title?: string
  sourcePath?: string
  claimSummaries?: readonly PreWriteClaimSummary[]
  maxClaims?: number
  maxContentSummaryLength?: number
}

export interface PreWriteCandidate {
  id: string
  kind: PreWriteCandidateKind
  targetPath: string
  title?: string
  sourcePath?: string
  contentSummary: string
  claimSummaries: PreWriteClaimSummary[]
}

export interface PreWriteEvidence {
  kind: PreWriteEvidenceKind
  pagePath?: string
  pageTitle?: string
  claimId?: string
  claimText?: string
  status?: ClaimStatus
  relation?: "supports" | "contradicts" | "supersedes" | "superseded-by"
  score: number
  reasons: string[]
}

export interface PreWriteConflictPreview {
  candidate: PreWriteCandidate
  classification: PreWriteClassification
  decision: PreWriteDecision
  severity: PreWriteSeverity
  evidence: PreWriteEvidence[]
  reasons: string[]
}

const DEFAULT_SUMMARY_LENGTH = 480
const DEFAULT_MAX_CLAIMS = 8
const CLAIM_SUMMARY_LENGTH = 160

export function buildPreWriteCandidate(input: PreWriteCandidateInput): PreWriteCandidate {
  const title = normalizeInlineText(input.title ?? "")
  const targetPath = normalizePath(input.targetPath).trim()
  return {
    id: createPreWriteCandidateId(input.kind, targetPath, title),
    kind: input.kind,
    targetPath,
    ...(title ? { title } : {}),
    ...(input.sourcePath ? { sourcePath: normalizePath(input.sourcePath).trim() } : {}),
    contentSummary: summarizePreWriteContent(
      input.content,
      input.maxContentSummaryLength ?? DEFAULT_SUMMARY_LENGTH,
    ),
    claimSummaries: normalizeClaimSummaries(
      input.claimSummaries ?? [],
      input.maxClaims ?? DEFAULT_MAX_CLAIMS,
    ),
  }
}

export function summarizePreWriteContent(content: string, maxLength = DEFAULT_SUMMARY_LENGTH): string {
  const limit = Math.max(24, Math.floor(maxLength))
  const normalized = normalizeInlineText(redactSensitiveText(content))
  if (normalized.length <= limit) return normalized
  return normalized.slice(0, Math.max(0, limit - 1)).trimEnd() + "…"
}

export function classifyPreWriteConflict(
  candidate: PreWriteCandidate,
  evidence: readonly PreWriteEvidence[],
): PreWriteConflictPreview {
  const orderedEvidence = [...evidence].sort(compareEvidence)
  const contradiction = orderedEvidence.find(isContradictionEvidence)
  if (contradiction) {
    return buildPreview(candidate, "possible-contradiction", "review-only", "blocking", orderedEvidence, [
      "Potential contradiction evidence was found before writing.",
      ...contradiction.reasons,
    ])
  }

  const supersession = orderedEvidence.find(isSupersessionEvidence)
  if (supersession) {
    return buildPreview(candidate, "supersession", "review-only", "blocking", orderedEvidence, [
      "Supersession evidence was found before writing.",
      ...supersession.reasons,
    ])
  }

  const duplicate = orderedEvidence.find((item) => isDifferentTarget(candidate, item))
  if (duplicate) {
    return buildPreview(candidate, "duplicate", "review-only", "warning", orderedEvidence, [
      "A related page or claim exists at a different target path.",
      ...duplicate.reasons,
    ])
  }

  const reinforcement = orderedEvidence.find(
    (item) => item.kind === "claim" && item.status !== "stale" && item.score >= 0.72,
  )
  if (reinforcement) {
    return buildPreview(candidate, "reinforcement", "allow", "info", orderedEvidence, [
      "Existing active claim evidence reinforces the candidate write.",
      ...reinforcement.reasons,
    ])
  }

  const update = orderedEvidence.find((item) => isSameTarget(candidate, item))
  if (update) {
    return buildPreview(candidate, "update", "allow", "info", orderedEvidence, [
      "The candidate updates an existing target path without risky evidence.",
      ...update.reasons,
    ])
  }

  if (orderedEvidence.length > 0) {
    return buildPreview(candidate, "uncertain", "review-only", "warning", orderedEvidence, [
      "Related evidence was found but could not be classified as a safe write.",
    ])
  }

  return buildPreview(candidate, "new", "allow", "info", [], [
    "No related page or claim evidence was found.",
  ])
}

function normalizeClaimSummaries(
  claims: readonly PreWriteClaimSummary[],
  maxClaims: number,
): PreWriteClaimSummary[] {
  const limit = Math.max(0, Math.floor(maxClaims))
  return claims.slice(0, limit).map((claim) => {
    const text = summarizePreWriteContent(claim.text, CLAIM_SUMMARY_LENGTH)
    return {
      ...(claim.claimId ? { claimId: claim.claimId.trim() } : {}),
      text,
      ...(claim.status ? { status: claim.status } : {}),
      ...(claim.pagePath ? { pagePath: normalizePath(claim.pagePath).trim() } : {}),
      ...(claim.relation ? { relation: claim.relation } : {}),
    }
  }).filter((claim) => claim.text.length > 0)
}

function createPreWriteCandidateId(
  kind: PreWriteCandidateKind,
  targetPath: string,
  title: string,
): string {
  const identity = [
    kind,
    normalizePath(targetPath).trim().toLowerCase(),
    normalizeInlineText(title).toLowerCase(),
  ].join("\n")
  return `prewrite_${hashString(identity)}`
}

function buildPreview(
  candidate: PreWriteCandidate,
  classification: PreWriteClassification,
  decision: PreWriteDecision,
  severity: PreWriteSeverity,
  evidence: readonly PreWriteEvidence[],
  reasons: readonly string[],
): PreWriteConflictPreview {
  return {
    candidate,
    classification,
    decision,
    severity,
    evidence: evidence.slice(0, 10),
    reasons: uniqueStrings(reasons).slice(0, 8),
  }
}

function compareEvidence(a: PreWriteEvidence, b: PreWriteEvidence): number {
  const scoreDelta = b.score - a.score
  if (scoreDelta !== 0) return scoreDelta
  return evidenceKey(a).localeCompare(evidenceKey(b))
}

function evidenceKey(evidence: PreWriteEvidence): string {
  return [
    evidence.kind,
    evidence.pagePath ?? "",
    evidence.claimId ?? "",
    evidence.relation ?? "",
  ].join("\n")
}

function isContradictionEvidence(evidence: PreWriteEvidence): boolean {
  return evidence.status === "contradicted" || evidence.relation === "contradicts"
}

function isSupersessionEvidence(evidence: PreWriteEvidence): boolean {
  return (
    evidence.status === "superseded" ||
    evidence.relation === "supersedes" ||
    evidence.relation === "superseded-by"
  )
}

function isSameTarget(candidate: PreWriteCandidate, evidence: PreWriteEvidence): boolean {
  return normalizeComparablePath(candidate.targetPath) === normalizeComparablePath(evidence.pagePath ?? "")
}

function isDifferentTarget(candidate: PreWriteCandidate, evidence: PreWriteEvidence): boolean {
  if (!evidence.pagePath || isSameTarget(candidate, evidence)) return false
  if (evidence.kind === "page" && evidence.score >= 0.75) return true
  if (evidence.kind === "claim" && evidence.score >= 0.9) return true
  return false
}

function normalizeComparablePath(path: string): string {
  return normalizePath(path).trim().toLowerCase()
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeInlineText(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

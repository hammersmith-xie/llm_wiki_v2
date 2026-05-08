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

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

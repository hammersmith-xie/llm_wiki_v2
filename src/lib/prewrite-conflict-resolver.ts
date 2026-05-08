import { readClaimIndex, type ClaimIndexWarning, type ClaimRecord } from "@/lib/claims"
import {
  type PreWriteCandidate,
  type PreWriteEvidence,
} from "@/lib/prewrite-conflict"

export interface PreWriteEvidenceResolverOptions {
  maxClaims?: number
  maxEvidence?: number
}

export interface PreWriteEvidenceResolverResult {
  evidence: PreWriteEvidence[]
  warnings: ClaimIndexWarning[]
}

const DEFAULT_MAX_CLAIMS = 40
const DEFAULT_MAX_EVIDENCE = 10

export async function resolvePreWriteClaimEvidence(
  projectPath: string,
  candidate: PreWriteCandidate,
  options: PreWriteEvidenceResolverOptions = {},
): Promise<PreWriteEvidenceResolverResult> {
  const maxClaims = Math.max(0, Math.floor(options.maxClaims ?? DEFAULT_MAX_CLAIMS))
  const maxEvidence = Math.max(0, Math.floor(options.maxEvidence ?? DEFAULT_MAX_EVIDENCE))
  const index = await readClaimIndex(projectPath)
  const evidence = index.claims
    .slice(0, maxClaims)
    .map((claim) => claimToEvidence(candidate, claim))
    .filter((item): item is PreWriteEvidence => Boolean(item))
    .sort(compareEvidence)
    .slice(0, maxEvidence)
  return { evidence, warnings: index.warnings }
}

function claimToEvidence(
  candidate: PreWriteCandidate,
  claim: ClaimRecord,
): PreWriteEvidence | null {
  const textScore = maxClaimTextOverlap(candidate, claim)
  const pathScore = samePath(candidate.targetPath, claim.page_path) ? 1 : 0
  const relation = claimRelation(candidate, claim)
  const risky = claim.status === "contradicted" || claim.status === "superseded" || Boolean(relation)
  if (!risky && textScore < 0.45 && pathScore === 0) return null

  const reasons: string[] = []
  if (textScore >= 0.45) reasons.push("claim text overlaps candidate")
  if (pathScore > 0) reasons.push("claim belongs to target path")
  if (claim.status === "contradicted") reasons.push("claim status is contradicted")
  if (claim.status === "superseded") reasons.push("claim status is superseded")
  if (relation === "contradicts") reasons.push("contradiction relation present")
  if (relation === "supersedes" || relation === "superseded-by") {
    reasons.push("supersession relation present")
  }

  return {
    kind: relation ? "relation" : "claim",
    pagePath: claim.page_path,
    ...(claim.page_title ? { pageTitle: claim.page_title } : {}),
    claimId: claim.claim_id,
    claimText: claim.text,
    status: claim.status,
    ...(relation ? { relation } : {}),
    score: Math.max(textScore, pathScore * 0.7, risky ? 0.75 : 0),
    reasons,
  }
}

function maxClaimTextOverlap(candidate: PreWriteCandidate, claim: ClaimRecord): number {
  const candidateTexts = [
    candidate.title ?? "",
    candidate.contentSummary,
    ...candidate.claimSummaries.map((summary) => summary.text),
  ]
  return Math.max(...candidateTexts.map((text) => tokenOverlap(text, claim.text)), 0)
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0
  const rightSet = new Set(rightTokens)
  let matches = 0
  for (const token of leftTokens) {
    if (rightSet.has(token)) matches += 1
  }
  return matches / Math.max(1, Math.min(leftTokens.length, rightTokens.length))
}

function tokens(value: string): string[] {
  const normalized = value.toLowerCase()
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  const cjk = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []
  return uniqueStrings([...latin, ...cjk])
}

function claimRelation(
  candidate: PreWriteCandidate,
  claim: ClaimRecord,
): PreWriteEvidence["relation"] | undefined {
  if (claim.status === "superseded") return "superseded-by"
  const candidateIds = new Set(candidate.claimSummaries.flatMap((summary) =>
    summary.claimId ? [summary.claimId] : []
  ))
  if (intersects(candidateIds, claim.contradicts)) return "contradicts"
  if (intersects(candidateIds, claim.supersedes)) return "supersedes"
  if (intersects(candidateIds, claim.superseded_by)) return "superseded-by"

  for (const summary of candidate.claimSummaries) {
    if (summary.relation === "contradicts") return "contradicts"
    if (summary.relation === "supersedes") return "supersedes"
    if (summary.relation === "superseded-by") return "superseded-by"
  }
  return undefined
}

function intersects(left: ReadonlySet<string>, right: readonly string[]): boolean {
  for (const value of right) {
    if (left.has(value)) return true
  }
  return false
}

function samePath(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function compareEvidence(a: PreWriteEvidence, b: PreWriteEvidence): number {
  const scoreDelta = b.score - a.score
  if (scoreDelta !== 0) return scoreDelta
  return [a.pagePath ?? "", a.claimId ?? ""].join("\n").localeCompare(
    [b.pagePath ?? "", b.claimId ?? ""].join("\n"),
  )
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

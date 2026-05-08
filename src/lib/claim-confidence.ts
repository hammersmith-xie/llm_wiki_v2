import type { ClaimRecord, ClaimStatus } from "./claims"

export interface ClaimCredibilityOptions {
  today?: string
}

export interface ClaimCredibilityMetadata {
  confidence: number
  confidenceText: string
  qualityScore: number
  qualityScoreText: string
  status: ClaimStatus
  reasons: string[]
  lastConfirmed: string
  reinforcementCount: number
  ageDays: number
}

export function calculateClaimCredibility(
  claim: ClaimRecord,
  options: ClaimCredibilityOptions = {},
): ClaimCredibilityMetadata {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const sourceRefs = uniqueStrings(claim.source_refs.map((ref) => ref.path))
  const supports = uniqueStrings(claim.supports)
  const supersedes = uniqueStrings(claim.supersedes)
  const supersededBy = uniqueStrings(claim.superseded_by)
  const contradicts = uniqueStrings(claim.contradicts)
  const reinforcementCount = Math.max(0, Math.floor(numberValue(claim.reinforcement_count)))
  const lastConfirmed = validDate(claim.last_confirmed) ? claim.last_confirmed : claim.updated_at
  const ageDays = daysBetween(lastConfirmed, today)
  const halfLife = halfLifeDays(claim.lifecycle)
  const reasons: string[] = []

  let score = 0.45

  if (claim.lifecycle === "working") {
    score -= 0.08
    reasons.push("working claim is provisional")
  } else if (claim.lifecycle === "episodic") {
    score -= 0.02
    reasons.push("episodic claim is session-bound")
  } else if (claim.lifecycle === "semantic") {
    score += 0.06
    reasons.push("semantic claim is consolidated")
  } else if (claim.lifecycle === "procedural") {
    score += 0.1
    reasons.push("procedural claim decays slowly")
  } else if (claim.lifecycle === "archived") {
    score -= 0.12
    reasons.push("archived claim is deprioritized")
  }

  if (sourceRefs.length > 0) {
    score += Math.min(0.25, sourceRefs.length * 0.07)
    reasons.push(`${sourceRefs.length} source refs`)
  } else {
    score -= 0.08
    reasons.push("no source refs")
  }

  if (supports.length > 0) {
    score += Math.min(0.12, supports.length * 0.04)
    reasons.push(`${supports.length} supporting claims`)
  }

  if (reinforcementCount > 0) {
    score += Math.min(0.18, Math.log1p(reinforcementCount) * 0.055)
    reasons.push(`${reinforcementCount} reinforcements`)
  }

  const agePenalty = Math.min(0.22, Math.max(0, ageDays) / halfLife * 0.08)
  if (agePenalty > 0.005) {
    score -= agePenalty
    reasons.push(`last confirmed ${Math.max(0, ageDays)} day${ageDays === 1 ? "" : "s"} ago`)
  }

  if (supersedes.length > 0) {
    score += Math.min(0.05, supersedes.length * 0.02)
    reasons.push(`supersedes ${supersedes.length} older claim${supersedes.length === 1 ? "" : "s"}`)
  }

  if (supersededBy.length > 0 || claim.status === "superseded") {
    score -= 0.35
    reasons.push(`superseded by ${Math.max(1, supersededBy.length)} newer claim${supersededBy.length === 1 ? "" : "s"}`)
  }

  if (contradicts.length > 0 || claim.status === "contradicted") {
    score -= 0.25
    reasons.push("contradiction signal present")
  }

  if (claim.status === "stale") {
    score -= 0.08
    reasons.push("explicit stale status")
  }

  if (claim.scope === "private") {
    score -= 0.03
    reasons.push("private scope limits shared verification")
  }

  const confidence = clamp01(score)
  const status = deriveClaimStatus(claim.status, confidence, ageDays, halfLife, {
    contradicted: contradicts.length > 0,
    superseded: supersededBy.length > 0,
  })
  const qualityScore = clamp01(
    confidence
      - (status === "contradicted" ? 0.18 : 0)
      - (status === "superseded" ? 0.2 : 0)
      - (status === "stale" ? 0.1 : 0)
      - (status === "needs-review" ? 0.06 : 0),
  )

  return {
    confidence,
    confidenceText: formatScore(confidence),
    qualityScore,
    qualityScoreText: formatScore(qualityScore),
    status,
    reasons: uniqueStrings(reasons).slice(0, 8),
    lastConfirmed,
    reinforcementCount,
    ageDays,
  }
}

export function applyClaimCredibility(
  claim: ClaimRecord,
  options: ClaimCredibilityOptions = {},
): ClaimRecord {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const metadata = calculateClaimCredibility(claim, { today })
  return {
    ...claim,
    confidence: metadata.confidenceText,
    confidence_reasons: metadata.reasons,
    last_confirmed: metadata.lastConfirmed,
    reinforcement_count: String(metadata.reinforcementCount),
    status: metadata.status,
    updated_at: today,
  }
}

function deriveClaimStatus(
  currentStatus: ClaimStatus,
  confidence: number,
  ageDays: number,
  halfLife: number,
  signals: { contradicted: boolean; superseded: boolean },
): ClaimStatus {
  if (currentStatus === "superseded" || signals.superseded) return "superseded"
  if (currentStatus === "contradicted" || signals.contradicted) return "contradicted"
  if (currentStatus === "stale" || ageDays > halfLife * 2) return "stale"
  if (confidence < 0.45) return "needs-review"
  return "ok"
}

function halfLifeDays(lifecycle: ClaimRecord["lifecycle"]): number {
  if (lifecycle === "procedural") return 365
  if (lifecycle === "semantic") return 180
  if (lifecycle === "episodic") return 60
  if (lifecycle === "archived") return 30
  return 45
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

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function daysBetween(from: string, to: string): number {
  const fromDate = Date.parse(`${from}T00:00:00Z`)
  const toDate = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(fromDate) || !Number.isFinite(toDate)) return 0
  return Math.floor((toDate - fromDate) / 86_400_000)
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function formatScore(value: number): string {
  return value.toFixed(2)
}

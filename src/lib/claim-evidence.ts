import type { ClaimRecord } from "@/lib/claims"
import { normalizePath } from "@/lib/path-utils"
import type { ClaimEvidence } from "@/lib/search-types"

export interface ClaimEvidencePageResult {
  path: string
  rank?: number
}

export interface ClaimEvidenceLookupInput {
  query: string
  pageResults: readonly ClaimEvidencePageResult[]
  claims: readonly ClaimRecord[]
  existingPagePaths?: readonly string[]
  limit?: number
}

export interface ClaimEvidenceWarning {
  kind: "orphan"
  claimId: string
  pagePath: string
  message: string
}

export interface ClaimEvidenceLookupResult {
  evidence: ClaimEvidence[]
  warnings: ClaimEvidenceWarning[]
}

export function lookupClaimEvidence(
  input: ClaimEvidenceLookupInput,
): ClaimEvidenceLookupResult {
  if (input.claims.length === 0 || input.pageResults.length === 0) {
    return { evidence: [], warnings: [] }
  }

  const queryTerms = tokenizeEvidenceQuery(input.query)
  const pageRanks = new Map<string, number>()
  input.pageResults.forEach((result, index) => {
    pageRanks.set(comparablePagePath(result.path), result.rank ?? index + 1)
  })
  const existingPages = input.existingPagePaths
    ? new Set(input.existingPagePaths.map(comparablePagePath))
    : null

  const warnings: ClaimEvidenceWarning[] = []
  const evidence: ClaimEvidence[] = []

  for (const claim of input.claims) {
    const pagePath = comparablePagePath(claim.page_path)
    if (existingPages && !existingPages.has(pagePath)) {
      warnings.push({
        kind: "orphan",
        claimId: claim.claim_id,
        pagePath: claim.page_path,
        message: `Claim ${claim.claim_id} points to missing page ${claim.page_path}.`,
      })
      continue
    }

    const pageRank = pageRanks.get(pagePath)
    if (pageRank === undefined) continue

    const matchedTerms = matchedQueryTerms(queryTerms, claim.text)
    const score = evidenceScore(claim, pageRank, matchedTerms.length, queryTerms.length)
    evidence.push({
      claimId: claim.claim_id,
      text: claim.scope === "private" ? "[private claim text redacted]" : claim.text,
      pagePath: claim.page_path,
      ...(claim.page_title ? { pageTitle: claim.page_title } : {}),
      ...(claim.page_anchor ? { pageAnchor: claim.page_anchor } : {}),
      lifecycle: claim.lifecycle,
      status: claim.status,
      confidence: claim.confidence,
      score,
      matchedTerms,
      reasons: claim.confidence_reasons,
      sourceRefs: claim.scope === "private" ? [] : claim.source_refs,
      ...(claim.scope === "private" ? { redacted: true } : {}),
    })
  }

  evidence.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.claimId.localeCompare(b.claimId)
  })

  return {
    evidence: evidence.slice(0, input.limit ?? 10),
    warnings,
  }
}

function evidenceScore(
  claim: ClaimRecord,
  pageRank: number,
  matchedTermCount: number,
  queryTermCount: number,
): number {
  const pageScore = 1 / Math.max(1, pageRank)
  const queryScore = queryTermCount > 0 ? matchedTermCount / queryTermCount : 0
  const confidenceScore = Math.max(0, Math.min(1, Number(claim.confidence))) * 0.35
  return pageScore + queryScore + confidenceScore + statusWeight(claim.status)
}

function statusWeight(status: ClaimRecord["status"]): number {
  if (status === "ok") return 0.2
  if (status === "needs-review") return 0
  if (status === "stale") return -0.12
  if (status === "contradicted") return -0.22
  return -0.25
}

function matchedQueryTerms(queryTerms: readonly string[], text: string): string[] {
  const haystack = text.toLowerCase()
  return queryTerms.filter((term) => haystack.includes(term))
}

function tokenizeEvidenceQuery(query: string): string[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const terms = [
    ...normalized.matchAll(/[a-z0-9][a-z0-9_-]*/g),
    ...normalized.matchAll(/[\u3400-\u9fff]+/g),
  ].map((match) => match[0])
  if (terms.length === 0) terms.push(normalized)
  return uniqueStrings(terms)
}

function comparablePagePath(path: string): string {
  const normalized = normalizePath(path)
  const wikiIndex = normalized.indexOf("/wiki/")
  if (wikiIndex !== -1) return normalized.slice(wikiIndex + 1)
  return normalized
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

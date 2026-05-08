import type { ImageRef } from "@/lib/search-lexical"
import type { GraphPathDirection } from "@/lib/typed-graph"
import type { ClaimLifecycle, ClaimSourceRef, ClaimStatus } from "@/lib/claims"

export interface SearchResult {
  path: string
  title: string
  snippet: string
  titleMatch: boolean
  score: number
  retrieval?: SearchRetrievalExplanation
  graphPath?: string[]
  graphPathTypes?: string[]
  graphPathDirections?: GraphPathDirection[]
  claimEvidence?: ClaimEvidence[]
  images: ImageRef[]
}

export interface SearchStreamContribution {
  rank: number
  rawScore?: number
  rrf: number
}

export interface SearchGraphContribution extends SearchStreamContribution {
  path?: string[]
  pathTypes?: string[]
  pathDirections?: GraphPathDirection[]
}

export interface SearchRetrievalExplanation {
  rrfScore: number
  token?: SearchStreamContribution
  bm25?: SearchStreamContribution
  vector?: SearchStreamContribution
  graph?: SearchGraphContribution
}

export interface ClaimEvidence {
  claimId: string
  text: string
  pagePath: string
  pageTitle?: string
  pageAnchor?: string
  lifecycle: ClaimLifecycle
  status: ClaimStatus
  confidence: string
  score: number
  matchedTerms: string[]
  reasons: string[]
  sourceRefs: ClaimSourceRef[]
  redacted?: boolean
}

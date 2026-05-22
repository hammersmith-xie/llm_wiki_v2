import type { ClaimRecord } from "@/lib/claims"
import type { MemoryOpsSuggestion, MemoryOpsWikiPage } from "@/lib/memory-ops-types"

export const MEMORY_OPS_RESEARCH_VERDICTS = [
  "supported",
  "contradicted",
  "mixed",
  "insufficient",
  "unavailable",
] as const

export const MEMORY_OPS_RESEARCH_STANCES = [
  "support",
  "contradict",
  "neutral",
  "unknown",
] as const

export type MemoryOpsResearchVerdict = (typeof MEMORY_OPS_RESEARCH_VERDICTS)[number]
export type MemoryOpsResearchEvidenceStance = (typeof MEMORY_OPS_RESEARCH_STANCES)[number]

export type MemoryOpsResearchCandidateKind = "suggestion" | "claim" | "page"
export type MemoryOpsResearchProviderKind = "local" | "web-search" | "deep-research"

export interface MemoryOpsResearchCandidate {
  id: string
  kind: MemoryOpsResearchCandidateKind
  targetPath: string
  title: string
  query: string
  summary: string
  reasons: string[]
  scope?: "private" | "shared" | string
  suggestionId?: string
  claimId?: string
  pageId?: string
  source?: MemoryOpsSuggestion | ClaimRecord | MemoryOpsWikiPage
}

export interface MemoryOpsResearchEvidenceItem {
  id: string
  provider: MemoryOpsResearchProviderKind | string
  stance: MemoryOpsResearchEvidenceStance
  title: string
  url?: string
  path?: string
  source?: string
  snippet: string
  publishedAt?: string
  score?: number
}

export interface MemoryOpsResearchProviderResult {
  provider: MemoryOpsResearchProviderKind | string
  status: "ok" | "unavailable" | "error"
  evidence: MemoryOpsResearchEvidenceItem[]
  warnings: string[]
  durationMs: number
}

export type MemoryOpsResearchQuorumStatus =
  | "met"
  | "weak"
  | "conflict"
  | "unavailable"

export interface MemoryOpsResearchEvidenceMatrixProvider {
  provider: string
  status: MemoryOpsResearchProviderResult["status"]
  support: number
  contradict: number
  neutral: number
  unknown: number
  evidenceCount: number
}

export interface MemoryOpsResearchEvidenceMatrix {
  quorumStatus: MemoryOpsResearchQuorumStatus
  supportProviderCount: number
  contradictionProviderCount: number
  independentEvidenceCount: number
  providers: MemoryOpsResearchEvidenceMatrixProvider[]
}

export interface MemoryOpsResearchCandidateResult {
  candidate: Omit<MemoryOpsResearchCandidate, "source">
  verdict: MemoryOpsResearchVerdict
  confidence: number
  evidence: MemoryOpsResearchEvidenceItem[]
  providerResults: MemoryOpsResearchProviderResult[]
  evidenceMatrix: MemoryOpsResearchEvidenceMatrix
  warnings: string[]
}

export interface MemoryOpsResearchVerdictCounts {
  supported: number
  contradicted: number
  mixed: number
  insufficient: number
  unavailable: number
}

export interface MemoryOpsResearchQuorumCounts {
  met: number
  weak: number
  conflict: number
  unavailable: number
}

export interface MemoryOpsResearchReportSummary {
  candidateCount: number
  evidenceCount: number
  providerCount: number
  warningCount: number
  verdictCounts: MemoryOpsResearchVerdictCounts
  quorumCounts: MemoryOpsResearchQuorumCounts
}

export interface MemoryOpsResearchEvidenceReport {
  schemaVersion: 1
  id: string
  createdAt: string
  projectPath: string
  trigger: "manual" | "patrol" | "eval" | string
  providers: string[]
  summary: MemoryOpsResearchReportSummary
  results: MemoryOpsResearchCandidateResult[]
  warnings: string[]
}

export interface MemoryOpsResearchRunOptions {
  trigger?: MemoryOpsResearchEvidenceReport["trigger"]
  providers?: readonly MemoryOpsResearchProviderKind[]
  maxCandidates?: number
  maxResultsPerProvider?: number
}

export interface MemoryOpsResearchSuggestionSummary {
  verdict: MemoryOpsResearchVerdict
  confidence: number
  evidenceCount: number
  providerCount: number
  reportId: string
  createdAt: string
  supportScore?: number
  contradictionScore?: number
  neutralScore?: number
  recommendation?: "apply" | "review" | "defer" | "research" | "ignore"
  quorumStatus?: MemoryOpsResearchQuorumStatus
  supportProviderCount?: number
  contradictionProviderCount?: number
  independentEvidenceCount?: number
  reasons?: string[]
}

export function emptyResearchVerdictCounts(): MemoryOpsResearchVerdictCounts {
  return {
    supported: 0,
    contradicted: 0,
    mixed: 0,
    insufficient: 0,
    unavailable: 0,
  }
}

export function emptyResearchQuorumCounts(): MemoryOpsResearchQuorumCounts {
  return {
    met: 0,
    weak: 0,
    conflict: 0,
    unavailable: 0,
  }
}

export function summarizeResearchResults(
  results: readonly MemoryOpsResearchCandidateResult[],
): MemoryOpsResearchReportSummary {
  const verdictCounts = emptyResearchVerdictCounts()
  const quorumCounts = emptyResearchQuorumCounts()
  const providers = new Set<string>()
  let evidenceCount = 0
  let warningCount = 0

  for (const result of results) {
    verdictCounts[result.verdict] += 1
    quorumCounts[result.evidenceMatrix.quorumStatus] += 1
    evidenceCount += result.evidence.length
    warningCount += result.warnings.length
    for (const provider of result.providerResults) {
      providers.add(provider.provider)
    }
  }

  return {
    candidateCount: results.length,
    evidenceCount,
    providerCount: providers.size,
    warningCount,
    verdictCounts,
    quorumCounts,
  }
}

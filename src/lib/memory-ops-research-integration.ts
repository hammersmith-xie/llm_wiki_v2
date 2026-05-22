import { redactSensitiveText } from "@/lib/audit-redaction"
import type { ClaimRecord } from "@/lib/claims"
import {
  buildMemoryOpsEvidenceLedgerForSuggestion,
  decideMemoryOpsEvidenceLedger,
} from "@/lib/memory-ops-evidence-ledger"
import type {
  MemoryOpsResearchCandidate,
  MemoryOpsResearchEvidenceReport,
  MemoryOpsResearchSuggestionSummary,
} from "@/lib/memory-ops-research-types"
import type {
  MemoryOpsProjectSnapshot,
  MemoryOpsSuggestion,
  MemoryOpsWikiPage,
} from "@/lib/memory-ops-types"
import { normalizePath } from "@/lib/path-utils"

export interface MemoryOpsResearchCandidateSelectionOptions {
  maxCandidates?: number
}

export interface MemoryOpsResearchIntegrationSummary {
  reportId?: string
  createdAt?: string
  candidateCount: number
  evidenceCount: number
  warningCount: number
  supportedCount: number
  contradictedCount: number
  mixedCount: number
  insufficientCount: number
  unavailableCount: number
  matchedSuggestionCount: number
}

const DEFAULT_MAX_RESEARCH_CANDIDATES = 8

export function selectMemoryOpsResearchCandidates(
  snapshot: MemoryOpsProjectSnapshot,
  suggestions: readonly MemoryOpsSuggestion[],
  options: MemoryOpsResearchCandidateSelectionOptions = {},
): MemoryOpsResearchCandidate[] {
  const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? DEFAULT_MAX_RESEARCH_CANDIDATES))
  const candidates: MemoryOpsResearchCandidate[] = []
  const seen = new Set<string>()

  for (const suggestion of suggestions) {
    if (!shouldResearchSuggestion(suggestion)) continue
    pushUnique(candidates, seen, candidateFromSuggestion(suggestion))
    if (candidates.length >= maxCandidates) return candidates
  }

  for (const claim of snapshot.claims) {
    if (!shouldResearchClaim(claim)) continue
    pushUnique(candidates, seen, candidateFromClaim(claim))
    if (candidates.length >= maxCandidates) return candidates
  }

  for (const page of snapshot.pages) {
    if (!shouldResearchPage(page)) continue
    pushUnique(candidates, seen, candidateFromPage(snapshot.projectPath, page))
    if (candidates.length >= maxCandidates) return candidates
  }

  return candidates
}

export function enrichMemoryOpsSuggestionsWithResearch(
  suggestions: readonly MemoryOpsSuggestion[],
  report: MemoryOpsResearchEvidenceReport | null | undefined,
  snapshot?: MemoryOpsProjectSnapshot,
): MemoryOpsSuggestion[] {
  return suggestions.map((suggestion) => {
    const ledger = buildMemoryOpsEvidenceLedgerForSuggestion(suggestion, {
      snapshot,
      report,
    })
    const decision = ledger.length > 0 ? decideMemoryOpsEvidenceLedger(ledger) : null
    const result = report
      ? report.results.find((item) =>
          item.candidate.suggestionId === suggestion.id ||
          samePath(item.candidate.targetPath, suggestion.targetPath),
        ) ?? null
      : null
    if (!decision || !result || !report) return { ...suggestion }
    const research: MemoryOpsResearchSuggestionSummary = {
      verdict: decision.verdict,
      confidence: decision.confidence,
      evidenceCount: decision.evidenceCount,
      providerCount: decision.providerCount,
      reportId: report.id,
      createdAt: report.createdAt,
      supportScore: decision.supportScore,
      contradictionScore: decision.contradictionScore,
      neutralScore: decision.neutralScore,
      recommendation: decision.recommendation,
      quorumStatus: result.evidenceMatrix.quorumStatus,
      supportProviderCount: result.evidenceMatrix.supportProviderCount,
      contradictionProviderCount: result.evidenceMatrix.contradictionProviderCount,
      independentEvidenceCount: result.evidenceMatrix.independentEvidenceCount,
      uniqueSourceCount: result.evidenceMatrix.uniqueSourceCount,
      sourceDiversityScore: result.evidenceMatrix.sourceDiversityScore,
      reasons: decision.reasons,
    }
    return {
      ...suggestion,
      research,
      reasons: [
        ...suggestion.reasons,
        `research verdict ${decision.verdict} (${result.evidence.length} evidence item${result.evidence.length === 1 ? "" : "s"})`,
        `research recommendation ${decision.recommendation}`,
      ],
    }
  })
}

export function summarizeMemoryOpsResearchIntegration(
  report: MemoryOpsResearchEvidenceReport | null | undefined,
  suggestions: readonly MemoryOpsSuggestion[],
): MemoryOpsResearchIntegrationSummary {
  if (!report) {
    return {
      candidateCount: 0,
      evidenceCount: 0,
      warningCount: 0,
      supportedCount: 0,
      contradictedCount: 0,
      mixedCount: 0,
      insufficientCount: 0,
      unavailableCount: 0,
      matchedSuggestionCount: 0,
    }
  }

  return {
    reportId: report.id,
    createdAt: report.createdAt,
    candidateCount: report.summary.candidateCount,
    evidenceCount: report.summary.evidenceCount,
    warningCount: report.summary.warningCount,
    supportedCount: report.summary.verdictCounts.supported,
    contradictedCount: report.summary.verdictCounts.contradicted,
    mixedCount: report.summary.verdictCounts.mixed,
    insufficientCount: report.summary.verdictCounts.insufficient,
    unavailableCount: report.summary.verdictCounts.unavailable,
    matchedSuggestionCount: suggestions.filter((suggestion) => suggestion.research).length,
  }
}

function shouldResearchSuggestion(suggestion: MemoryOpsSuggestion): boolean {
  const text = [
    suggestion.id,
    suggestion.title,
    suggestion.detail,
    ...suggestion.reasons,
  ].join(" ").toLowerCase()
  return suggestion.severity === "warning" ||
    /stale|contradict|supersed|confidence|source|provenance|historical/.test(text)
}

function shouldResearchClaim(claim: ClaimRecord): boolean {
  if (claim.scope === "private") return false
  if (claim.status === "stale" || claim.status === "contradicted" || claim.status === "superseded") {
    return true
  }
  if (claim.source_refs.length === 0) return true
  const confidence = Number(claim.confidence)
  return Number.isFinite(confidence) && confidence < 0.5
}

function shouldResearchPage(page: MemoryOpsWikiPage): boolean {
  const evidence = page.evidence
  if (!evidence) return false
  if (evidence.risk.flags.some((flag) => flag !== "stale")) return true
  return evidence.staleness.stale &&
    evidence.sourceSupport.sourceCount + evidence.sourceSupport.supportingRelationCount === 0
}

function candidateFromSuggestion(suggestion: MemoryOpsSuggestion): MemoryOpsResearchCandidate {
  return {
    id: `suggestion:${suggestion.id}`,
    kind: "suggestion",
    targetPath: suggestion.targetPath,
    title: suggestion.title,
    query: researchQuery([
      suggestion.title,
      suggestion.detail,
      ...suggestion.reasons.slice(0, 3),
    ]),
    summary: redactSensitiveText(suggestion.detail),
    reasons: [...suggestion.reasons],
    scope: suggestion.proposedOperation?.scope,
    suggestionId: suggestion.id,
    source: suggestion,
  }
}

function candidateFromClaim(claim: ClaimRecord): MemoryOpsResearchCandidate {
  return {
    id: `claim:${claim.claim_id}`,
    kind: "claim",
    targetPath: claim.page_path,
    title: claim.page_title ?? claim.claim_id,
    query: researchQuery([claim.page_title ?? "", claim.text]),
    summary: claim.scope === "private" ? "[REDACTED:private]" : redactSensitiveText(claim.text),
    reasons: [
      `claim status ${claim.status}`,
      `${claim.source_refs.length} source ref${claim.source_refs.length === 1 ? "" : "s"}`,
      ...claim.confidence_reasons.slice(0, 3),
    ],
    scope: claim.scope,
    claimId: claim.claim_id,
    source: claim,
  }
}

function candidateFromPage(projectPath: string, page: MemoryOpsWikiPage): MemoryOpsResearchCandidate {
  const relativePath = toProjectRelativePath(projectPath, page.path)
  return {
    id: `page:${relativePath}`,
    kind: "page",
    targetPath: relativePath,
    title: page.id,
    query: researchQuery([page.id, page.fileName, page.evidence?.risk.flags.join(" ") ?? ""]),
    summary: redactSensitiveText(page.content.slice(0, 500)),
    reasons: [
      ...(page.evidence?.risk.flags.map((flag) => `risk ${flag}`) ?? []),
      page.evidence?.staleness.stale ? "page is stale" : "",
    ].filter(Boolean),
    pageId: page.id,
    source: page,
  }
}

function researchQuery(parts: readonly string[]): string {
  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240)
}

function pushUnique(
  candidates: MemoryOpsResearchCandidate[],
  seen: Set<string>,
  candidate: MemoryOpsResearchCandidate,
): void {
  const key = `${candidate.kind}:${normalizePath(candidate.targetPath)}:${candidate.claimId ?? candidate.suggestionId ?? candidate.pageId ?? ""}`
  if (seen.has(key)) return
  seen.add(key)
  candidates.push(candidate)
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase()
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

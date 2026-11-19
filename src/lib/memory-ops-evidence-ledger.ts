import type {
  MemoryOpsResearchCandidateResult,
  MemoryOpsResearchEvidenceItem,
  MemoryOpsResearchEvidenceReport,
  MemoryOpsResearchEvidenceStance,
  MemoryOpsResearchVerdict,
} from "@/lib/memory-ops-research-types"
import type {
  MemoryOpsProjectSnapshot,
  MemoryOpsSuggestion,
} from "@/lib/memory-ops-types"
import { normalizePath } from "@/lib/path-utils"

export type MemoryOpsEvidenceLedgerSource =
  | "local-page"
  | "claim"
  | "graph"
  | "historical-conflict"
  | "research-report"
  | "web"
  | "deep-research"

export type MemoryOpsEvidenceLedgerRecommendation =
  | "apply"
  | "review"
  | "defer"
  | "research"
  | "ignore"

export interface MemoryOpsEvidenceLedgerEntry {
  id: string
  source: MemoryOpsEvidenceLedgerSource
  stance: MemoryOpsResearchEvidenceStance
  score: number
  authority: number
  recency: number
  title: string
  snippet: string
  path?: string
  url?: string
  reasons: string[]
}

export interface MemoryOpsEvidenceLedgerDecision {
  verdict: MemoryOpsResearchVerdict
  confidence: number
  supportScore: number
  contradictionScore: number
  neutralScore: number
  evidenceCount: number
  providerCount: number
  supportProviderCount: number
  contradictionProviderCount: number
  recommendation: MemoryOpsEvidenceLedgerRecommendation
  reasons: string[]
}

export interface BuildMemoryOpsEvidenceLedgerOptions {
  snapshot?: MemoryOpsProjectSnapshot
  report?: MemoryOpsResearchEvidenceReport | null
}

export function buildMemoryOpsEvidenceLedgerForSuggestion(
  suggestion: MemoryOpsSuggestion,
  options: BuildMemoryOpsEvidenceLedgerOptions = {},
): MemoryOpsEvidenceLedgerEntry[] {
  return [
    ...localEntriesForSuggestion(suggestion, options.snapshot),
    ...researchReportEntriesForSuggestion(suggestion, options.report),
  ]
}

export function decideMemoryOpsEvidenceLedger(
  entries: readonly MemoryOpsEvidenceLedgerEntry[],
  providerCount = providerCountFromEntries(entries),
): MemoryOpsEvidenceLedgerDecision {
  const supportScore = scoreFor(entries, "support")
  const contradictionScore = scoreFor(entries, "contradict")
  const neutralScore = scoreFor(entries, "neutral") + scoreFor(entries, "unknown") * 0.25
  const supportProviderCount = providerCountForStance(entries, "support")
  const contradictionProviderCount = providerCountForStance(entries, "contradict")
  const totalRelevant = supportScore + contradictionScore
  const confidence = totalRelevant > 0
    ? clamp01(0.35 + Math.min(0.55, totalRelevant / 4) + Math.abs(supportScore - contradictionScore) * 0.08)
    : entries.length > 0
      ? 0.25
      : 0
  const verdict = verdictFromScores(entries, supportScore, contradictionScore)
  const recommendation = recommendationFromVerdict(verdict, confidence)

  return {
    verdict,
    confidence: roundScore(confidence),
    supportScore: roundScore(supportScore),
    contradictionScore: roundScore(contradictionScore),
    neutralScore: roundScore(neutralScore),
    evidenceCount: entries.length,
    providerCount,
    supportProviderCount,
    contradictionProviderCount,
    recommendation,
    reasons: decisionReasons(verdict, supportScore, contradictionScore, neutralScore, entries),
  }
}

export function researchResultToLedgerDecision(
  result: MemoryOpsResearchCandidateResult,
): MemoryOpsEvidenceLedgerDecision {
  return decideMemoryOpsEvidenceLedger(
    result.evidence.map(researchEvidenceToLedgerEntry),
    result.providerResults.length,
  )
}

export function researchEvidenceToLedgerEntry(
  evidence: MemoryOpsResearchEvidenceItem,
): MemoryOpsEvidenceLedgerEntry {
  return {
    id: evidence.id,
    source: sourceFromProvider(evidence.provider),
    stance: evidence.stance,
    score: scoreFromEvidence(evidence),
    authority: authorityFromProvider(evidence.provider),
    recency: recencyFromPublishedAt(evidence.publishedAt),
    title: evidence.title,
    snippet: evidence.snippet,
    path: evidence.path,
    url: evidence.url,
    reasons: [
      `provider ${evidence.provider}`,
      evidence.score !== undefined ? `raw score ${roundScore(evidence.score)}` : "",
      evidence.publishedAt ? `published ${evidence.publishedAt}` : "",
    ].filter(Boolean),
  }
}

function localEntriesForSuggestion(
  suggestion: MemoryOpsSuggestion,
  snapshot: MemoryOpsProjectSnapshot | undefined,
): MemoryOpsEvidenceLedgerEntry[] {
  if (!snapshot) return []
  const targetPath = normalizePath(suggestion.targetPath)
  const page = snapshot.pages.find((item) => samePath(item.path, targetPath) || samePath(toProjectRelativePath(snapshot.projectPath, item.path), targetPath))
  const entries: MemoryOpsEvidenceLedgerEntry[] = []

  if (page?.evidence) {
    const evidence = page.evidence
    if (evidence.sourceSupport.sourceCount + evidence.sourceSupport.supportingRelationCount > 0) {
      entries.push({
        id: `local-page:${suggestion.id}:support`,
        source: "local-page",
        stance: "support",
        score: 0.65,
        authority: 0.8,
        recency: recencyFromAgeDays(evidence.staleness.ageDays),
        title: page.id,
        snippet: `${evidence.sourceSupport.sourceCount} sources, ${evidence.sourceSupport.supportingRelationCount} supporting graph relations`,
        path: toProjectRelativePath(snapshot.projectPath, page.path),
        reasons: ["local page has source or graph support"],
      })
    }
    if (evidence.risk.contradictionCount > 0 || evidence.risk.supersededByCount > 0) {
      entries.push({
        id: `local-page:${suggestion.id}:contradict`,
        source: "local-page",
        stance: "contradict",
        score: 0.75,
        authority: 0.8,
        recency: recencyFromAgeDays(evidence.staleness.ageDays),
        title: page.id,
        snippet: `${evidence.risk.contradictionCount} contradictions, ${evidence.risk.supersededByCount} supersession links`,
        path: toProjectRelativePath(snapshot.projectPath, page.path),
        reasons: ["local page carries contradiction or supersession risk"],
      })
    }
  }

  for (const claim of snapshot.claims.filter((item) => samePath(item.page_path, targetPath))) {
    const stance: MemoryOpsResearchEvidenceStance =
      claim.status === "contradicted" || claim.status === "superseded"
        ? "contradict"
        : claim.source_refs.length > 0
          ? "support"
          : "neutral"
    entries.push({
      id: `claim:${claim.claim_id}`,
      source: "claim",
      stance,
      score: Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : 0.5,
      authority: claim.source_refs.length > 0 ? 0.8 : 0.45,
      recency: recencyFromDate(claim.last_confirmed),
      title: claim.page_title ?? claim.claim_id,
      snippet: claim.scope === "private" ? "[REDACTED:private]" : claim.text,
      path: claim.page_path,
      reasons: [
        `claim status ${claim.status}`,
        `${claim.source_refs.length} source ref${claim.source_refs.length === 1 ? "" : "s"}`,
      ],
    })
  }

  return entries
}

function researchReportEntriesForSuggestion(
  suggestion: MemoryOpsSuggestion,
  report: MemoryOpsResearchEvidenceReport | null | undefined,
): MemoryOpsEvidenceLedgerEntry[] {
  if (!report) return []
  const result = report.results.find((item) =>
    item.candidate.suggestionId === suggestion.id ||
    samePath(item.candidate.targetPath, suggestion.targetPath),
  )
  if (!result) return []
  if (result.evidence.length === 0) {
    return [researchResultSummaryEntry(report, result)]
  }
  return result.evidence.map((item) => {
    const entry = researchEvidenceToLedgerEntry(item)
    return {
      ...entry,
      source: "research-report",
      reasons: [
        `cached report ${report.id}`,
        `research verdict ${result.verdict}`,
        ...entry.reasons,
      ],
    }
  })
}

function researchResultSummaryEntry(
  report: MemoryOpsResearchEvidenceReport,
  result: MemoryOpsResearchCandidateResult,
): MemoryOpsEvidenceLedgerEntry {
  const stance = result.verdict === "contradicted"
    ? "contradict"
    : result.verdict === "supported"
      ? "support"
      : result.verdict === "mixed"
        ? "neutral"
        : "unknown"
  return {
    id: `research-report:${report.id}:${result.candidate.id}`,
    source: "research-report",
    stance,
    score: result.confidence || 0.5,
    authority: 0.6,
    recency: 0.8,
    title: result.candidate.title,
    snippet: result.candidate.summary,
    path: result.candidate.targetPath,
    reasons: [
      `cached report ${report.id}`,
      `research verdict ${result.verdict}`,
      "summary-only legacy research result",
    ],
  }
}

function verdictFromScores(
  entries: readonly MemoryOpsEvidenceLedgerEntry[],
  supportScore: number,
  contradictionScore: number,
): MemoryOpsResearchVerdict {
  if (entries.length === 0) return "unavailable"
  if (supportScore < 0.2 && contradictionScore < 0.2) return "insufficient"
  if (supportScore >= 0.2 && contradictionScore >= 0.2) return "mixed"
  if (contradictionScore > supportScore) return "contradicted"
  return "supported"
}

function recommendationFromVerdict(
  verdict: MemoryOpsResearchVerdict,
  confidence: number,
): MemoryOpsEvidenceLedgerRecommendation {
  if (verdict === "supported" && confidence >= 0.5) return "apply"
  if (verdict === "contradicted" || verdict === "mixed") return "review"
  if (verdict === "insufficient") return "research"
  if (verdict === "unavailable") return "defer"
  return "review"
}

function decisionReasons(
  verdict: MemoryOpsResearchVerdict,
  supportScore: number,
  contradictionScore: number,
  neutralScore: number,
  entries: readonly MemoryOpsEvidenceLedgerEntry[],
): string[] {
  return [
    `ledger verdict ${verdict}`,
    `support ${roundScore(supportScore)}`,
    `contradiction ${roundScore(contradictionScore)}`,
    neutralScore > 0 ? `neutral ${roundScore(neutralScore)}` : "",
    `${entries.length} evidence item${entries.length === 1 ? "" : "s"}`,
  ].filter(Boolean)
}

function scoreFor(
  entries: readonly MemoryOpsEvidenceLedgerEntry[],
  stance: MemoryOpsResearchEvidenceStance,
): number {
  return entries
    .filter((entry) => entry.stance === stance)
    .reduce((total, entry) => total + entry.score * entry.authority * entry.recency, 0)
}

function scoreFromEvidence(evidence: MemoryOpsResearchEvidenceItem): number {
  if (Number.isFinite(evidence.score)) return clamp01(evidence.score ?? 0)
  if (evidence.stance === "support" || evidence.stance === "contradict") return 0.65
  if (evidence.stance === "neutral") return 0.35
  return 0.2
}

function providerCountFromEntries(entries: readonly MemoryOpsEvidenceLedgerEntry[]): number {
  return new Set(entries.map((entry) => entry.source)).size
}

function providerCountForStance(
  entries: readonly MemoryOpsEvidenceLedgerEntry[],
  stance: MemoryOpsResearchEvidenceStance,
): number {
  return new Set(entries.filter((entry) => entry.stance === stance).map((entry) => entry.source)).size
}

function sourceFromProvider(provider: string): MemoryOpsEvidenceLedgerSource {
  if (provider === "web-search") return "web"
  if (provider === "deep-research") return "deep-research"
  if (provider === "local") return "local-page"
  return "research-report"
}

function authorityFromProvider(provider: string): number {
  if (provider === "deep-research") return 0.85
  if (provider === "web-search") return 0.7
  if (provider === "local") return 0.8
  return 0.6
}

function recencyFromPublishedAt(value: string | undefined): number {
  if (!value) return 0.75
  return recencyFromDate(value)
}

function recencyFromDate(value: string | undefined): number {
  if (!value) return 0.75
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return 0.65
  const ageDays = Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000))
  return recencyFromAgeDays(ageDays)
}

function recencyFromAgeDays(ageDays: number | undefined): number {
  if (ageDays === undefined) return 0.75
  if (ageDays <= 30) return 1
  if (ageDays <= 180) return 0.85
  if (ageDays <= 365) return 0.65
  return 0.45
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase()
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}

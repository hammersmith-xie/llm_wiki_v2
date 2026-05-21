import { readFile } from "@/commands/fs"
import type { SearchApiConfig } from "@/stores/wiki-store"
import { redactSensitiveText } from "@/lib/audit-redaction"
import { normalizePath } from "@/lib/path-utils"
import { webSearch } from "@/lib/web-search"
import { runMemoryOpsResearchProvider } from "@/lib/memory-ops-research-providers"
import type {
  MemoryOpsResearchCandidate,
  MemoryOpsResearchCandidateResult,
  MemoryOpsResearchEvidenceItem,
  MemoryOpsResearchEvidenceReport,
  MemoryOpsResearchProviderKind,
  MemoryOpsResearchProviderResult,
  MemoryOpsResearchRunOptions,
  MemoryOpsResearchVerdict,
} from "@/lib/memory-ops-research-types"
import { summarizeResearchResults } from "@/lib/memory-ops-research-types"

export interface RunMemoryOpsResearchEvidenceOptions extends MemoryOpsResearchRunOptions {
  searchConfig?: SearchApiConfig
  webSearchImpl?: typeof webSearch
  readFileImpl?: typeof readFile
  now?: Date
}

const DEFAULT_MAX_CANDIDATES = 8
export async function runMemoryOpsResearchEvidence(
  projectPath: string,
  candidates: readonly MemoryOpsResearchCandidate[],
  options: RunMemoryOpsResearchEvidenceOptions = {},
): Promise<MemoryOpsResearchEvidenceReport> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const maxCandidates = positiveInteger(options.maxCandidates, DEFAULT_MAX_CANDIDATES)
  const selected = candidates.slice(0, maxCandidates)
  const providers = normalizeProviders(options.providers)
  const results: MemoryOpsResearchCandidateResult[] = []
  const warnings: string[] = []

  for (const candidate of selected) {
    const providerResults: MemoryOpsResearchProviderResult[] = []
    for (const provider of providers) {
      const result = await runMemoryOpsResearchProvider(pp, candidate, provider, options)
      providerResults.push(result)
      warnings.push(...result.warnings.map((warning) => `${candidate.id}: ${warning}`))
    }
    results.push(buildCandidateResult(candidate, providerResults))
  }

  const createdAt = (options.now ?? new Date()).toISOString()
  return {
    schemaVersion: 1,
    id: researchReportId(createdAt),
    createdAt,
    projectPath: pp,
    trigger: options.trigger ?? "manual",
    providers,
    summary: summarizeResearchResults(results),
    results,
    warnings,
  }
}

function normalizeProviders(
  providers: readonly MemoryOpsResearchProviderKind[] | undefined,
): MemoryOpsResearchProviderKind[] {
  const defaultProviders: readonly MemoryOpsResearchProviderKind[] = ["local", "web-search"]
  const input = providers && providers.length > 0 ? providers : defaultProviders
  return [...new Set<MemoryOpsResearchProviderKind>(input)]
}

function buildCandidateResult(
  candidate: MemoryOpsResearchCandidate,
  providerResults: readonly MemoryOpsResearchProviderResult[],
): MemoryOpsResearchCandidateResult {
  const evidence = providerResults.flatMap((result) => result.evidence)
  const verdict = verdictFromEvidence(providerResults, evidence)
  const confidence = confidenceFromEvidence(verdict, evidence)
  const { source: _source, ...auditSafeCandidate } = candidate
  const sanitizedEvidence = evidence.map((item) => sanitizeEvidenceItem(candidate, item))
  return {
    candidate: {
      ...auditSafeCandidate,
      summary: candidate.scope === "private"
        ? "[REDACTED:private]"
        : redactSensitiveText(candidate.summary),
      query: redactSensitiveText(candidate.query),
    },
    verdict,
    confidence,
    evidence: sanitizedEvidence,
    providerResults: providerResults.map((result) => ({
      ...result,
      evidence: result.evidence.map((item) => ({
        ...sanitizeEvidenceItem(candidate, item),
      })),
    })),
    warnings: providerResults.flatMap((result) => result.warnings),
  }
}

function sanitizeEvidenceItem(
  candidate: MemoryOpsResearchCandidate,
  item: MemoryOpsResearchEvidenceItem,
): MemoryOpsResearchEvidenceItem {
  return {
    ...item,
    snippet: candidate.scope === "private"
      ? "[REDACTED:private]"
      : redactSensitiveText(item.snippet),
  }
}

function verdictFromEvidence(
  providerResults: readonly MemoryOpsResearchProviderResult[],
  evidence: readonly MemoryOpsResearchEvidenceItem[],
): MemoryOpsResearchVerdict {
  if (providerResults.every((result) => result.status === "unavailable")) return "unavailable"
  const supports = evidence.filter((item) => item.stance === "support").length
  const contradicts = evidence.filter((item) => item.stance === "contradict").length
  if (supports > 0 && contradicts > 0) return "mixed"
  if (contradicts > 0) return "contradicted"
  if (supports > 0) return "supported"
  return "insufficient"
}

function confidenceFromEvidence(
  verdict: MemoryOpsResearchVerdict,
  evidence: readonly MemoryOpsResearchEvidenceItem[],
): number {
  if (verdict === "unavailable") return 0
  const relevant = evidence.filter((item) => item.stance === "support" || item.stance === "contradict")
  if (relevant.length === 0) return 0.2
  return Math.min(0.95, 0.45 + relevant.length * 0.15)
}

function researchReportId(createdAt: string): string {
  return `research_${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (Number.isInteger(value) && value! > 0) return value!
  return fallback
}

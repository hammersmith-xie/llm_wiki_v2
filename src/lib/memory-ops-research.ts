import { readFile } from "@/commands/fs"
import type { SearchApiConfig } from "@/stores/wiki-store"
import { redactSensitiveText } from "@/lib/audit-redaction"
import { normalizePath } from "@/lib/path-utils"
import { webSearch } from "@/lib/web-search"
import { runMemoryOpsResearchProvider } from "@/lib/memory-ops-research-providers"
import { researchResultToLedgerDecision } from "@/lib/memory-ops-evidence-ledger"
import { buildMemoryOpsResearchEvidenceMatrix } from "@/lib/memory-ops-research-matrix"
import type { MemoryOpsProjectSnapshot } from "@/lib/memory-ops-types"
import type {
  MemoryOpsResearchCandidate,
  MemoryOpsResearchCandidateResult,
  MemoryOpsResearchEvidenceItem,
  MemoryOpsResearchEvidenceReport,
  MemoryOpsResearchProviderKind,
  MemoryOpsResearchProviderResult,
  MemoryOpsResearchRunOptions,
} from "@/lib/memory-ops-research-types"
import { summarizeResearchResults } from "@/lib/memory-ops-research-types"

export interface RunMemoryOpsResearchEvidenceOptions extends MemoryOpsResearchRunOptions {
  searchConfig?: SearchApiConfig
  webSearchImpl?: typeof webSearch
  readFileImpl?: typeof readFile
  snapshot?: MemoryOpsProjectSnapshot
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
  const providers = normalizeProviders(
    options.providers,
    options.snapshot?.policy.research.defaultProviders,
  )
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
  policyProviders: readonly MemoryOpsResearchProviderKind[] | undefined,
): MemoryOpsResearchProviderKind[] {
  const defaultProviders: readonly MemoryOpsResearchProviderKind[] = ["local", "web-search"]
  const input = providers && providers.length > 0
    ? providers
    : policyProviders && policyProviders.length > 0
      ? policyProviders
      : defaultProviders
  return [...new Set<MemoryOpsResearchProviderKind>(input)]
}

function buildCandidateResult(
  candidate: MemoryOpsResearchCandidate,
  providerResults: readonly MemoryOpsResearchProviderResult[],
): MemoryOpsResearchCandidateResult {
  const evidence = providerResults.flatMap((result) => result.evidence)
  const { source: _source, ...auditSafeCandidate } = candidate
  const sanitizedEvidence = evidence.map((item) => sanitizeEvidenceItem(candidate, item))
  const providerResultsForReport = providerResults.map((result) => ({
    ...result,
    evidence: result.evidence.map((item) => ({
      ...sanitizeEvidenceItem(candidate, item),
    })),
  }))
  const evidenceMatrix = buildMemoryOpsResearchEvidenceMatrix(providerResultsForReport)
  const provisional: MemoryOpsResearchCandidateResult = {
    candidate: {
      ...auditSafeCandidate,
      summary: candidate.scope === "private"
        ? "[REDACTED:private]"
        : redactSensitiveText(candidate.summary),
      query: redactSensitiveText(candidate.query),
    },
    verdict: "insufficient",
    confidence: 0,
    evidence: sanitizedEvidence,
    providerResults: providerResultsForReport,
    evidenceMatrix,
    warnings: providerResults.flatMap((result) => result.warnings),
  }
  const decision = providerResults.every((result) => result.status === "unavailable")
    ? null
    : researchResultToLedgerDecision(provisional)
  return {
    ...provisional,
    verdict: decision?.verdict ?? "unavailable",
    confidence: decision?.confidence ?? 0,
    evidenceMatrix,
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

function researchReportId(createdAt: string): string {
  return `research_${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (Number.isInteger(value) && value! > 0) return value!
  return fallback
}

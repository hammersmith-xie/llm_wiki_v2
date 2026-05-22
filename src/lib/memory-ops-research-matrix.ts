import { normalizePath } from "@/lib/path-utils"
import type {
  MemoryOpsResearchEvidenceItem,
  MemoryOpsResearchEvidenceMatrix,
  MemoryOpsResearchEvidenceMatrixProvider,
  MemoryOpsResearchProviderResult,
  MemoryOpsResearchQuorumStatus,
} from "@/lib/memory-ops-research-types"

export function buildMemoryOpsResearchEvidenceMatrix(
  providerResults: readonly MemoryOpsResearchProviderResult[],
): MemoryOpsResearchEvidenceMatrix {
  const providers = providerResults.map(providerMatrix)
  const supportProviderCount = providers.filter((provider) => provider.support > 0).length
  const contradictionProviderCount = providers.filter((provider) => provider.contradict > 0).length
  const independentEvidenceCount = providers.filter((provider) => provider.evidenceCount > 0).length
  const uniqueSourceCount = new Set(providers.flatMap((provider) => provider.sourceKeys)).size
  const sourceDiversityScore = diversityScore(uniqueSourceCount, independentEvidenceCount)
  return {
    quorumStatus: quorumStatus(
      supportProviderCount,
      contradictionProviderCount,
      independentEvidenceCount,
      uniqueSourceCount,
    ),
    supportProviderCount,
    contradictionProviderCount,
    independentEvidenceCount,
    uniqueSourceCount,
    sourceDiversityScore,
    providers,
  }
}

function providerMatrix(
  result: MemoryOpsResearchProviderResult,
): MemoryOpsResearchEvidenceMatrixProvider {
  return {
    provider: result.provider,
    status: result.status,
    support: result.evidence.filter((item) => item.stance === "support").length,
    contradict: result.evidence.filter((item) => item.stance === "contradict").length,
    neutral: result.evidence.filter((item) => item.stance === "neutral").length,
    unknown: result.evidence.filter((item) => item.stance === "unknown").length,
    evidenceCount: result.evidence.length,
    sourceKeys: [...new Set(result.evidence.map(sourceKeyForEvidence))],
  }
}

function quorumStatus(
  supportProviderCount: number,
  contradictionProviderCount: number,
  independentEvidenceCount: number,
  uniqueSourceCount: number,
): MemoryOpsResearchQuorumStatus {
  if (supportProviderCount > 0 && contradictionProviderCount > 0) return "conflict"
  if (independentEvidenceCount === 0) return "unavailable"
  if (uniqueSourceCount >= 2 && (supportProviderCount >= 2 || contradictionProviderCount >= 2)) return "met"
  return "weak"
}

function diversityScore(uniqueSourceCount: number, independentEvidenceCount: number): number {
  if (independentEvidenceCount === 0) return 0
  return roundScore(Math.min(1, uniqueSourceCount / Math.max(2, independentEvidenceCount)))
}

function sourceKeyForEvidence(item: MemoryOpsResearchEvidenceItem): string {
  if (item.url) return `url:${urlHost(item.url)}`
  if (item.path) return `path:${normalizePath(item.path).toLowerCase()}`
  if (item.source) return `source:${item.source.toLowerCase()}`
  return `evidence:${item.id}`
}

function urlHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}

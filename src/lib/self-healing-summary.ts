import { readConsolidationQueue } from "@/lib/consolidation-queue"
import type { MemoryOpsProjectSnapshot } from "@/lib/memory-ops"

export interface SelfHealingSummary {
  candidateCount: number
  claimProvenanceCandidateCount: number
  claimIndexCandidateCount: number
  consolidationQueueCandidateCount: number
  relationCleanupCandidateCount: number
  schemaWarningCandidateCount: number
  policyWarningCandidateCount: number
  warnings: string[]
  actions: SelfHealingActionSummary[]
}

export interface SelfHealingActionSummary {
  kind:
    | "claim-provenance"
    | "claim-index"
    | "consolidation"
    | "relation-cleanup"
    | "schema-warning"
    | "policy-warning"
  count: number
  dryRunOnly: boolean
  reason: string
}

export async function buildSelfHealingSummary(
  snapshot: MemoryOpsProjectSnapshot,
): Promise<SelfHealingSummary> {
  const queue = await readConsolidationQueue(snapshot.projectPath)
  const consolidationQueueCandidateCount = queue.items.filter((item) =>
    item.status === "queued"
  ).length
  const claimProvenanceCandidateCount =
    snapshot.stats.claimsMissingSourceRefCount +
    snapshot.stats.claimsMissingSnippetHashCount
  const claimIndexCandidateCount =
    snapshot.stats.orphanClaimCount +
    snapshot.stats.staleClaimCount
  const relationCleanupCandidateCount = snapshot.graph.edges.filter((edge) =>
    edge.explicit && edge.confidence < 0.45
  ).length
  const schemaWarningCandidateCount =
    (snapshot.schemaQualitySummary?.warningCount ?? 0) +
    (snapshot.schemaQualitySummary?.lowQualityPageCount ?? 0)
  const policyWarningCandidateCount = snapshot.policyWarnings.length

  const actions: SelfHealingActionSummary[] = [
    action("claim-provenance", claimProvenanceCandidateCount, "claims can be enriched or reviewed for source grounding"),
    action("claim-index", claimIndexCandidateCount, "claim index has stale or orphan records to review"),
    action("consolidation", consolidationQueueCandidateCount, "queued crystallization plans are waiting for user review"),
    action("relation-cleanup", relationCleanupCandidateCount, "low-confidence explicit graph edges should be reviewed"),
    action("schema-warning", schemaWarningCandidateCount, "schema and quality warnings can guide safe metadata repair"),
    action("policy-warning", policyWarningCandidateCount, "policy normalization warnings need user review"),
  ].filter((item) => item.count > 0)

  return {
    candidateCount: actions.reduce((sum, item) => sum + item.count, 0),
    claimProvenanceCandidateCount,
    claimIndexCandidateCount,
    consolidationQueueCandidateCount,
    relationCleanupCandidateCount,
    schemaWarningCandidateCount,
    policyWarningCandidateCount,
    warnings: queue.warnings,
    actions,
  }
}

function action(
  kind: SelfHealingActionSummary["kind"],
  count: number,
  reason: string,
): SelfHealingActionSummary {
  return {
    kind,
    count,
    dryRunOnly: true,
    reason,
  }
}

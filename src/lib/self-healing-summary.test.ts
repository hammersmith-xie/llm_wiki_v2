import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildSelfHealingSummary } from "./self-healing-summary"
import type { MemoryOpsProjectSnapshot } from "./memory-ops"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
}))

import { readFile } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  mockReadFile.mockReset()
})

describe("self-healing summary", () => {
  it("aggregates safe repair candidates without applying changes", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      version: 1,
      items: [
        {
          dedupeKey: "digest:one",
          sourceId: "a-1",
          status: "queued",
          counts: { decisionCount: 1 },
        },
        {
          dedupeKey: "digest:done",
          sourceId: "a-2",
          status: "applied",
          counts: { decisionCount: 1 },
        },
      ],
    }))

    const summary = await buildSelfHealingSummary(snapshot())

    expect(summary).toMatchObject({
      claimProvenanceCandidateCount: 3,
      claimIndexCandidateCount: 3,
      consolidationQueueCandidateCount: 1,
      relationCleanupCandidateCount: 1,
      schemaWarningCandidateCount: 3,
      policyWarningCandidateCount: 1,
      candidateCount: 12,
      actions: expect.arrayContaining([
        expect.objectContaining({ kind: "claim-provenance", dryRunOnly: true }),
        expect.objectContaining({ kind: "consolidation", count: 1 }),
      ]),
    })
  })

  it("returns an empty summary when there are no candidates", async () => {
    mockReadFile.mockRejectedValue(new Error("missing"))
    const base = snapshot()
    const empty = {
      ...base,
      policyWarnings: [],
      graph: { ...base.graph, edges: [] },
      schemaQualitySummary: null,
      stats: {
        ...base.stats,
        staleClaimCount: 0,
        orphanClaimCount: 0,
        claimsMissingSourceRefCount: 0,
        claimsMissingSnippetHashCount: 0,
      },
    } as MemoryOpsProjectSnapshot

    await expect(buildSelfHealingSummary(empty)).resolves.toMatchObject({
      candidateCount: 0,
      actions: [],
    })
  })
})

function snapshot(): MemoryOpsProjectSnapshot {
  return {
    projectPath: "/project",
    dataVersion: 1,
    policy: {} as never,
    policyWarnings: ["bad policy"],
    pages: [],
    graph: {
      nodes: new Map(),
      edges: [
        {
          source: "a",
          target: "b",
          type: "uses",
          weight: 1,
          confidence: 0.4,
          explicit: true,
          provenance: "frontmatter",
        },
      ],
      adjacency: new Map(),
      dataVersion: 1,
    },
    audit: { events: [], warnings: [] },
    schemaQualitySummary: {
      scannedAt: 1,
      pageCount: 2,
      contractName: "default",
      contractVersion: 1,
      schemaContractFound: true,
      findingCount: 2,
      warningCount: 1,
      infoCount: 0,
      averageQualityScore: 0.7,
      lowQualityPageCount: 2,
      suggestionCount: 2,
    },
    reviewItems: [],
    conversations: [],
    chatMessages: [],
    claims: [],
    claimHealth: {
      claimCount: 4,
      staleCount: 2,
      contradictedCount: 0,
      supersededCount: 0,
      orphanCount: 1,
      reinforcedCount: 0,
      missingSourceRefCount: 1,
      missingSnippetHashCount: 2,
    },
    selfHealingSummary: {
      candidateCount: 0,
      claimProvenanceCandidateCount: 0,
      claimIndexCandidateCount: 0,
      consolidationQueueCandidateCount: 0,
      relationCleanupCandidateCount: 0,
      schemaWarningCandidateCount: 0,
      policyWarningCandidateCount: 0,
      warnings: [],
      actions: [],
    },
    stats: {
      pageCount: 0,
      reviewItemCount: 0,
      conversationCount: 0,
      chatMessageCount: 0,
      auditEventCount: 0,
      auditWarningCount: 0,
      pageEvidenceCount: 0,
      pagesWithRecentUseCount: 0,
      pagesWithReinforcementCount: 0,
      pagesWithSourceSupportCount: 0,
      stalePageCount: 0,
      riskPageCount: 0,
      claimCount: 4,
      staleClaimCount: 2,
      contradictedClaimCount: 0,
      supersededClaimCount: 0,
      orphanClaimCount: 1,
      reinforcedClaimCount: 0,
      claimsMissingSourceRefCount: 1,
      claimsMissingSnippetHashCount: 2,
      historicalConflictCandidateCount: 0,
      historicalConflictSuggestionCount: 0,
      historicalConflictWarningCount: 0,
      selfHealingCandidateCount: 0,
      selfHealingWarningCount: 0,
    },
  }
}

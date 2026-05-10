import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryOpsPatrolBlock } from "./memory-ops-patrol-block"
import type { MemoryOpsPatrolReport } from "@/lib/memory-ops"
import { extractTypedGraphFromPages } from "@/lib/typed-graph"

describe("MemoryOpsPatrolBlock", () => {
  it("renders an explicit patrol reminder when maintenance status is reminder due", () => {
    const html = renderToStaticMarkup(
      <MemoryOpsPatrolBlock
        projectReady
        running={false}
        error={null}
        report={null}
        claimRepairWorking={false}
        claimRepairError={null}
        claimRepairPlan={null}
        claimBackfillWorking={false}
        claimBackfillError={null}
        claimBackfillResult={null}
        maintenanceStatus={{
          status: "reminder-due",
          needsPatrol: true,
          reminderDue: true,
          dirtySince: 1_000,
          eventCountSincePatrol: 7,
          lastReminderAt: 2_000,
          dueReasons: ["event-threshold"],
        }}
        recentAuditEvents={[]}
        ignoredSuggestionIds={new Set()}
        appliedSuggestionIds={new Set()}
        dryRunPlans={{}}
        suggestionErrors={{}}
        workingSuggestionId={null}
        selectedSuggestionIds={new Set()}
        batchWorking={false}
        lastBatchResult={null}
        rollbackPreviews={{}}
        rollbackResults={{}}
        rollbackErrors={{}}
        workingRollbackId={null}
        onRun={vi.fn()}
        onPreviewClaimRepair={vi.fn()}
        onApplyClaimRepair={vi.fn()}
        onPreviewClaimBackfill={vi.fn()}
        onApplyClaimBackfill={vi.fn()}
        onToggleSelection={vi.fn()}
        onSelectCategory={vi.fn()}
        onClearSelection={vi.fn()}
        onBatchPreview={vi.fn()}
        onBatchApply={vi.fn()}
        onBatchIgnore={vi.fn()}
        onPreviewRollback={vi.fn()}
        onApplyRollback={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onIgnore={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(html).toContain("Patrol reminder due")
    expect(html).toContain("7 wiki activity events")
    expect(html).toContain("Run Memory Ops patrol")
  })

  it("renders latest schema quality summary without mixing it into patrol suggestions", () => {
    const html = renderToStaticMarkup(
      <MemoryOpsPatrolBlock
        projectReady
        running={false}
        error={null}
        report={patrolReport()}
        claimRepairWorking={false}
        claimRepairError={null}
        claimRepairPlan={claimRepairPlan()}
        claimBackfillWorking={false}
        claimBackfillError={null}
        claimBackfillResult={claimBackfillResult()}
        maintenanceStatus={null}
        recentAuditEvents={[]}
        ignoredSuggestionIds={new Set()}
        appliedSuggestionIds={new Set()}
        dryRunPlans={{}}
        suggestionErrors={{}}
        workingSuggestionId={null}
        selectedSuggestionIds={new Set()}
        batchWorking={false}
        lastBatchResult={null}
        rollbackPreviews={{}}
        rollbackResults={{}}
        rollbackErrors={{}}
        workingRollbackId={null}
        onRun={vi.fn()}
        onPreviewClaimRepair={vi.fn()}
        onApplyClaimRepair={vi.fn()}
        onPreviewClaimBackfill={vi.fn()}
        onApplyClaimBackfill={vi.fn()}
        onToggleSelection={vi.fn()}
        onSelectCategory={vi.fn()}
        onClearSelection={vi.fn()}
        onBatchPreview={vi.fn()}
        onBatchApply={vi.fn()}
        onBatchIgnore={vi.fn()}
        onPreviewRollback={vi.fn()}
        onApplyRollback={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onIgnore={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(html).toContain("Latest Schema &amp; Quality scan")
    expect(html).toContain("Claim provenance repair")
    expect(html).toContain("1 repairable")
    expect(html).toContain("1 refs repaired")
    expect(html).toContain("Claim index backfill")
    expect(html).toContain("1 anchored recovered")
    expect(html).toContain("2 legacy backfilled")
    expect(html).toContain("3 schema findings")
    expect(html).toContain("2 schema warnings")
    expect(html).toContain("avg quality 0.73")
    expect(html).toContain("4 schema/quality suggestions")
    expect(html).toContain("Claims: 2")
    expect(html).toContain("1 no snippet hash")
    expect(html).toContain("No Memory Ops suggestions found.")
  })

  it("renders historical conflict counts in patrol summary", () => {
    const report = patrolReport({
      historicalConflictCandidateCount: 3,
      historicalConflictSuggestionCount: 2,
      historicalConflictWarningCount: 1,
    })
    const html = renderToStaticMarkup(
      <MemoryOpsPatrolBlock
        projectReady
        running={false}
        error={null}
        report={report}
        claimRepairWorking={false}
        claimRepairError={null}
        claimRepairPlan={null}
        claimBackfillWorking={false}
        claimBackfillError={null}
        claimBackfillResult={null}
        maintenanceStatus={null}
        recentAuditEvents={[]}
        ignoredSuggestionIds={new Set()}
        appliedSuggestionIds={new Set()}
        dryRunPlans={{}}
        suggestionErrors={{}}
        workingSuggestionId={null}
        selectedSuggestionIds={new Set()}
        batchWorking={false}
        lastBatchResult={null}
        rollbackPreviews={{}}
        rollbackResults={{}}
        rollbackErrors={{}}
        workingRollbackId={null}
        onRun={vi.fn()}
        onPreviewClaimRepair={vi.fn()}
        onApplyClaimRepair={vi.fn()}
        onPreviewClaimBackfill={vi.fn()}
        onApplyClaimBackfill={vi.fn()}
        onToggleSelection={vi.fn()}
        onSelectCategory={vi.fn()}
        onClearSelection={vi.fn()}
        onBatchPreview={vi.fn()}
        onBatchApply={vi.fn()}
        onBatchIgnore={vi.fn()}
        onPreviewRollback={vi.fn()}
        onApplyRollback={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
        onIgnore={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(html).toContain("3 conflict candidates")
    expect(html).toContain("2 conflict review suggestions")
    expect(html).toContain("1 conflict warnings")
  })
})

function claimRepairPlan() {
  return {
    dryRun: true,
    items: [],
    warnings: [],
    stats: {
      claimCount: 4,
      repairableCount: 1,
      repairedSourceRefCount: 1,
      alreadyCompleteCount: 1,
      noSourceRefsCount: 1,
      sourceUnreadableCount: 0,
      noMatchCount: 1,
      warningCount: 0,
    },
  }
}

function claimBackfillResult() {
  return {
    dryRun: true,
    recovered: [],
    backfilled: [],
    orphanClaims: [],
    staleClaims: [],
    warnings: [],
    stats: {
      recoveredCount: 1,
      backfilledCount: 2,
      orphanCount: 0,
      staleCount: 1,
      warningCount: 0,
    },
  }
}

function patrolReport(
  statsOverrides: Partial<MemoryOpsPatrolReport["stats"]> = {},
): MemoryOpsPatrolReport {
  const historicalConflictCandidateCount = statsOverrides.historicalConflictCandidateCount ?? 0
  const historicalConflictSuggestionCount = statsOverrides.historicalConflictSuggestionCount ?? 0
  const historicalConflictWarningCount = statsOverrides.historicalConflictWarningCount ?? 0

  return {
    warnings: [],
    suggestions: [],
    stats: {
      pageCount: 8,
      reviewItemCount: 0,
      conversationCount: 0,
      chatMessageCount: 0,
      auditEventCount: 1,
      auditWarningCount: 0,
      pageEvidenceCount: 8,
      pagesWithRecentUseCount: 0,
      pagesWithReinforcementCount: 0,
      pagesWithSourceSupportCount: 0,
      stalePageCount: 0,
      riskPageCount: 0,
      claimCount: 2,
      staleClaimCount: 1,
      contradictedClaimCount: 0,
      supersededClaimCount: 0,
      orphanClaimCount: 0,
      reinforcedClaimCount: 1,
      claimsMissingSourceRefCount: 0,
      claimsMissingSnippetHashCount: 1,
      historicalConflictCandidateCount,
      historicalConflictSuggestionCount,
      historicalConflictWarningCount,
      selfHealingCandidateCount: 0,
      selfHealingWarningCount: 0,
      suggestionCount: 0,
      ...statsOverrides,
    },
    snapshot: {
      projectPath: "/project",
      dataVersion: 9,
      policy: {
        version: 1,
        name: "default",
        halfLives: {
          working: 45,
          episodic: 45,
          semantic: 180,
          procedural: 365,
          archived: 45,
        },
        staleMultiplier: 2,
        lowConfidenceThreshold: 0.45,
        promotion: {
          minSources: 2,
          minReinforcement: 3,
        },
        archive: {
          requireNoSourceSupport: true,
          requireNoReinforcement: true,
          requireNoRecentUse: true,
        },
        automation: {
          autoPatrolEnabled: true,
          eventThreshold: 5,
          reminderCooldownMinutes: 30,
          minPatrolIntervalMinutes: 30,
          timeIntervalHours: 24,
          maintenanceDaemonEnabled: true,
          maintenanceCheckIntervalMinutes: 15,
        },
      },
      policyWarnings: [],
      pages: [],
      graph: extractTypedGraphFromPages([], 9),
      audit: { events: [], warnings: [] },
      schemaQualitySummary: {
        scannedAt: 1_777_777,
        dataVersion: 9,
        pageCount: 8,
        contractName: "llm-wiki-v2-default",
        contractVersion: 1,
        schemaContractFound: true,
        findingCount: 3,
        warningCount: 2,
        infoCount: 1,
        averageQualityScore: 0.73,
        lowQualityPageCount: 2,
        suggestionCount: 4,
      },
      reviewItems: [],
      conversations: [],
      chatMessages: [],
      claims: [],
      claimHealth: {
        claimCount: 2,
        staleCount: 1,
        contradictedCount: 0,
        supersededCount: 0,
        orphanCount: 0,
        reinforcedCount: 1,
        missingSourceRefCount: 0,
        missingSnippetHashCount: 1,
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
        pageCount: 8,
        reviewItemCount: 0,
        conversationCount: 0,
        chatMessageCount: 0,
        auditEventCount: 1,
        auditWarningCount: 0,
        pageEvidenceCount: 8,
        pagesWithRecentUseCount: 0,
        pagesWithReinforcementCount: 0,
        pagesWithSourceSupportCount: 0,
        stalePageCount: 0,
        riskPageCount: 0,
        claimCount: 2,
        staleClaimCount: 1,
        contradictedClaimCount: 0,
        supersededClaimCount: 0,
        orphanClaimCount: 0,
        reinforcedClaimCount: 1,
        claimsMissingSourceRefCount: 0,
        claimsMissingSnippetHashCount: 1,
        historicalConflictCandidateCount,
        historicalConflictSuggestionCount,
        historicalConflictWarningCount,
        selfHealingCandidateCount: 0,
        selfHealingWarningCount: 0,
      },
    },
  }
}

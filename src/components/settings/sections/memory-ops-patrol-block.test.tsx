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
        maintenanceStatus={{
          status: "reminder-due",
          needsPatrol: true,
          reminderDue: true,
          dirtySince: 1_000,
          eventCountSincePatrol: 7,
          lastReminderAt: 2_000,
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
    expect(html).toContain("3 schema findings")
    expect(html).toContain("2 schema warnings")
    expect(html).toContain("avg quality 0.73")
    expect(html).toContain("4 schema/quality suggestions")
    expect(html).toContain("No Memory Ops suggestions found.")
  })
})

function patrolReport(): MemoryOpsPatrolReport {
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
      historicalConflictCandidateCount: 0,
      historicalConflictSuggestionCount: 0,
      historicalConflictWarningCount: 0,
      suggestionCount: 0,
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
        historicalConflictCandidateCount: 0,
        historicalConflictSuggestionCount: 0,
        historicalConflictWarningCount: 0,
      },
    },
  }
}

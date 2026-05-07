import { describe, expect, it } from "vitest"
import type { AuditEvent } from "@/lib/audit-timeline"
import type { MetadataPatchPlan } from "@/lib/memory-ops-executor"
import type { MemoryOpsPatrolReport } from "@/lib/memory-ops"
import type { MemoryOpsSuggestion } from "@/lib/memory-ops-rules"
import {
  auditEventTargetLabel,
  categorizeMemoryOpsSuggestion,
  groupMemoryOpsSuggestionsByCategory,
  metadataPatchDiffLabel,
  selectRecentAuditEvents,
  summarizeMemoryOpsPatrolReport,
  visibleMemoryOpsSuggestions,
} from "./memory-ops-ui"

describe("memory ops ui helpers", () => {
  it("summarizes patrol reports for the maintenance card", () => {
    const report = {
      stats: {
        pageCount: 8,
        reviewItemCount: 2,
        conversationCount: 1,
        chatMessageCount: 5,
        auditEventCount: 3,
        auditWarningCount: 1,
        stalePageCount: 2,
        riskPageCount: 1,
        suggestionCount: 0,
      },
      warnings: [{ line: 4, message: "bad json", raw: "{" }],
      snapshot: {
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
      },
      suggestions: [
        suggestion("a", "metadata-update", { title: "Mark stale page" }),
        suggestion("b", "relation-cleanup", { title: "Review unresolved typed relation" }),
        suggestion("c", "review-action", { title: "Review contradiction pair" }),
        suggestion("d", "metadata-update", { title: "Archive stale unsupported page" }),
      ],
    } as unknown as MemoryOpsPatrolReport

    expect(summarizeMemoryOpsPatrolReport(report)).toMatchObject({
      pageCount: 8,
      suggestionCount: 0,
      warningCount: 1,
      auditEventCount: 3,
      stalePageCount: 2,
      riskPageCount: 1,
      emptySuggestions: false,
      categoryCounts: {
        lifecycle: 1,
        relation: 1,
        contradiction: 1,
        retention: 1,
      },
      schemaQualitySummary: {
        findingCount: 3,
        averageQualityScore: 0.73,
      },
    })
  })

  it("groups suggestions by maintenance category in stable display order", () => {
    const suggestions = [
      suggestion("search", "metadata-update", { title: "Search health degraded" }),
      suggestion("relation", "relation-cleanup"),
      suggestion("archive", "metadata-update", { title: "Archive stale unsupported page" }),
      suggestion("contradiction", "review-action", { title: "Review contradiction pair" }),
      suggestion("lifecycle", "metadata-update", { title: "Refresh last confirmed date" }),
    ]

    expect(categorizeMemoryOpsSuggestion(suggestions[0])).toBe("search-health")
    expect(groupMemoryOpsSuggestionsByCategory(suggestions).map((group) => group.category)).toEqual([
      "lifecycle",
      "relation",
      "contradiction",
      "retention",
      "search-health",
    ])
  })

  it("selects recent audit events in reverse chronological order", () => {
    const events: AuditEvent[] = [
      { timestamp: "2026-05-07T01:00:00.000Z", action: "ingest.source", pagePath: "wiki/sources/a.md" },
      { timestamp: "2026-05-07T03:00:00.000Z", action: "memory_ops.patrol", targetPath: ".llm-wiki/audit.jsonl" },
      { timestamp: "2026-05-07T02:00:00.000Z", action: "crystallize.query", pagePath: "wiki/queries/q.md" },
    ]

    expect(selectRecentAuditEvents(events, 2).map((event) => event.action)).toEqual([
      "memory_ops.patrol",
      "crystallize.query",
    ])
  })

  it("uses the most specific path label available for audit rows", () => {
    expect(
      auditEventTargetLabel({
        action: "memory_ops.apply",
        targetPath: "wiki/concepts/a.md",
      }),
    ).toBe("wiki/concepts/a.md")
    expect(
      auditEventTargetLabel({
        action: "chat.answer",
        sourcePath: "conversation-1",
      }),
    ).toBe("conversation-1")
    expect(auditEventTargetLabel({ action: "memory_ops.patrol" })).toBe(".llm-wiki/audit.jsonl")
  })

  it("filters ignored and applied suggestions from the active list", () => {
    const suggestions = [
      suggestion("a", "metadata-update"),
      suggestion("b", "relation-cleanup"),
      suggestion("c", "metadata-update"),
    ]

    expect(
      visibleMemoryOpsSuggestions(suggestions, {
        ignoredIds: new Set(["b"]),
        appliedIds: new Set(["c"]),
      }).map((item) => item.id),
    ).toEqual(["a"])
  })

  it("formats metadata patch diffs before confirmation", () => {
    const plan = {
      diff: [
        { field: "review_status", before: "ok", after: "stale" },
        { field: "confidence_reasons", before: undefined, after: ["last confirmed 400 days ago"] },
      ],
    } as MetadataPatchPlan

    expect(plan.diff.map(metadataPatchDiffLabel)).toEqual([
      "review_status: ok -> stale",
      "confidence_reasons: (empty) -> last confirmed 400 days ago",
    ])
  })
})

function suggestion(
  id: string,
  kind: MemoryOpsSuggestion["kind"],
  overrides: Partial<MemoryOpsSuggestion> = {},
): MemoryOpsSuggestion {
  return {
    id,
    kind,
    severity: "info",
    targetPath: `wiki/${id}.md`,
    title: id,
    detail: id,
    reasons: [],
    ...overrides,
  }
}

import { describe, expect, it } from "vitest"
import type { AuditEvent } from "@/lib/audit-timeline"
import type { MemoryOpsPatrolReport } from "@/lib/memory-ops"
import {
  auditEventTargetLabel,
  selectRecentAuditEvents,
  summarizeMemoryOpsPatrolReport,
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
        suggestionCount: 0,
      },
      warnings: [{ line: 4, message: "bad json", raw: "{" }],
      suggestions: [],
    } as unknown as MemoryOpsPatrolReport

    expect(summarizeMemoryOpsPatrolReport(report)).toEqual({
      pageCount: 8,
      suggestionCount: 0,
      warningCount: 1,
      auditEventCount: 3,
      emptySuggestions: true,
    })
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
})

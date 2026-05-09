import { describe, expect, it } from "vitest"
import type { AuditEvent, AuditTimelineWarning } from "./audit-timeline"
import {
  auditTimelineTargetLabel,
  buildAuditTimelineVisualizationSummary,
  filterAuditTimelineEvents,
  sortAuditTimelineEvents,
  summarizeAuditTimelineEvent,
  summarizeAuditTimelineWarnings,
} from "./audit-timeline-ui"

describe("audit timeline ui helpers", () => {
  it("sorts newest first and applies the default limit", () => {
    const events = [
      event("ingest.write", "2026-05-07T00:00:00.000Z"),
      event("memory_ops.apply", "2026-05-07T00:02:00.000Z"),
      event("search.run", "2026-05-07T00:01:00.000Z"),
    ]

    expect(sortAuditTimelineEvents(events).map((item) => item.action)).toEqual([
      "memory_ops.apply",
      "search.run",
      "ingest.write",
    ])
    expect(filterAuditTimelineEvents(events, { limit: 2 }).map((item) => item.action)).toEqual([
      "memory_ops.apply",
      "search.run",
    ])
  })

  it("filters by category, action, path, scope, status, text, and date range", () => {
    const events: AuditEvent[] = [
      {
        action: "memory_ops.apply",
        category: "memory_ops",
        timestamp: "2026-05-07T10:00:00.000Z",
        targetPath: "wiki/concepts/a.md",
        scope: "shared",
        changes: { status: "applied" },
        reasons: ["Mark stale page"],
      },
      {
        action: "search.run",
        category: "search",
        timestamp: "2026-05-07T11:00:00.000Z",
        targetPath: ".llm-wiki/audit.jsonl",
        scope: "private",
        changes: { status: "dry-run" },
        retrieval: {
          query: "hybrid search",
          results: [{ path: "wiki/concepts/search.md", rank: 1 }],
        },
      },
      {
        action: "review.resolve",
        category: "review",
        timestamp: "2026-05-08T10:00:00.000Z",
        targetPath: "wiki/concepts/review.md",
        changes: { status: "ignored" },
      },
      {
        action: "conflict.review",
        category: "conflict",
        timestamp: "2026-05-08T11:00:00.000Z",
        targetPath: "wiki/concepts/conflict.md",
        changes: { status: "review-only" },
        reasons: ["pre-write conflict review required"],
      },
      {
        action: "audit.export",
        category: "export",
        timestamp: "2026-05-08T12:00:00.000Z",
        targetPath: ".llm-wiki/exports",
        changes: { status: "applied" },
        reasons: ["exported audit events"],
      },
    ]

    expect(filterAuditTimelineEvents(events, { category: "memory_ops" }).map((item) => item.action)).toEqual(["memory_ops.apply"])
    expect(filterAuditTimelineEvents(events, { category: "conflict" }).map((item) => item.action)).toEqual(["conflict.review"])
    expect(filterAuditTimelineEvents(events, { category: "export" }).map((item) => item.action)).toEqual(["audit.export"])
    expect(filterAuditTimelineEvents(events, { action: "search" }).map((item) => item.action)).toEqual(["search.run"])
    expect(filterAuditTimelineEvents(events, { path: "wiki/concepts/search.md" }).map((item) => item.action)).toEqual(["search.run"])
    expect(filterAuditTimelineEvents(events, { scope: "private" }).map((item) => item.action)).toEqual(["search.run"])
    expect(filterAuditTimelineEvents(events, { status: "applied" }).map((item) => item.action)).toEqual(["audit.export", "memory_ops.apply"])
    expect(filterAuditTimelineEvents(events, { status: "review-only" }).map((item) => item.action)).toEqual(["conflict.review"])
    expect(filterAuditTimelineEvents(events, { text: "stale" }).map((item) => item.action)).toEqual(["memory_ops.apply"])
    expect(filterAuditTimelineEvents(events, {
      dateFrom: "2026-05-07T00:00:00.000Z",
      dateTo: "2026-05-07T23:59:59.999Z",
    }).map((item) => item.action)).toEqual(["search.run", "memory_ops.apply"])
  })

  it("summarizes event labels, reasons, retrieval, and diff fields", () => {
    const summary = summarizeAuditTimelineEvent({
      action: "search.run",
      category: "search",
      actor: "user",
      timestamp: "2026-05-07T10:00:00.000Z",
      targetPath: ".llm-wiki/audit.jsonl",
      scope: "shared",
      changes: {
        status: "dry-run",
        diff: [
          { field: "review_status", before: "ok", after: "stale" },
          { field: "confidence", before: "0.9", after: "0.7" },
        ],
      },
      retrieval: {
        query: "hybrid search",
        streams: [{ name: "bm25", resultCount: 3 }],
        results: [{ path: "wiki/concepts/search.md", rank: 1 }],
      },
      reasons: ["explicit user search"],
    })

    expect(summary).toMatchObject({
      action: "search.run",
      category: "search",
      actor: "user",
      targetLabel: ".llm-wiki/audit.jsonl",
      status: "dry-run",
      scope: "shared",
      reasonText: "explicit user search",
      retrievalText: "query \"hybrid search\"; 1 stream; 1 result",
      diffText: "review_status, confidence",
    })
  })

  it("builds visualization buckets from filtered audit events", () => {
    const summary = buildAuditTimelineVisualizationSummary([
      {
        action: "memory_ops.apply",
        category: "memory_ops",
        timestamp: "2026-05-07T10:00:00.000Z",
        changes: { status: "applied" },
      },
      {
        action: "search.run",
        category: "search",
        timestamp: "2026-05-07T12:00:00.000Z",
        changes: { status: "dry-run" },
      },
      {
        action: "audit.export",
        category: "export",
        timestamp: "2026-05-08T10:00:00.000Z",
        changes: { status: "applied" },
      },
      {
        action: "schema.scan",
        category: "schema",
        timestamp: "bad",
      },
    ])

    expect(summary.totalCount).toBe(4)
    expect(summary.activeDayCount).toBe(2)
    expect(summary.dayBuckets).toEqual([
      { key: "2026-05-07", date: "2026-05-07", count: 2, percentage: 100 },
      { key: "2026-05-08", date: "2026-05-08", count: 1, percentage: 50 },
    ])
    expect(summary.categoryBuckets).toEqual([
      { key: "export", count: 1, percentage: 25 },
      { key: "memory_ops", count: 1, percentage: 25 },
      { key: "schema", count: 1, percentage: 25 },
      { key: "search", count: 1, percentage: 25 },
    ])
    expect(summary.statusBuckets).toEqual([
      { key: "applied", count: 2, percentage: 50 },
      { key: "dry-run", count: 1, percentage: 25 },
      { key: "unknown", count: 1, percentage: 25 },
    ])
  })

  it("keeps private event summaries minimal", () => {
    const summary = summarizeAuditTimelineEvent({
      action: "memory_ops.preview",
      category: "memory_ops",
      scope: "private",
      targetPath: "wiki/private.md",
      redacted: true,
      after: { status: "dry-run" },
    })

    expect(summary.scope).toBe("private")
    expect(summary.status).toBe("dry-run")
    expect(JSON.stringify(summary)).not.toContain("beforeContent")
  })

  it("summarizes bad-line warnings", () => {
    const warnings: AuditTimelineWarning[] = [
      { line: 2, message: "Invalid JSON", raw: "bad" },
      { line: 7, message: "Expected object", raw: "[]" },
    ]

    expect(summarizeAuditTimelineWarnings(warnings)).toEqual({
      count: 2,
      lines: [2, 7],
      messages: ["Invalid JSON", "Expected object"],
    })
  })

  it("chooses the best target label", () => {
    expect(auditTimelineTargetLabel({ action: "x", pagePath: "wiki/a.md" })).toBe("wiki/a.md")
    expect(auditTimelineTargetLabel({ action: "x", sourcePath: "raw/a.md" })).toBe("raw/a.md")
    expect(auditTimelineTargetLabel({ action: "x" })).toBe(".llm-wiki/audit.jsonl")
  })
})

function event(action: string, timestamp: string): AuditEvent {
  return { action, timestamp }
}

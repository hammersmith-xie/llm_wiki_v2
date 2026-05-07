import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildSchemaQualityScanAuditEvent,
  buildSchemaQualityScanReport,
  runSchemaQualityScan,
} from "./schema-quality"

vi.mock("@/lib/audit-timeline", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-timeline")>(
    "@/lib/audit-timeline",
  )
  return {
    ...actual,
    appendAuditEvent: vi.fn(async () => {}),
  }
})

import { appendAuditEvent } from "@/lib/audit-timeline"

const mockAppendAuditEvent = vi.mocked(appendAuditEvent)

beforeEach(() => {
  mockAppendAuditEvent.mockReset()
  mockAppendAuditEvent.mockResolvedValue(undefined)
})

describe("schema quality scan", () => {
  it("builds a report from schema markdown, drift findings, and quality scores", () => {
    const report = buildSchemaQualityScanReport({
      schemaMarkdown: `# Schema

\`\`\`yaml llm-wiki-schema-contract
version: 1
name: scan-contract
quality:
  minQualityScore: 0.6
\`\`\`
`,
      pages: [
        {
          path: "wiki/concepts/stub.md",
          content: `---
type: concept
title: Stub
tags: []
related: []
created: 2026-05-07
updated: 2026-05-07
scope: shared
---

# Stub

Tiny note.
`,
        },
      ],
    })

    expect(report.summary).toMatchObject({
      pageCount: 1,
      contractName: "scan-contract",
      contractVersion: 1,
      schemaContractFound: true,
      lowQualityPageCount: 1,
    })
    expect(report.findings.length).toBeGreaterThan(0)
    expect(report.qualityScores).toHaveLength(1)
    expect(report.qualityScores[0].score).toBeLessThan(0.6)
  })

  it("falls back to defaults when schema markdown is missing", () => {
    const report = buildSchemaQualityScanReport({ pages: [] })

    expect(report.summary).toMatchObject({
      pageCount: 0,
      contractName: "llm-wiki-v2-default",
      schemaContractFound: false,
      averageQualityScore: 0,
    })
    expect(report.contractWarnings).toEqual([
      "Schema markdown not provided; using defaults.",
    ])
  })

  it("builds a compact audit event without page body content", () => {
    const report = buildSchemaQualityScanReport({
      pages: [
        {
          path: "wiki/concepts/private.md",
          content: `---
type: concept
title: Private
tags: []
related: []
created: bad-date
updated: 2026-05-07
scope: private
---

# Private

SECRET_TOKEN=abc123
`,
        },
      ],
    })
    const event = buildSchemaQualityScanAuditEvent(report)

    expect(event).toMatchObject({
      action: "memory_ops.schema_quality",
      actor: "system",
      targetPath: ".llm-wiki/audit.jsonl",
    })
    expect(JSON.stringify(event)).not.toContain("SECRET_TOKEN")
    expect(event.reasons).toEqual(expect.arrayContaining([
      "1 page scanned",
    ]))
  })

  it("writes audit best-effort when projectPath is provided", async () => {
    const result = await runSchemaQualityScan({
      projectPath: "/project",
      pages: [],
    })

    expect(result.auditError).toBeUndefined()
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ action: "memory_ops.schema_quality" }),
    )
  })

  it("returns auditError without dropping scan report", async () => {
    mockAppendAuditEvent.mockRejectedValueOnce(new Error("disk full"))

    const result = await runSchemaQualityScan({
      projectPath: "/project",
      pages: [],
    })

    expect(result.report.summary.pageCount).toBe(0)
    expect(result.auditError).toBe("disk full")
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildWikiAutomationAuditEvent,
  recordWikiAutomationEvent,
} from "./wiki-automation-events"

vi.mock("@/lib/audit-timeline", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-timeline")>(
    "@/lib/audit-timeline",
  )
  return {
    ...actual,
    appendAuditEvent: vi.fn(async () => {}),
  }
})

vi.mock("@/lib/memory-ops", () => ({
  recordMemoryOpsMaintenanceEvent: vi.fn(async () => {}),
  runMemoryOpsPatrol: vi.fn(async () => {
    throw new Error("automation events must not run patrol")
  }),
}))

import { appendAuditEvent } from "@/lib/audit-timeline"
import { recordMemoryOpsMaintenanceEvent, runMemoryOpsPatrol } from "@/lib/memory-ops"

const mockAppendAuditEvent = vi.mocked(appendAuditEvent)
const mockRecordMaintenanceEvent = vi.mocked(recordMemoryOpsMaintenanceEvent)
const mockRunMemoryOpsPatrol = vi.mocked(runMemoryOpsPatrol)

beforeEach(() => {
  mockAppendAuditEvent.mockReset()
  mockAppendAuditEvent.mockResolvedValue(undefined)
  mockRecordMaintenanceEvent.mockReset()
  mockRecordMaintenanceEvent.mockResolvedValue(undefined)
  mockRunMemoryOpsPatrol.mockClear()
})

describe("wiki automation events", () => {
  it("builds session start audit events with stable defaults", () => {
    expect(buildWikiAutomationAuditEvent({
      type: "session.start",
      projectPath: "/project",
      summary: { conversationId: "c1" },
    })).toMatchObject({
      action: "session.start",
      actor: "user",
      targetPath: ".llm-wiki/sessions",
      after: {
        eventType: "session.start",
        conversationId: "c1",
      },
      reasons: ["automation event session.start"],
    })
  })

  it("records memory write events to audit and maintenance dirty state", async () => {
    const result = await recordWikiAutomationEvent({
      type: "memory.write",
      projectPath: "/project",
      actor: "agent",
      targetPath: "wiki/concepts/a.md",
      status: "applied",
      reasons: ["ingest wrote wiki page"],
      summary: { pageCount: 1 },
      maintenance: { now: 123 },
    })

    expect(result.auditError).toBeUndefined()
    expect(result.maintenanceError).toBeUndefined()
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        action: "memory.write",
        actor: "agent",
        targetPath: "wiki/concepts/a.md",
        changes: { status: "applied" },
      }),
    )
    expect(mockRecordMaintenanceEvent).toHaveBeenCalledWith(
      "/project",
      "memory.write",
      { now: 123 },
    )
    expect(mockRunMemoryOpsPatrol).not.toHaveBeenCalled()
  })

  it("can skip maintenance dirty tracking for preview-only events", async () => {
    await recordWikiAutomationEvent({
      type: "digest.preview",
      projectPath: "/project",
      maintenance: false,
    })

    expect(mockAppendAuditEvent).toHaveBeenCalledOnce()
    expect(mockRecordMaintenanceEvent).not.toHaveBeenCalled()
  })

  it("returns audit and maintenance errors without throwing", async () => {
    mockAppendAuditEvent.mockRejectedValueOnce(new Error("audit denied"))
    mockRecordMaintenanceEvent.mockRejectedValueOnce(new Error("store denied"))

    const result = await recordWikiAutomationEvent({
      type: "schema.scan",
      projectPath: "/project",
    })

    expect(result.auditError).toBe("audit denied")
    expect(result.maintenanceError).toBe("store denied")
    expect(result.auditEvent.action).toBe("schema.scan")
  })

  it("uses scan and digest default targets", () => {
    expect(buildWikiAutomationAuditEvent({
      type: "quality.scan",
      projectPath: "/project",
    }).targetPath).toBe(".llm-wiki/audit.jsonl")
    expect(buildWikiAutomationAuditEvent({
      type: "digest.save",
      projectPath: "/project",
    }).targetPath).toBe(".llm-wiki/crystallization")
  })
})

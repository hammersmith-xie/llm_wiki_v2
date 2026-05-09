import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuditEvent } from "./audit-timeline"
import {
  exportAuditEvents,
  formatAuditEventsCsv,
  formatAuditEventsJson,
} from "./audit-export"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  appendFile: vi.fn(async () => {}),
}))

vi.mock("@/lib/audit-timeline", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-timeline")>(
    "@/lib/audit-timeline",
  )
  return {
    ...actual,
    appendAuditEvent: vi.fn(async () => {}),
  }
})

import { createDirectory, writeFile } from "@/commands/fs"
import { appendAuditEvent } from "@/lib/audit-timeline"

const mockCreateDirectory = vi.mocked(createDirectory)
const mockWriteFile = vi.mocked(writeFile)
const mockAppendAuditEvent = vi.mocked(appendAuditEvent)

beforeEach(() => {
  mockCreateDirectory.mockReset()
  mockCreateDirectory.mockResolvedValue(undefined)
  mockWriteFile.mockReset()
  mockWriteFile.mockResolvedValue(undefined)
  mockAppendAuditEvent.mockReset()
  mockAppendAuditEvent.mockResolvedValue(undefined)
})

describe("audit export", () => {
  it("formats JSON exports as a stable array", () => {
    expect(formatAuditEventsJson([event({ action: "search.run" })])).toBe(
      `${JSON.stringify([event({ action: "search.run" })], null, 2)}\n`,
    )
  })

  it("formats CSV exports with escaped reasons", () => {
    const csv = formatAuditEventsCsv([
      event({
        action: "memory_ops.apply",
        category: "memory_ops",
        timestamp: "2026-05-09T00:00:00.000Z",
        targetPath: "wiki/a.md",
        changes: { status: "applied" },
        reasons: ["Mark stale page", "contains comma, and \"quote\""],
      }),
    ])

    expect(csv).toContain("timestamp,action,category,actor,status,scope,target,reasons")
    expect(csv).toContain(
      "2026-05-09T00:00:00.000Z,memory_ops.apply,memory_ops,,applied,,wiki/a.md,\"Mark stale page; contains comma, and \"\"quote\"\"\"",
    )
  })

  it("writes project-local exports and records an audit event", async () => {
    const result = await exportAuditEvents({
      projectPath: "/project/",
      events: [event({ action: "search.run" })],
      format: "json",
      now: new Date("2026-05-09T12:34:56.000Z"),
    })

    expect(result).toEqual({
      format: "json",
      path: "/project/.llm-wiki/exports/audit-2026-05-09T12-34-56-000Z.json",
      eventCount: 1,
    })
    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki/exports")
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/exports/audit-2026-05-09T12-34-56-000Z.json",
      expect.stringContaining("\"action\": \"search.run\""),
    )
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        action: "audit.export",
        targetPath: ".llm-wiki/exports",
        changes: { status: "applied" },
        after: expect.objectContaining({
          format: "json",
          eventCount: 1,
        }),
      }),
    )
  })
})

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    action: "query.answer",
    category: "query",
    ...overrides,
  }
}

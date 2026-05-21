import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  loadLatestMemoryOpsEvalReport,
  memoryOpsEvalLatestReportPath,
  saveMemoryOpsEvalReport,
} from "./memory-ops-eval-store"
import type { MemoryOpsEvalReport } from "./memory-ops-eval-types"

const files = new Map<string, string>()

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFile: vi.fn(async (path: string, contents: string) => {
    files.set(path, contents)
  }),
  readFile: vi.fn(async (path: string) => {
    const value = files.get(path)
    if (value === undefined) throw new Error("not found")
    return value
  }),
  appendFile: vi.fn(async () => {}),
}))

vi.mock("@/lib/audit-timeline", () => ({
  appendAuditEvent: vi.fn(async () => {}),
}))

const report: MemoryOpsEvalReport = {
  schemaVersion: 1,
  id: "eval_test",
  createdAt: "2026-05-21T00:00:00.000Z",
  projectPath: "/project",
  metrics: {
    caseCount: 1,
    passedCaseCount: 1,
    failedCaseCount: 0,
    expectedSuggestionCount: 1,
    actualSuggestionCount: 1,
    matchedSuggestionCount: 1,
    falsePositiveCount: 0,
    falseNegativeCount: 0,
    safePatchCount: 1,
    expectedCategoryCoverage: { lifecycle: 1 },
    actualCategoryCoverage: { lifecycle: 1 },
    precision: 1,
    recall: 1,
    f1: 1,
    totalDurationMs: 1,
  },
  cases: [],
}

describe("memory ops eval store", () => {
  beforeEach(() => {
    files.clear()
  })

  it("saves and loads latest report", async () => {
    const result = await saveMemoryOpsEvalReport("/project", report)
    expect(result.writeError).toBeUndefined()
    expect(files.has(memoryOpsEvalLatestReportPath("/project"))).toBe(true)

    await expect(loadLatestMemoryOpsEvalReport("/project")).resolves.toMatchObject({
      id: "eval_test",
    })
  })
})

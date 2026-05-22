import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  loadLatestMemoryOpsResearchReport,
  memoryOpsResearchLatestReportPath,
  saveMemoryOpsResearchReport,
} from "./memory-ops-research-store"
import type { MemoryOpsResearchEvidenceReport } from "./memory-ops-research-types"

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

const report: MemoryOpsResearchEvidenceReport = {
  schemaVersion: 1,
  id: "research_test",
  createdAt: "2026-05-21T00:00:00.000Z",
  projectPath: "/project",
  trigger: "manual",
  providers: ["local"],
  summary: {
    candidateCount: 1,
    evidenceCount: 1,
    providerCount: 1,
    warningCount: 0,
    uniqueSourceCount: 1,
    averageSourceDiversityScore: 1,
    verdictCounts: {
      supported: 1,
      contradicted: 0,
      mixed: 0,
      insufficient: 0,
      unavailable: 0,
    },
    quorumCounts: {
      met: 1,
      weak: 0,
      conflict: 0,
      unavailable: 0,
    },
  },
  results: [],
  warnings: [],
}

describe("memory ops research store", () => {
  beforeEach(() => {
    files.clear()
  })

  it("saves and loads latest report", async () => {
    const result = await saveMemoryOpsResearchReport("/project", report)
    expect(result.writeError).toBeUndefined()
    expect(files.has(memoryOpsResearchLatestReportPath("/project"))).toBe(true)

    await expect(loadLatestMemoryOpsResearchReport("/project")).resolves.toMatchObject({
      id: "research_test",
    })
  })
})

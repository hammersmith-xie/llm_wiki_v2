import { beforeEach, describe, expect, it, vi } from "vitest"
import { appendAuditEvent } from "@/lib/audit-timeline"
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

const mockAppendAuditEvent = vi.mocked(appendAuditEvent)

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
    mockAppendAuditEvent.mockClear()
  })

  it("saves and loads latest report", async () => {
    const result = await saveMemoryOpsResearchReport("/project", report)
    expect(result.writeError).toBeUndefined()
    expect(files.has(memoryOpsResearchLatestReportPath("/project"))).toBe(true)

    await expect(loadLatestMemoryOpsResearchReport("/project")).resolves.toMatchObject({
      id: "research_test",
    })
  })

  it("records source diversity in research audit reasons", async () => {
    await saveMemoryOpsResearchReport("/project", report)

    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        reasons: expect.arrayContaining([
          "1 unique source",
          "source diversity 1.00",
        ]),
      }),
    )
  })

  it("normalizes legacy reports without evidence matrices", async () => {
    const { summary: _summary, results: _results, ...base } = report
    files.set(
      memoryOpsResearchLatestReportPath("/project"),
      JSON.stringify({
        ...base,
        summary: {
          candidateCount: 1,
          evidenceCount: 2,
          providerCount: 2,
          warningCount: 0,
          verdictCounts: report.summary.verdictCounts,
        },
        results: [{
          candidate: {
            id: "candidate",
            kind: "suggestion",
            targetPath: "wiki/a.md",
            title: "Candidate",
            query: "candidate",
            summary: "candidate",
            reasons: [],
          },
          verdict: "supported",
          confidence: 0.9,
          evidence: [],
          providerResults: [
            {
              provider: "local",
              status: "ok",
              evidence: [{
                id: "local-1",
                provider: "local",
                stance: "support",
                title: "Local",
                path: "wiki/a.md",
                snippet: "local support",
              }],
              warnings: [],
              durationMs: 1,
            },
            {
              provider: "web-search",
              status: "ok",
              evidence: [{
                id: "web-1",
                provider: "web-search",
                stance: "support",
                title: "Web",
                url: "https://example.com/a",
                snippet: "web support",
              }],
              warnings: [],
              durationMs: 1,
            },
          ],
          warnings: [],
        }],
        warnings: [],
      }),
    )

    const loaded = await loadLatestMemoryOpsResearchReport("/project")
    expect(loaded?.summary.uniqueSourceCount).toBe(2)
    expect(loaded?.summary.averageSourceDiversityScore).toBe(1)
    expect(loaded?.summary.quorumCounts.met).toBe(1)
    expect(loaded?.results[0]?.evidenceMatrix).toMatchObject({
      quorumStatus: "met",
      independentEvidenceCount: 2,
      uniqueSourceCount: 2,
      sourceDiversityScore: 1,
    })
  })

  it("normalizes legacy reports that only persisted top-level evidence", async () => {
    const { summary: _summary, results: _results, ...base } = report
    files.set(
      memoryOpsResearchLatestReportPath("/project"),
      JSON.stringify({
        ...base,
        summary: {
          candidateCount: 1,
          evidenceCount: 1,
          providerCount: 1,
          warningCount: 0,
          verdictCounts: report.summary.verdictCounts,
        },
        results: [{
          candidate: {
            id: "candidate",
            kind: "suggestion",
            targetPath: "wiki/a.md",
            title: "Candidate",
            query: "candidate",
            summary: "candidate",
            reasons: [],
          },
          verdict: "supported",
          confidence: 0.9,
          evidence: [{
            id: "legacy-web",
            provider: "web-search",
            stance: "support",
            title: "Legacy Web",
            url: "https://example.com/a",
            snippet: "legacy web support",
          }],
          warnings: [],
        }],
        warnings: [],
      }),
    )

    const loaded = await loadLatestMemoryOpsResearchReport("/project")
    expect(loaded?.summary.uniqueSourceCount).toBe(1)
    expect(loaded?.summary.quorumCounts.weak).toBe(1)
    expect(loaded?.results[0]?.providerResults[0]).toMatchObject({
      provider: "web-search",
      status: "ok",
    })
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { runSearchHealth, searchHealthReportPath } from "./search-health"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  appendFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  listDirectory: vi.fn(async () => []),
}))

vi.mock("@/lib/search-eval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/search-eval")>()
  return {
    ...actual,
    runSearchWikiEval: vi.fn(),
  }
})

import { appendFile, writeFile } from "@/commands/fs"
import { runSearchWikiEval } from "@/lib/search-eval"

const mockAppendFile = vi.mocked(appendFile)
const mockWriteFile = vi.mocked(writeFile)
const mockRunSearchWikiEval = vi.mocked(runSearchWikiEval)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockWriteFile.mockReset()
  mockRunSearchWikiEval.mockReset()
})

describe("search health", () => {
  it("skips cleanly when no scenarios are available", async () => {
    const result = await runSearchHealth("/project", [])

    expect(result).toMatchObject({
      status: "skipped",
      scenarioCount: 0,
    })
    expect(mockRunSearchWikiEval).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockAppendFile).toHaveBeenCalledTimes(1)
    const audit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(audit).toMatchObject({
      action: "memory_ops.search_health",
      changes: { status: "skipped" },
      after: {
        status: "skipped",
        scenarioCount: 0,
      },
      reasons: ["no search health scenarios available"],
    })
  })

  it("runs search eval, writes a report artifact, and records a pass audit", async () => {
    mockRunSearchWikiEval.mockResolvedValueOnce({
      summary: {
        scenarioCount: 1,
        passedCount: 1,
        failedCount: 0,
      },
      results: [
        {
          id: "title-exact",
          query: "Attention",
          topK: 3,
          passed: true,
          rankedPaths: ["wiki/concepts/attention.md"],
          topResults: [
            {
              rank: 1,
              path: "wiki/concepts/attention.md",
              title: "Attention",
              score: 1,
              streams: [{ name: "bm25", rank: 1, contribution: 0.01 }],
            },
          ],
          failures: [],
        },
      ],
    })

    const result = await runSearchHealth("/project", [
      { id: "title-exact", query: "Attention", expectedTopPaths: ["wiki/concepts/attention.md"] },
    ])

    expect(result.status).toBe("pass")
    expect(result.writtenPath).toBe("/project/.llm-wiki/search-eval-report.json")
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/search-eval-report.json",
      expect.stringContaining("\"scenarioCount\": 1"),
    )
    const audit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(audit).toMatchObject({
      action: "memory_ops.search_health",
      changes: { status: "pass" },
      after: {
        status: "pass",
        scenarioCount: 1,
        writtenPath: "/project/.llm-wiki/search-eval-report.json",
        summary: {
          scenarioCount: 1,
          passedCount: 1,
          failedCount: 0,
          streamCounts: { bm25: 1 },
        },
      },
      reasons: ["1/1 scenarios passed"],
    })
  })

  it("keeps a run summary when report artifact writing fails", async () => {
    mockRunSearchWikiEval.mockResolvedValueOnce({
      summary: {
        scenarioCount: 1,
        passedCount: 0,
        failedCount: 1,
      },
      results: [
        {
          id: "missing",
          query: "Missing",
          topK: 3,
          passed: false,
          rankedPaths: [],
          topResults: [],
          failures: [
            {
              kind: "missing-from-top-k",
              query: "Missing",
              expectedPath: "wiki/concepts/missing.md",
              expectedTopK: 3,
              topKPaths: [],
              message: "missing expected path",
            },
          ],
        },
      ],
    })
    mockWriteFile.mockRejectedValueOnce(new Error("disk full"))

    const result = await runSearchHealth("/project", [
      { id: "missing", query: "Missing", expectedInTopK: [{ path: "wiki/concepts/missing.md", topK: 3 }] },
    ])

    expect(result).toMatchObject({
      status: "fail",
      writeError: "disk full",
      summary: {
        failedCount: 1,
      },
    })
    const audit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(audit).toMatchObject({
      action: "memory_ops.search_health",
      changes: { status: "fail" },
      after: {
        status: "fail",
        writeError: "disk full",
        summary: {
          failedScenarios: [
            {
              id: "missing",
              query: "Missing",
              topKPaths: [],
              failures: [
                {
                  kind: "missing-from-top-k",
                  expectedPath: "wiki/concepts/missing.md",
                },
              ],
            },
          ],
        },
      },
    })
  })

  it("computes the report artifact path", () => {
    expect(searchHealthReportPath("/project/")).toBe("/project/.llm-wiki/search-eval-report.json")
  })
})

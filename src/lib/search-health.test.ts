import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildBuiltInSearchHealthScenarios,
  combineSearchHealthScenarios,
  runSearchHealth,
  searchHealthReportPath,
} from "./search-health"

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
import { listDirectory, readFile } from "@/commands/fs"
import { runSearchWikiEval } from "@/lib/search-eval"
import type { FileNode } from "@/types/wiki"

const mockAppendFile = vi.mocked(appendFile)
const mockWriteFile = vi.mocked(writeFile)
const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockRunSearchWikiEval = vi.mocked(runSearchWikiEval)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockWriteFile.mockReset()
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockRunSearchWikiEval.mockReset()
})

describe("search health", () => {
  it("skips cleanly when no scenarios are available", async () => {
    const result = await runSearchHealth("/project", [], {
      skippedScenarios: [{ id: "builtin-title-exact", reason: "No titled wiki page found." }],
    })

    expect(result).toMatchObject({
      status: "skipped",
      scenarioCount: 0,
      skippedScenarios: [{ id: "builtin-title-exact", reason: "No titled wiki page found." }],
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
        skippedScenarios: [{ id: "builtin-title-exact", reason: "No titled wiki page found." }],
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

  it("combines built-in and custom scenarios and records source counts in audit", async () => {
    mockRunSearchWikiEval.mockResolvedValueOnce({
      summary: {
        scenarioCount: 2,
        passedCount: 2,
        failedCount: 0,
      },
      results: [
        {
          id: "builtin-title-exact",
          query: "Attention",
          topK: 3,
          passed: true,
          rankedPaths: ["wiki/concepts/attention.md"],
          topResults: [],
          failures: [],
        },
        {
          id: "custom-critical",
          query: "critical query",
          topK: 3,
          passed: true,
          rankedPaths: ["wiki/concepts/critical.md"],
          topResults: [],
          failures: [],
        },
      ],
    })

    const combined = combineSearchHealthScenarios({
      builtInScenarios: [
        {
          id: "builtin-title-exact",
          query: "Attention",
          expectedInTopK: [{ path: "wiki/concepts/attention.md", topK: 3 }],
        },
      ],
      customScenarios: [
        {
          id: "custom-critical",
          query: "critical query",
          expectedInTopK: [{ path: "wiki/concepts/critical.md", topK: 3 }],
        },
      ],
      skippedScenarios: [{ id: "custom-bad", reason: "Missing query." }],
    })

    const result = await runSearchHealth("/project", combined.scenarios, {
      skippedScenarios: combined.skipped,
      sourceCounts: combined.sourceCounts,
    })

    expect(result.sourceCounts).toEqual({
      builtInScenarioCount: 1,
      customScenarioCount: 1,
      skippedScenarioCount: 1,
    })
    expect(mockRunSearchWikiEval.mock.calls[0][1].map((scenario) => scenario.id)).toEqual([
      "builtin-title-exact",
      "custom-critical",
    ])
    const audit = JSON.parse(String(mockAppendFile.mock.calls[0][1]))
    expect(audit.after.sourceCounts).toEqual({
      builtInScenarioCount: 1,
      customScenarioCount: 1,
      skippedScenarioCount: 1,
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

  it("builds smoke scenarios from available project pages and skips missing categories", async () => {
    const tree: FileNode[] = [
      {
        name: "concepts",
        path: "/project/wiki/concepts",
        is_dir: true,
        children: [
          { name: "attention.md", path: "/project/wiki/concepts/attention.md", is_dir: false },
          { name: "agent.md", path: "/project/wiki/concepts/agent.md", is_dir: false },
          { name: "旧知识.md", path: "/project/wiki/concepts/旧知识.md", is_dir: false },
        ],
      },
    ]
    mockListDirectory.mockResolvedValueOnce(tree)
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/concepts/attention.md") {
        return [
          "---",
          "title: Attention",
          "aliases: [self attention]",
          "---",
          "",
          "# Attention",
        ].join("\n")
      }
      if (path === "/project/wiki/concepts/agent.md") {
        return [
          "---",
          "title: Agent",
          "uses: [tool-calling]",
          "---",
          "",
          "# Agent",
        ].join("\n")
      }
      if (path === "/project/wiki/concepts/旧知识.md") {
        return [
          "---",
          "title: 旧知识",
          "superseded_by: [new-knowledge]",
          "---",
          "",
          "# 旧知识",
        ].join("\n")
      }
      throw new Error(`unexpected path ${path}`)
    })

    const result = await buildBuiltInSearchHealthScenarios("/project")

    expect(result.scenarios).toEqual(expect.arrayContaining([
      {
        id: "builtin-title-exact",
        query: "Attention",
        expectedInTopK: [{ path: "wiki/concepts/attention.md", topK: 3 }],
      },
      {
        id: "builtin-alias-keyword",
        query: "self attention",
        expectedInTopK: [{ path: "wiki/concepts/attention.md", topK: 5 }],
      },
      {
        id: "builtin-typed-graph",
        query: "tool-calling",
        expectedInTopK: [{ path: "wiki/concepts/agent.md", topK: 10 }],
      },
      {
        id: "builtin-cjk",
        query: "旧知识",
        expectedInTopK: [{ path: "wiki/concepts/旧知识.md", topK: 5 }],
      },
      {
        id: "builtin-contradiction-deprioritize",
        query: "旧知识",
        expectedOutsideTopK: [{ path: "wiki/concepts/旧知识.md", topK: 1 }],
        topK: 5,
      },
    ]))
    expect(result.skipped).toEqual([])
  })

  it("skips smoke scenarios when project content is insufficient", async () => {
    mockListDirectory.mockResolvedValueOnce([
      { name: "empty.md", path: "/project/wiki/empty.md", is_dir: false },
    ])
    mockReadFile.mockResolvedValueOnce("---\n---\n\n")

    const result = await buildBuiltInSearchHealthScenarios("/project")

    expect(result.scenarios).toEqual([
      {
        id: "builtin-title-exact",
        query: "empty",
        expectedInTopK: [{ path: "wiki/empty.md", topK: 3 }],
      },
    ])
    expect(result.skipped.map((item) => item.id)).toEqual([
      "builtin-alias-keyword",
      "builtin-cjk",
      "builtin-typed-graph",
      "builtin-contradiction-deprioritize",
    ])
  })
})

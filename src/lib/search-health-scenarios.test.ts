import { describe, expect, it } from "vitest"
import { beforeEach, vi } from "vitest"
import {
  loadSearchHealthScenarioConfig,
  normalizeSearchHealthScenarioConfig,
  saveSearchHealthScenarioConfig,
  searchHealthScenarioConfigPath,
} from "./search-health-scenarios"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => {}),
}))

import { createDirectory, readFile, writeFile } from "@/commands/fs"

const mockCreateDirectory = vi.mocked(createDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockCreateDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
})

describe("search health custom scenarios", () => {
  it("normalizes supported custom scenario fields", () => {
    const result = normalizeSearchHealthScenarioConfig({
      projectPath: "/project",
      scenarios: [
        {
          id: " Critical Query ",
          query: "hybrid search",
          expectedTopPaths: [" /project/wiki/concepts/search.md "],
          expectedInTopK: [{ path: "wiki/concepts/hybrid.md", topK: "3" }],
          expectedOutsideTopK: [{ path: "wiki/archive/old.md", topK: 1 }],
          excludedPaths: ["wiki/private/draft.md"],
          topK: "7",
        },
      ],
    })

    expect(result.scenarios).toEqual([
      {
        id: "critical-query",
        query: "hybrid search",
        expectedTopPaths: ["wiki/concepts/search.md"],
        expectedInTopK: [{ path: "wiki/concepts/hybrid.md", topK: 3 }],
        expectedOutsideTopK: [{ path: "wiki/archive/old.md", topK: 1 }],
        excludedPaths: ["wiki/private/draft.md"],
        topK: 7,
      },
    ])
    expect(result.skipped).toEqual([])
  })

  it("skips invalid and duplicate scenarios without throwing", () => {
    const result = normalizeSearchHealthScenarioConfig({
      projectPath: "/project",
      scenarios: [
        { id: "missing-query", expectedTopPaths: ["wiki/a.md"] },
        { id: "no-expectations", query: "alpha" },
        { id: "dup", query: "first", expectedInTopK: [{ path: "wiki/a.md", topK: 2 }] },
        { id: "dup", query: "second", expectedInTopK: [{ path: "wiki/b.md", topK: 2 }] },
        { id: "bad-topk", query: "beta", expectedInTopK: [{ path: "wiki/b.md", topK: -1 }] },
        { id: "outside", query: "escape", expectedTopPaths: ["../outside.md"] },
        { id: "absolute-outside", query: "escape", expectedTopPaths: ["/other/wiki/a.md"] },
        { id: "unc", query: "escape", expectedTopPaths: ["//server/share/wiki/a.md"] },
      ],
    })

    expect(result.scenarios).toEqual([
      {
        id: "dup",
        query: "first",
        expectedInTopK: [{ path: "wiki/a.md", topK: 2 }],
      },
    ])
    expect(result.skipped.map((item) => item.id)).toEqual([
      "missing-query",
      "no-expectations",
      "dup",
      "bad-topk",
      "outside",
      "absolute-outside",
      "unc",
    ])
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("missing-query"),
      expect.stringContaining("duplicate"),
      expect.stringContaining("bad-topk"),
      expect.stringContaining("outside"),
      expect.stringContaining("absolute-outside"),
      expect.stringContaining("unc"),
    ]))
  })

  it("returns empty scenarios and a warning for malformed config roots", () => {
    const result = normalizeSearchHealthScenarioConfig({ scenarios: "not-array" })

    expect(result.scenarios).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.warnings).toEqual(["Custom search health scenarios must be an array."])
  })

  it("loads missing custom scenario config as an empty result", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("missing"))

    const result = await loadSearchHealthScenarioConfig("/project")

    expect(result).toMatchObject({
      path: "/project/.llm-wiki/search-health-scenarios.json",
      scenarios: [],
      skipped: [],
      warnings: [],
    })
  })

  it("loads and normalizes custom scenario config from disk", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      scenarios: [
        {
          id: "critical",
          query: "hybrid search",
          expectedInTopK: [{ path: "wiki/search.md", topK: 2 }],
        },
      ],
    }))

    const result = await loadSearchHealthScenarioConfig("/project/")

    expect(result.scenarios).toEqual([
      {
        id: "critical",
        query: "hybrid search",
        expectedInTopK: [{ path: "wiki/search.md", topK: 2 }],
      },
    ])
    expect(mockReadFile).toHaveBeenCalledWith("/project/.llm-wiki/search-health-scenarios.json")
  })

  it("returns a warning for malformed custom scenario JSON", async () => {
    mockReadFile.mockResolvedValueOnce("{bad")

    const result = await loadSearchHealthScenarioConfig("/project")

    expect(result.scenarios).toEqual([])
    expect(result.warnings[0]).toContain("Could not parse custom search health scenarios")
  })

  it("saves custom scenario config as pretty JSON", async () => {
    await saveSearchHealthScenarioConfig("/project/", [{
      id: "critical",
      query: "hybrid search",
      expectedInTopK: [{ path: "wiki/search.md", topK: 2 }],
    }])

    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/search-health-scenarios.json",
      expect.stringContaining("\n  \"scenarios\": ["),
    )
  })

  it("computes the custom scenario config path", () => {
    expect(searchHealthScenarioConfigPath("/project/")).toBe(
      "/project/.llm-wiki/search-health-scenarios.json",
    )
  })
})

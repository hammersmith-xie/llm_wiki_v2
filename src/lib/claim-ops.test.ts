import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeClaimRecord } from "./claims"
import {
  applyClaimIndexRebuild,
  scanClaimIndexRebuild,
} from "./claim-ops"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
}))

import { appendFile, createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"

const mockAppendFile = vi.mocked(appendFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockCreateDirectory.mockReset()
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
})

describe("claim index scan and rebuild", () => {
  it("dry-runs rebuild without writing claim index", async () => {
    mockListDirectory.mockImplementation(async (path) => {
      if (path.includes("/raw/")) throw new Error("must not read raw sources")
      if (path === "/project/wiki") {
        return [{
          name: "search.md",
          path: "/project/wiki/concepts/search.md",
          is_dir: false,
        }]
      }
      throw new Error(`unexpected listDirectory ${path}`)
    })
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/concepts/search.md") {
        return [
          "# Search",
          "",
          "<!-- claim:claim_anchor1 -->",
          "Conclusion: hybrid search keeps evidence explainable.",
        ].join("\n")
      }
      if (path === "/project/.llm-wiki/claims.jsonl") return ""
      throw new Error(`unexpected readFile ${path}`)
    })

    const result = await scanClaimIndexRebuild("/project")

    expect(result.dryRun).toBe(true)
    expect(result.stats).toMatchObject({
      recoveredCount: 1,
      backfilledCount: 1,
      orphanCount: 0,
      staleCount: 0,
    })
    expect(result.recovered[0]).toMatchObject({
      page_path: "wiki/concepts/search.md",
      claim_id: "claim_anchor1",
    })
    expect(result.backfilled[0]).toMatchObject({
      page_path: "wiki/concepts/search.md",
      page_title: "Search",
      source_refs: [],
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it("backfills high-value legacy markdown claims with page sources", async () => {
    mockListDirectory.mockResolvedValue([{
      name: "retrieval.md",
      path: "/project/wiki/concepts/retrieval.md",
      is_dir: false,
    }])
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/concepts/retrieval.md") {
        return [
          "---",
          "title: Retrieval",
          "lifecycle: semantic",
          "sources: [raw/sources/search.md]",
          "---",
          "",
          "# Retrieval",
          "",
          "- Finding: hybrid search keeps BM25, vector, and graph evidence separately auditable.",
          "- Recommendation: keep graph expansion query-time so page writes stay cheap.",
        ].join("\n")
      }
      if (path === "/project/.llm-wiki/claims.jsonl") return ""
      throw new Error(`unexpected readFile ${path}`)
    })

    const result = await scanClaimIndexRebuild("/project")

    expect(result.stats).toMatchObject({
      recoveredCount: 0,
      backfilledCount: 2,
    })
    expect(result.backfilled.map((claim) => claim.text)).toEqual([
      "Finding: hybrid search keeps BM25, vector, and graph evidence separately auditable.",
      "Recommendation: keep graph expansion query-time so page writes stay cheap.",
    ])
    expect(result.backfilled[0]).toMatchObject({
      page_path: "wiki/concepts/retrieval.md",
      page_title: "Retrieval",
      lifecycle: "semantic",
      source_refs: [{ path: "raw/sources/search.md" }],
    })
  })

  it("reports orphan and stale records while preserving bad-line warnings", async () => {
    const orphan = normalizeClaimRecord({
      text: "Deleted claim.",
      page_path: "wiki/concepts/deleted.md",
      status: "ok",
    }, { today: "2026-05-08" }).claim
    const stale = normalizeClaimRecord({
      text: "Old claim.",
      page_path: "wiki/concepts/search.md",
      status: "stale",
    }, { today: "2026-05-08" }).claim
    mockListDirectory.mockResolvedValue([{
      name: "search.md",
      path: "/project/wiki/concepts/search.md",
      is_dir: false,
    }])
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/concepts/search.md") return "# Search\n"
      if (path === "/project/.llm-wiki/claims.jsonl") {
        return `${JSON.stringify(orphan)}\n${JSON.stringify(stale)}\n{bad\n`
      }
      throw new Error(`unexpected readFile ${path}`)
    })

    const result = await scanClaimIndexRebuild("/project")

    expect(result.stats).toMatchObject({
      recoveredCount: 0,
      backfilledCount: 0,
      orphanCount: 1,
      staleCount: 1,
      warningCount: 1,
    })
    expect(result.orphanClaims[0]?.claim_id).toBe(orphan.claim_id)
  })

  it("applies rebuild and writes an audit event", async () => {
    mockListDirectory.mockResolvedValue([{
      name: "search.md",
      path: "/project/wiki/concepts/search.md",
      is_dir: false,
    }])
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/wiki/concepts/search.md") {
        return "<!-- claim:claim_anchor1 -->\nFinding: graph search helps alias recall."
      }
      if (path === "/project/.llm-wiki/claims.jsonl") return ""
      throw new Error(`unexpected readFile ${path}`)
    })

    const result = await applyClaimIndexRebuild("/project")

    expect(result.dryRun).toBe(false)
    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockCreateDirectory.mock.invocationCallOrder[0]).toBeLessThan(
      mockWriteFile.mock.invocationCallOrder[0],
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/claims.jsonl",
      expect.stringContaining("\"claim_id\":\"claim_anchor1\""),
    )
    expect(String(mockWriteFile.mock.calls[0]?.[1])).toContain("\"Finding: graph search helps alias recall.\"")
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"claim.rebuild\""),
    )
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"backfilledCount\":1"),
    )
  })
})

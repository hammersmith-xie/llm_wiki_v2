import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeClaimRecord } from "./claims"
import {
  applyClaimProvenanceRepair,
  planClaimProvenanceRepair,
} from "./claim-provenance-repair"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
}))

import { appendFile, createDirectory, readFile, writeFile } from "@/commands/fs"

const mockAppendFile = vi.mocked(appendFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockCreateDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
})

describe("claim provenance repair", () => {
  it("plans repairable, complete, no-source, unreadable, and unmatched claims", async () => {
    const repairable = claim({
      text: "Finding: hybrid search keeps BM25, vector, and graph evidence separately auditable.",
      source_refs: [{ path: "raw/sources/search.md" }],
    })
    const complete = claim({
      text: "Complete claim.",
      source_refs: [{
        path: "raw/sources/complete.md",
        snippet_hash: "snippet_done",
      }],
    })
    const noSource = claim({
      text: "No source claim.",
      source_refs: [],
    })
    const unreadable = claim({
      text: "Unreadable claim.",
      source_refs: [{ path: "raw/sources/missing.md" }],
    })
    const unmatched = claim({
      text: "Conclusion: unrelated content should not receive a hash.",
      source_refs: [{ path: "raw/sources/unmatched.md" }],
    })

    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/.llm-wiki/claims.jsonl") {
        return [
          repairable,
          complete,
          noSource,
          unreadable,
          unmatched,
        ].map((item) => JSON.stringify(item)).join("\n")
      }
      if (path === "/project/raw/sources/search.md") {
        return "Hybrid search keeps BM25, vector, and graph evidence separately auditable."
      }
      if (path === "/project/raw/sources/unmatched.md") {
        return "This source is about a different topic."
      }
      throw new Error(`missing ${path}`)
    })

    const plan = await planClaimProvenanceRepair("/project")

    expect(plan.dryRun).toBe(true)
    expect(plan.stats).toMatchObject({
      claimCount: 5,
      repairableCount: 1,
      repairedSourceRefCount: 1,
      alreadyCompleteCount: 1,
      noSourceRefsCount: 1,
      sourceUnreadableCount: 1,
      noMatchCount: 1,
    })
    expect(plan.items.map((item) => item.status)).toEqual([
      "repairable",
      "already-complete",
      "no-source-refs",
      "source-unreadable",
      "no-match",
    ])
    expect(plan.items[0].after[0]).toMatchObject({
      path: "raw/sources/search.md",
      anchor: expect.stringMatching(/^snippet:/),
      snippet_hash: expect.stringMatching(/^snippet_/),
    })
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it("applies repairs by rewriting the claim index and appending an audit event", async () => {
    const repairable = claim({
      text: "Finding: graph traversal helps alias-only questions.",
      source_refs: [{ path: "raw/sources/graph.md" }],
    })
    const complete = claim({
      text: "Complete claim.",
      source_refs: [{
        path: "raw/sources/complete.md",
        snippet_hash: "snippet_done",
      }],
    })
    mockReadFile.mockImplementation(async (path) => {
      if (path === "/project/.llm-wiki/claims.jsonl") {
        return `${JSON.stringify(repairable)}\n${JSON.stringify(complete)}\n`
      }
      if (path === "/project/raw/sources/graph.md") {
        return "Graph traversal helps alias-only questions by expanding typed relations."
      }
      throw new Error(`missing ${path}`)
    })

    const result = await applyClaimProvenanceRepair("/project")

    expect(result.dryRun).toBe(false)
    expect(result.stats).toMatchObject({
      claimCount: 2,
      repairableCount: 1,
      alreadyCompleteCount: 1,
    })
    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/claims.jsonl",
      expect.stringContaining("\"snippet_hash\":\"snippet_"),
    )
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/audit.jsonl",
      expect.stringContaining("\"action\":\"claim.provenance.repair\""),
    )
    expect(mockAppendFile.mock.calls[0][1]).not.toContain("Graph traversal helps")
  })
})

function claim(
  overrides: Parameters<typeof normalizeClaimRecord>[0],
) {
  return normalizeClaimRecord({
    page_path: "wiki/concepts/search.md",
    text: "Fallback claim.",
    ...overrides,
  }, { today: "2026-05-09" }).claim
}

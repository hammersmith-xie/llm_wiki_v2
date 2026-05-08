import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CLAIM_LIFECYCLES,
  CLAIM_SCOPES,
  CLAIM_STATUSES,
  appendClaimRecords,
  claimIndexPath,
  claimRecordAuditSummary,
  createClaimId,
  mergeClaimRecords,
  normalizeClaimRecord,
  readClaimIndex,
} from "./claims"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
}))

import { appendFile, createDirectory, readFile } from "@/commands/fs"

const mockAppendFile = vi.mocked(appendFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  mockAppendFile.mockClear()
  mockCreateDirectory.mockClear()
  mockReadFile.mockReset()
  mockReadFile.mockResolvedValue("")
})

describe("claim record contract", () => {
  it("creates stable claim ids from page path, anchor, and text", () => {
    const first = createClaimId({
      pagePath: "wiki/concepts/Search.md",
      pageAnchor: "Finding",
      text: "Graph traversal improves recall for alias-only questions.",
    })
    const second = createClaimId({
      pagePath: "wiki\\concepts\\Search.md",
      pageAnchor: " finding ",
      text: "Graph traversal improves recall for alias-only questions.",
    })
    const differentAnchor = createClaimId({
      pagePath: "wiki/concepts/Search.md",
      pageAnchor: "Decision",
      text: "Graph traversal improves recall for alias-only questions.",
    })

    expect(first).toMatch(/^claim_[a-z0-9]+$/)
    expect(second).toBe(first)
    expect(differentAnchor).not.toBe(first)
  })

  it("normalizes invalid enum values while preserving a usable record", () => {
    const result = normalizeClaimRecord({
      claim_id: "",
      text: "  A high-value finding.  ",
      page_path: "wiki\\queries\\digest.md",
      lifecycle: "durable",
      status: "unknown",
      scope: "team",
      confidence: "1.7",
      confidence_reasons: ["source support", "source support", ""],
      source_refs: [
        { path: "raw\\sources\\paper.pdf", title: "Paper" },
        { path: "", title: "Missing" },
      ],
      supports: ["search", "search", ""],
      contradicts: ["old-claim"],
      supersedes: ["prior-claim"],
      superseded_by: ["future-claim"],
      reinforcement_count: "3.9",
      created_at: "",
      updated_at: "",
    }, { today: "2026-05-08" })

    expect(result.claim).toMatchObject({
      text: "A high-value finding.",
      page_path: "wiki/queries/digest.md",
      lifecycle: "working",
      status: "needs-review",
      scope: "shared",
      confidence: "1.00",
      confidence_reasons: ["source support"],
      source_refs: [{ path: "raw/sources/paper.pdf", title: "Paper" }],
      supports: ["search"],
      contradicts: ["old-claim"],
      supersedes: ["prior-claim"],
      superseded_by: ["future-claim"],
      reinforcement_count: "3",
      created_at: "2026-05-08",
      updated_at: "2026-05-08",
      last_confirmed: "2026-05-08",
    })
    expect(result.claim.claim_id).toMatch(/^claim_[a-z0-9]+$/)
    expect(result.warnings).toEqual(expect.arrayContaining([
      "claim_id missing or invalid; generated a stable claim id.",
      "lifecycle must be one of working, episodic, semantic, procedural, archived; using working.",
      "status must be one of ok, needs-review, stale, contradicted, superseded; using needs-review.",
      "scope must be private or shared; using shared.",
      "source_refs item requires a non-empty path; item skipped.",
    ]))
  })

  it("keeps enum value lists stable for schema and UI consumers", () => {
    expect(CLAIM_LIFECYCLES).toEqual([
      "working",
      "episodic",
      "semantic",
      "procedural",
      "archived",
    ])
    expect(CLAIM_STATUSES).toEqual([
      "ok",
      "needs-review",
      "stale",
      "contradicted",
      "superseded",
    ])
    expect(CLAIM_SCOPES).toEqual(["private", "shared"])
  })

  it("generates deterministic ids for CJK text", () => {
    const a = createClaimId({
      pagePath: "wiki/synthesis/检索.md",
      pageAnchor: "结论",
      text: "图谱检索可以补足关键词检索的召回盲区。",
    })
    const b = createClaimId({
      pagePath: "wiki/synthesis/检索.md",
      pageAnchor: "结论",
      text: "图谱检索可以补足关键词检索的召回盲区。",
    })

    expect(a).toBe(b)
    expect(a.length).toBeGreaterThan("claim_".length)
  })
})

describe("claim index jsonl", () => {
  it("resolves the project-local claim index path", () => {
    expect(claimIndexPath("/project\\demo")).toBe("/project/demo/.llm-wiki/claims.jsonl")
  })

  it("reads valid claim lines and keeps bad lines as warnings", async () => {
    const valid = normalizeClaimRecord({
      text: "Hybrid retrieval should expose each stream separately.",
      page_path: "wiki/concepts/search.md",
      confidence: "0.8",
      source_refs: [{ path: "raw/sources/search.md" }],
    }, { today: "2026-05-08" }).claim
    mockReadFile.mockResolvedValueOnce([
      JSON.stringify(valid),
      "{bad",
      JSON.stringify({ text: "", page_path: "" }),
    ].join("\n"))

    const result = await readClaimIndex("/project")

    expect(result.claims).toHaveLength(1)
    expect(result.claims[0]?.text).toBe("Hybrid retrieval should expose each stream separately.")
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 2, message: expect.stringContaining("Invalid claim JSON") }),
      expect.objectContaining({ line: 3, message: "Invalid claim JSON: expected non-empty text and page_path." }),
    ]))
  })

  it("redacts sensitive text from claim index warning raw lines", async () => {
    mockReadFile.mockResolvedValueOnce([
      "{\"text\":\"<private>customer alice@example.com</private>\",\"page_path\":\"\"}",
      "not json token=sk-proj-private-secret",
    ].join("\n"))

    const result = await readClaimIndex("/project")
    const serialized = JSON.stringify(result.warnings)

    expect(result.claims).toEqual([])
    expect(serialized).not.toContain("customer alice@example.com")
    expect(serialized).not.toContain("sk-proj-private-secret")
    expect(serialized).toContain("[REDACTED:private]")
    expect(serialized).toContain("[REDACTED:secret]")
  })

  it("returns an empty index when the claim file does not exist", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("missing"))

    const result = await readClaimIndex("/project")

    expect(result).toEqual({ claims: [], warnings: [] })
  })

  it("appends normalized claim records to jsonl", async () => {
    const result = await appendClaimRecords("/project", [{
      text: "Graph evidence should remain explainable.",
      page_path: "wiki/concepts/graph.md",
      confidence: "0.7",
    }], { today: "2026-05-08" })

    expect(result.writtenCount).toBe(1)
    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/claims.jsonl",
      expect.stringContaining("\"text\":\"Graph evidence should remain explainable.\""),
    )
  })

  it("merges records by claim id without duplicating relation arrays", () => {
    const existing = normalizeClaimRecord({
      claim_id: "claim_existing",
      text: "A claim",
      page_path: "wiki/a.md",
      supports: ["old", "shared"],
    }, { today: "2026-05-08" }).claim
    const incoming = normalizeClaimRecord({
      claim_id: "claim_existing",
      text: "A claim, revised",
      page_path: "wiki/a.md",
      supports: ["shared", "new"],
      contradicts: ["risk"],
    }, { today: "2026-05-08" }).claim

    const merged = mergeClaimRecords([existing], [incoming])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      text: "A claim, revised",
      supports: ["old", "shared", "new"],
      contradicts: ["risk"],
    })
  })

  it("redacts private claim text and snippets from audit summaries", () => {
    const claim = normalizeClaimRecord({
      text: "Private customer detail should not leak.",
      page_path: "wiki/private/customer.md",
      scope: "private",
      source_refs: [{
        path: "raw/sources/customer.md",
        snippet_hash: "hash-only",
      }],
    }, { today: "2026-05-08" }).claim

    const summary = claimRecordAuditSummary(claim)
    const json = JSON.stringify(summary)

    expect(summary).toMatchObject({
      claim_id: claim.claim_id,
      page_path: "wiki/private/customer.md",
      scope: "private",
      redacted: true,
    })
    expect(json).not.toContain("Private customer detail")
    expect(json).not.toContain("hash-only")
  })
})

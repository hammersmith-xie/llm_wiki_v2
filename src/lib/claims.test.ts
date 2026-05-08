import { describe, expect, it } from "vitest"
import {
  CLAIM_LIFECYCLES,
  CLAIM_SCOPES,
  CLAIM_STATUSES,
  createClaimId,
  normalizeClaimRecord,
} from "./claims"

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

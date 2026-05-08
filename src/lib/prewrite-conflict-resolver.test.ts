import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeClaimRecord } from "./claims"
import { buildPreWriteCandidate } from "./prewrite-conflict"
import { resolvePreWriteClaimEvidence } from "./prewrite-conflict-resolver"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
}))

import { readFile } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  mockReadFile.mockReset()
})

describe("pre-write claim evidence resolver", () => {
  it("returns reinforcement evidence for active similar claims", async () => {
    const claim = normalizeClaimRecord({
      text: "Hybrid search improves recall by combining BM25 and graph context.",
      page_path: "wiki/concepts/search.md",
      status: "ok",
      confidence: "0.9",
    }, { today: "2026-05-08" }).claim
    mockReadFile.mockResolvedValue(`${JSON.stringify(claim)}\n`)

    const candidate = buildPreWriteCandidate({
      kind: "ingest-page",
      targetPath: "wiki/concepts/search.md",
      content: "# Hybrid Search",
      claimSummaries: [{
        text: "Hybrid search improves recall by combining BM25 and graph context.",
        status: "ok",
        pagePath: "wiki/concepts/search.md",
      }],
    })

    const result = await resolvePreWriteClaimEvidence("/project", candidate)

    expect(result.warnings).toEqual([])
    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: "claim",
        claimId: claim.claim_id,
        pagePath: "wiki/concepts/search.md",
        status: "ok",
        score: expect.any(Number),
      }),
    ])
    expect(result.evidence[0]?.reasons).toContain("claim text overlaps candidate")
  })

  it("returns risk evidence for contradicted and superseded claims", async () => {
    const contradicted = normalizeClaimRecord({
      text: "Hybrid search improves recall.",
      page_path: "wiki/concepts/search.md",
      status: "contradicted",
      contradicts: ["claim_candidate"],
    }, { today: "2026-05-08" }).claim
    const superseded = normalizeClaimRecord({
      text: "Old search architecture should use keyword only.",
      page_path: "wiki/concepts/search.md",
      status: "superseded",
      superseded_by: ["claim_new"],
    }, { today: "2026-05-08" }).claim
    mockReadFile.mockResolvedValue(`${JSON.stringify(contradicted)}\n${JSON.stringify(superseded)}\n`)

    const candidate = buildPreWriteCandidate({
      kind: "ingest-page",
      targetPath: "wiki/concepts/search.md",
      content: "# Hybrid Search",
      claimSummaries: [{
        claimId: "claim_candidate",
        text: "Hybrid search improves recall.",
        status: "ok",
        pagePath: "wiki/concepts/search.md",
      }],
    })

    const result = await resolvePreWriteClaimEvidence("/project", candidate)

    expect(result.evidence.map((item) => item.status)).toEqual(["contradicted", "superseded"])
    expect(result.evidence[0]?.relation).toBe("contradicts")
    expect(result.evidence[1]?.relation).toBe("superseded-by")
  })

  it("bounds evidence and preserves claim index warnings without throwing", async () => {
    const claims = Array.from({ length: 20 }, (_, index) => normalizeClaimRecord({
      text: `Hybrid search claim ${index} improves recall with BM25 and graph context.`,
      page_path: `wiki/concepts/search-${index}.md`,
      status: "ok",
    }, { today: "2026-05-08" }).claim)
    mockReadFile.mockResolvedValue(`${claims.map((claim) => JSON.stringify(claim)).join("\n")}\n{bad\n`)

    const candidate = buildPreWriteCandidate({
      kind: "ingest-page",
      targetPath: "wiki/concepts/search.md",
      content: "# Hybrid Search",
      claimSummaries: [{
        text: "Hybrid search improves recall with BM25 and graph context.",
        status: "ok",
      }],
    })

    const result = await resolvePreWriteClaimEvidence("/project", candidate, {
      maxEvidence: 3,
    })

    expect(result.evidence).toHaveLength(3)
    expect(result.warnings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("Invalid claim JSON"),
      }),
    ])
  })
})

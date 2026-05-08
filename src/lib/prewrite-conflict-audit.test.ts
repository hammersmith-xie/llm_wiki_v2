import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildPreWriteCandidate, classifyPreWriteConflict } from "./prewrite-conflict"
import { appendPreWriteConflictAuditEvent } from "./prewrite-conflict-audit"

vi.mock("@/lib/audit-timeline", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-timeline")>("@/lib/audit-timeline")
  return {
    ...actual,
    appendAuditEvent: vi.fn(async () => {}),
  }
})

import { appendAuditEvent } from "@/lib/audit-timeline"

const mockAppendAuditEvent = vi.mocked(appendAuditEvent)

beforeEach(() => {
  mockAppendAuditEvent.mockReset()
})

describe("pre-write conflict audit", () => {
  const candidate = buildPreWriteCandidate({
    kind: "ingest-page",
    targetPath: "wiki/concepts/search.md",
    title: "Hybrid Search",
    content: "# Hybrid Search\n\nOPENAI_API_KEY=sk-proj-secret-token-1234567890",
    sourcePath: "raw/search.md",
  })

  it("records accept previews without full candidate content", async () => {
    const preview = classifyPreWriteConflict(candidate, [])

    await appendPreWriteConflictAuditEvent("/project", preview, "accept")

    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        action: "conflict.accept",
        category: "conflict",
        targetPath: "wiki/concepts/search.md",
        sourcePath: "raw/search.md",
        changes: { status: "applied" },
        after: expect.objectContaining({
          classification: "new",
          decision: "allow",
          evidenceCount: 0,
        }),
      }),
    )
    const event = mockAppendAuditEvent.mock.calls[0][1]
    expect(JSON.stringify(event)).not.toContain("OPENAI_API_KEY")
  })

  it("records review handoffs with review id", async () => {
    const preview = classifyPreWriteConflict(candidate, [{
      kind: "claim",
      claimId: "claim_old",
      claimText: "Hybrid search does not improve recall.",
      pagePath: "wiki/concepts/search.md",
      status: "contradicted",
      relation: "contradicts",
      score: 0.8,
      reasons: ["contradiction relation present"],
    }])

    await appendPreWriteConflictAuditEvent("/project", preview, "review", {
      reviewItemId: "review-1",
    })

    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        action: "conflict.review",
        category: "conflict",
        changes: { status: "review-only" },
        after: expect.objectContaining({
          classification: "possible-contradiction",
          reviewItemId: "review-1",
          evidence: [expect.objectContaining({ claimId: "claim_old" })],
        }),
      }),
    )
  })
})

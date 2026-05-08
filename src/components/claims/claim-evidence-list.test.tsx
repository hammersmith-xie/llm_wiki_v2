import "@/i18n"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ClaimEvidenceList } from "./claim-evidence-list"
import type { ClaimEvidence } from "@/lib/search-types"

describe("ClaimEvidenceList", () => {
  it("renders accessible claim status, confidence, source, and redaction state", () => {
    const html = renderToStaticMarkup(
      <ClaimEvidenceList
        evidence={[
          evidence({
            status: "ok",
            confidence: "0.92",
            sourceRefs: [{ path: "raw/sources/search.md" }],
          }),
          evidence({
            text: "[private claim text redacted]",
            status: "needs-review",
            confidence: "0.40",
            redacted: true,
            sourceRefs: [],
          }),
        ]}
        label="Claim evidence"
      />,
    )

    expect(html).toContain("Claim evidence")
    expect(html).toContain("Status: ok")
    expect(html).toContain("Confidence: 0.92")
    expect(html).toContain("raw/sources/search.md")
    expect(html).toContain("Redacted")
  })
})

function evidence(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return {
    claimId: "claim_test",
    text: "Hybrid search keeps BM25 and vector evidence separately auditable.",
    pagePath: "wiki/concepts/search.md",
    lifecycle: "semantic",
    status: "ok",
    confidence: "0.80",
    score: 1,
    matchedTerms: ["hybrid"],
    reasons: ["source support"],
    sourceRefs: [],
    ...overrides,
  }
}

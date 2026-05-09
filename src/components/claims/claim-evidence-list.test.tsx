import "@/i18n"
import i18n from "@/i18n"
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
            sourceRefs: [{
              path: "raw/sources/search.md",
              anchor: "snippet:abc",
              snippet_hash: "snippet_abc",
              page: 2,
              line_start: 10,
              line_end: 12,
              char_start: 120,
              char_end: 240,
            }],
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
    expect(html).toContain("page 2")
    expect(html).toContain("line 10-12")
    expect(html).toContain("chars 120-240")
    expect(html).toContain("anchor snippet:abc")
    expect(html).toContain("hash snippet_abc")
    expect(html).toContain("Redacted")
  })

  it("uses localized default labels", async () => {
    await i18n.changeLanguage("zh")
    try {
      const html = renderToStaticMarkup(
        <ClaimEvidenceList
          evidence={[
            evidence({
              status: "ok",
              confidence: "0.92",
              sourceRefs: [{ path: "raw/sources/search.md" }],
            }),
          ]}
        />,
      )

      expect(html).toContain("Claim 证据")
      expect(html).toContain("状态: ok")
      expect(html).toContain("置信度: 0.92")
      expect(html).toContain("来源: raw/sources/search.md")
    } finally {
      await i18n.changeLanguage("en")
    }
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

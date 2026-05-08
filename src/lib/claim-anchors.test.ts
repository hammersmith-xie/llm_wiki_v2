import { describe, expect, it } from "vitest"
import {
  formatClaimAnchor,
  insertClaimAnchor,
  parseClaimAnchors,
  resolveClaimAnchor,
} from "./claim-anchors"

describe("claim markdown anchors", () => {
  it("formats claim anchors as markdown-safe html comments", () => {
    expect(formatClaimAnchor("claim_abc123")).toBe("<!-- claim:claim_abc123 -->")
    expect(() => formatClaimAnchor("claim bad")).toThrow("Invalid claim id")
  })

  it("inserts an anchor before the matching markdown line without duplicating it", () => {
    const before = [
      "# Digest",
      "",
      "- Use BM25 for exact terms.",
      "- Use graph traversal for aliases.",
    ].join("\n")

    const after = insertClaimAnchor(before, {
      claimId: "claim_search1",
      claimText: "Use BM25 for exact terms.",
    })

    expect(after).toContain("<!-- claim:claim_search1 -->\n- Use BM25 for exact terms.")
    expect(insertClaimAnchor(after, {
      claimId: "claim_search1",
      claimText: "Use BM25 for exact terms.",
    })).toBe(after)
    expect(parseClaimAnchors(after)).toEqual([
      expect.objectContaining({ claimId: "claim_search1", line: 3 }),
    ])
  })

  it("preserves CRLF content and matches CJK claim text", () => {
    const before = "# 检索\r\n\r\n结论：图谱检索可以补足关键词检索的召回盲区。\r\n"

    const after = insertClaimAnchor(before, {
      claimId: "claim_cn123",
      claimText: "图谱检索可以补足关键词检索",
    })

    expect(after).toContain("<!-- claim:claim_cn123 -->\r\n结论：图谱检索")
    expect(after.endsWith("\r\n")).toBe(true)
    expect(parseClaimAnchors(after)[0]?.line).toBe(3)
  })

  it("resolves explicit anchors, heading fallback, and orphan claims", () => {
    const anchored = "# Findings\n\n<!-- claim:claim_anchor1 -->\n- A durable finding."
    expect(resolveClaimAnchor(anchored, {
      claimId: "claim_anchor1",
    })).toMatchObject({
      status: "anchor",
      claimId: "claim_anchor1",
      line: 3,
    })

    const fallback = "# Overview\n\n## 关键结论\n\nbody"
    expect(resolveClaimAnchor(fallback, {
      claimId: "claim_missing1",
      pageAnchor: "关键结论",
    })).toMatchObject({
      status: "heading-fallback",
      claimId: "claim_missing1",
      heading: "## 关键结论",
      line: 3,
    })

    expect(resolveClaimAnchor(fallback, {
      claimId: "claim_missing2",
      pageAnchor: "不存在",
    })).toMatchObject({
      status: "orphan",
      claimId: "claim_missing2",
    })
  })
})

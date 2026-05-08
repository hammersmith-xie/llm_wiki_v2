import { describe, expect, it } from "vitest"
import { normalizeClaimRecord } from "./claims"
import {
  applyClaimCredibility,
  calculateClaimCredibility,
} from "./claim-confidence"

describe("claim confidence scoring", () => {
  it("is stable for a fixed today", () => {
    const claim = normalizeClaimRecord({
      text: "Hybrid retrieval should expose each stream separately.",
      page_path: "wiki/concepts/search.md",
      lifecycle: "semantic",
      source_refs: [{ path: "raw/sources/search.md" }],
      last_confirmed: "2026-05-01",
    }, { today: "2026-05-08" }).claim

    expect(calculateClaimCredibility(claim, { today: "2026-05-08" }))
      .toEqual(calculateClaimCredibility(claim, { today: "2026-05-08" }))
  })

  it("raises confidence for sources, reinforcement, and supporting claims", () => {
    const weak = normalizeClaimRecord({
      text: "A provisional claim.",
      page_path: "wiki/a.md",
      lifecycle: "working",
      last_confirmed: "2026-05-08",
    }, { today: "2026-05-08" }).claim
    const strong = normalizeClaimRecord({
      text: "A supported claim.",
      page_path: "wiki/b.md",
      lifecycle: "semantic",
      source_refs: [{ path: "raw/a.md" }, { path: "raw/b.md" }],
      reinforcement_count: "5",
      supports: ["claim_a", "claim_b"],
      last_confirmed: "2026-05-08",
    }, { today: "2026-05-08" }).claim

    const weakMeta = calculateClaimCredibility(weak, { today: "2026-05-08" })
    const strongMeta = calculateClaimCredibility(strong, { today: "2026-05-08" })

    expect(strongMeta.confidence).toBeGreaterThan(weakMeta.confidence)
    expect(strongMeta.reasons.join(" ")).toContain("2 source refs")
    expect(strongMeta.reasons.join(" ")).toContain("5 reinforcements")
    expect(strongMeta.reasons.join(" ")).toContain("2 supporting claims")
  })

  it("lowers confidence and status for stale, contradicted, and superseded claims", () => {
    const current = normalizeClaimRecord({
      text: "A current claim.",
      page_path: "wiki/current.md",
      lifecycle: "semantic",
      source_refs: [{ path: "raw/current.md" }],
      last_confirmed: "2026-05-01",
    }, { today: "2026-05-08" }).claim
    const risky = normalizeClaimRecord({
      text: "An old risky claim.",
      page_path: "wiki/risky.md",
      lifecycle: "semantic",
      source_refs: [{ path: "raw/old.md" }],
      last_confirmed: "2025-01-01",
      contradicts: ["claim_newer"],
      superseded_by: ["claim_replacement"],
    }, { today: "2026-05-08" }).claim

    const currentMeta = calculateClaimCredibility(current, { today: "2026-05-08" })
    const riskyMeta = calculateClaimCredibility(risky, { today: "2026-05-08" })

    expect(riskyMeta.confidence).toBeLessThan(currentMeta.confidence)
    expect(riskyMeta.status).toBe("superseded")
    expect(riskyMeta.reasons.join(" ")).toContain("superseded")
    expect(riskyMeta.reasons.join(" ")).toContain("contradiction")
  })

  it("applies score fields back to a normalized claim record", () => {
    const claim = normalizeClaimRecord({
      text: "A private unverified claim.",
      page_path: "wiki/private.md",
      lifecycle: "working",
      scope: "private",
      last_confirmed: "2025-01-01",
    }, { today: "2026-05-08" }).claim

    const updated = applyClaimCredibility(claim, { today: "2026-05-08" })

    expect(updated.confidence).toMatch(/^\d\.\d{2}$/)
    expect(updated.status).toBe("stale")
    expect(updated.confidence_reasons.join(" ")).toContain("private scope")
    expect(updated.updated_at).toBe("2026-05-08")
  })
})

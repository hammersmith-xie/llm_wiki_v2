import { describe, expect, it } from "vitest"
import { assessConfidenceStaleness } from "./confidence-staleness"

const NOW = new Date("2026-05-10T00:00:00.000Z")

describe("confidence staleness", () => {
  it("treats missing last_confirmed as not stale while exposing the lifecycle half-life", () => {
    const assessment = assessConfidenceStaleness(undefined, "semantic", NOW)

    expect(assessment).toMatchObject({
      tier: "semantic",
      isStale: false,
      daysSinceConfirmed: null,
      halfLifeDays: 180,
      reason: "missing",
    })
  })

  it("keeps a recently confirmed page fresh", () => {
    const assessment = assessConfidenceStaleness("2026-05-01", "semantic", NOW)

    expect(assessment).toMatchObject({
      tier: "semantic",
      isStale: false,
      daysSinceConfirmed: 9,
      halfLifeDays: 180,
      reason: "fresh",
    })
  })

  it("marks an old page stale once last_confirmed exceeds the lifecycle half-life", () => {
    const assessment = assessConfidenceStaleness("2025-01-01", "semantic", NOW)

    expect(assessment).toMatchObject({
      tier: "semantic",
      isStale: true,
      daysSinceConfirmed: 494,
      halfLifeDays: 180,
      reason: "stale",
    })
  })

  it("treats malformed dates as not stale", () => {
    const assessment = assessConfidenceStaleness("soon-ish", "procedural", NOW)

    expect(assessment).toMatchObject({
      tier: "procedural",
      isStale: false,
      daysSinceConfirmed: null,
      halfLifeDays: 365,
      reason: "malformed",
    })
  })

  it("never marks archived pages stale from confidence age", () => {
    const assessment = assessConfidenceStaleness("2020-01-01", "archived", NOW)

    expect(assessment).toMatchObject({
      tier: "archived",
      isStale: false,
      daysSinceConfirmed: 2321,
      halfLifeDays: null,
      reason: "archived",
    })
  })
})

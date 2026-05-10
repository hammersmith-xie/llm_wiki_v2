import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ConfidenceStalenessAssessment } from "@/lib/confidence-staleness"
import {
  ConfidenceStaleBadgeView,
  shouldShowConfidenceStaleBadge,
} from "./confidence-stale-badge"

describe("ConfidenceStaleBadge", () => {
  it("renders stale age, half-life, and patrol action text", () => {
    const html = renderToStaticMarkup(
      <ConfidenceStaleBadgeView
        assessment={staleAssessment()}
        onRunPatrol={vi.fn()}
      />,
    )

    expect(html).toContain("Last confirmed 494d ago")
    expect(html).toContain("half-life 180d")
    expect(html).toContain("Run patrol")
  })

  it("does not render for fresh, missing, malformed, or archived assessments", () => {
    expect(shouldShowConfidenceStaleBadge(staleAssessment())).toBe(true)
    expect(shouldShowConfidenceStaleBadge({ ...staleAssessment(), isStale: false, reason: "fresh" })).toBe(false)
    expect(shouldShowConfidenceStaleBadge({ ...staleAssessment(), daysSinceConfirmed: null, reason: "missing" })).toBe(false)
    expect(shouldShowConfidenceStaleBadge({ ...staleAssessment(), halfLifeDays: null, reason: "archived" })).toBe(false)
  })

  it("wires the patrol button to the caller", () => {
    const onRunPatrol = vi.fn()
    const element = (
      <ConfidenceStaleBadgeView
        assessment={staleAssessment()}
        onRunPatrol={onRunPatrol}
      />
    )

    element.props.onRunPatrol()
    expect(onRunPatrol).toHaveBeenCalledOnce()
  })
})

function staleAssessment(): ConfidenceStalenessAssessment {
  return {
    tier: "semantic",
    isStale: true,
    daysSinceConfirmed: 494,
    halfLifeDays: 180,
    reason: "stale",
  }
}

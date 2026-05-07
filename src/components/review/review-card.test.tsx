import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ReviewCard } from "./review-card"
import type { ReviewItem } from "@/stores/review-store"

describe("ReviewCard", () => {
  it("renders candidate hints and accessible dismiss control for unresolved items", () => {
    const item: ReviewItem = {
      id: "review-1",
      type: "suggestion",
      title: "Save: Retrieval Notes",
      description: [
        "## Decision",
        "Recommendation: preserve this answer because it cites concrete pages and records a decision.",
        "The review explains why [[graph-search]] should stay query-time rather than become a central database.",
      ].join("\n"),
      affectedPages: ["wiki/concepts/graph-search.md"],
      options: [{ label: "Save", action: "save:abc" }],
      resolved: false,
      createdAt: 1,
    }

    const html = renderToStaticMarkup(
      <ReviewCard item={item} onResolve={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(html).toContain("Save: Retrieval Notes")
    expect(html).toContain("Save suggested")
    expect(html).toContain("aria-label=\"Dismiss review item\"")
    expect(html).toContain("Deep Research")
    expect(html).toContain("Save")
  })

  it("renders resolved action instead of action buttons for resolved items", () => {
    const item: ReviewItem = {
      id: "review-2",
      type: "confirm",
      title: "Confirm old claim",
      description: "Needs a human decision.",
      options: [{ label: "Confirm", action: "confirm" }],
      resolved: true,
      resolvedAction: "Confirmed",
      createdAt: 2,
    }

    const html = renderToStaticMarkup(
      <ReviewCard item={item} onResolve={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(html).toContain("Confirmed")
    expect(html).not.toContain("Confirm</button>")
  })
})

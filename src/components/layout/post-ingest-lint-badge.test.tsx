import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { IngestLintHints } from "@/lib/ingest-lint-hints"
import {
  PostIngestLintBadgeView,
  shouldShowPostIngestLintBadge,
} from "./post-ingest-lint-badge"

describe("PostIngestLintBadge", () => {
  it("renders an accessible hint count and source name", () => {
    const html = renderToStaticMarkup(
      <PostIngestLintBadgeView
        hints={hints({ totalCount: 2, sourcePath: "raw/sources/paper.md" })}
        onOpenLint={vi.fn()}
      />,
    )

    expect(html).toContain("2 lint hints from last ingest")
    expect(html).toContain("paper.md")
    expect(html).toContain("Open Lint panel")
  })

  it("does not render for missing or empty hints", () => {
    expect(shouldShowPostIngestLintBadge(null)).toBe(false)
    expect(shouldShowPostIngestLintBadge(hints({ totalCount: 0, hints: [] }))).toBe(false)
  })

  it("wires the view button to the lint opener", () => {
    const onOpenLint = vi.fn()
    const element = (
      <PostIngestLintBadgeView
        hints={hints({ totalCount: 1 })}
        onOpenLint={onOpenLint}
      />
    )

    element.props.onOpenLint()
    expect(onOpenLint).toHaveBeenCalledOnce()
  })
})

function hints(overrides: Partial<IngestLintHints> = {}): IngestLintHints {
  return {
    ingestId: "activity-1",
    sourcePath: "raw/source.md",
    timestamp: 1,
    hints: [
      {
        type: "orphan",
        severity: "info",
        page: "concepts/a.md",
        detail: "No inbound links.",
      },
    ],
    totalCount: 1,
    ...overrides,
  }
}

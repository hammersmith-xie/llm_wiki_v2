import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { buildCoordinationSummary } from "@/lib/coordination-summary"
import { CoordinationSummaryPanel } from "./coordination-summary-panel"

describe("CoordinationSummaryPanel", () => {
  it("renders local activity without cloud collaboration language", () => {
    const summary = buildCoordinationSummary({
      now: Date.parse("2026-05-07T12:00:00.000Z"),
      auditEvents: [
        {
          timestamp: "2026-05-07T04:00:00.000Z",
          action: "memory.write",
          actor: "agent",
          targetPath: "wiki/entities/private-lead.md",
          scope: "private",
          reasons: ["sensitive note"],
          changes: { status: "applied" },
        },
        {
          timestamp: "2026-05-07T05:00:00.000Z",
          action: "digest.save",
          actor: "user",
          targetPath: "wiki/queries/search-notes.md",
          changes: { status: "applied" },
        },
      ],
      reviewItems: [
        {
          id: "review-1",
          type: "confirm",
          title: "Confirm stale claim",
          description: "Needs review",
          affectedPages: ["wiki/concepts/old.md"],
          options: [{ label: "Confirm", action: "confirm" }],
          resolved: false,
          createdAt: 1,
        },
      ],
      schemaFindings: [
        {
          id: "finding-1",
          kind: "dangling-relation",
          severity: "warning",
          targetPath: "wiki/concepts/a.md",
          title: "Relation needs review",
          detail: "Needs attention",
          reasons: ["dangling relation"],
        },
      ],
    })

    const html = renderToStaticMarkup(
      <CoordinationSummaryPanel
        projectReady
        summary={summary}
        onOpenPath={vi.fn()}
        onFilterTimeline={vi.fn()}
      />,
    )

    expect(html).toContain("Coordination summary")
    expect(html).toContain("Actor activity")
    expect(html).toContain("Confirm stale claim")
    expect(html).toContain("Relation needs review")
    expect(html).toContain("Private event details redacted.")
    expect(html).not.toContain("cloud sync")
    expect(html).not.toContain("team permissions")
  })
})

import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ConsolidationQueuePanel } from "./consolidation-queue-panel"
import type { ConsolidationQueueItem } from "@/lib/consolidation-queue"

describe("ConsolidationQueuePanel", () => {
  it("renders queued digest candidates with status actions", () => {
    const html = renderToStaticMarkup(
      <ConsolidationQueuePanel
        projectReady
        loading={false}
        workingItemId={null}
        error={null}
        items={[item()]}
        warnings={[]}
        onRefresh={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    )

    expect(html).toContain("Consolidation queue")
    expect(html).toContain("1 queued / 1 total")
    expect(html).toContain("Graph Search Decision")
    expect(html).toContain("chat · 0.82")
    expect(html).toContain("1 decisions")
    expect(html).toContain("wiki/synthesis/graph-search-decision.md")
    expect(html).toContain("2 explicit references")
    expect(html).toContain("Accept")
    expect(html).toContain("Dismiss")
    expect(html).toContain("Mark applied")
  })

  it("renders warnings and empty state", () => {
    const html = renderToStaticMarkup(
      <ConsolidationQueuePanel
        projectReady
        loading={false}
        workingItemId={null}
        error={null}
        items={[]}
        warnings={["bad queue row"]}
        onRefresh={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    )

    expect(html).toContain("Queue warnings")
    expect(html).toContain("bad queue row")
    expect(html).toContain("No consolidation candidates queued.")
  })

  it("shows project and error states", () => {
    const html = renderToStaticMarkup(
      <ConsolidationQueuePanel
        projectReady={false}
        loading={false}
        workingItemId={null}
        error="disk full"
        items={[]}
        warnings={[]}
        onRefresh={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    )

    expect(html).toContain("Open a project first.")
    expect(html).toContain("disk full")
  })
})

function item(): ConsolidationQueueItem {
  return {
    id: "cq_graph",
    version: 1,
    status: "queued",
    dedupeKey: "digest:graph",
    sourceId: "a-1",
    sourceOrigin: "chat",
    sourceTitle: "Graph Search Decision",
    sourceScore: 0.82,
    sourceReasons: ["substantial answer length", "2 explicit references"],
    targetPaths: ["wiki/synthesis/graph-search-decision.md"],
    counts: {
      decisionCount: 1,
      lessonCount: 2,
      entityCount: 3,
      relationCount: 4,
      pageCandidateCount: 1,
    },
    warnings: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  }
}

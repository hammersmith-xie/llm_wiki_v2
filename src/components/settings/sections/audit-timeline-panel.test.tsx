import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { AuditTimelinePanel } from "./audit-timeline-panel"

describe("AuditTimelinePanel", () => {
  it("renders structured export controls and latest export path", () => {
    const html = renderToStaticMarkup(
      <AuditTimelinePanel
        projectReady
        events={[
          {
            action: "memory_ops.patrol",
            category: "memory_ops",
            timestamp: "2026-05-09T00:00:00.000Z",
            targetPath: ".llm-wiki/audit.jsonl",
            changes: { status: "applied" },
          },
        ]}
        warnings={[]}
        openError={null}
        exportPath="/project/.llm-wiki/exports/audit.json"
        onRefresh={vi.fn()}
        onOpenPath={vi.fn()}
        onExport={vi.fn()}
      />,
    )

    expect(html).toContain("Export JSON")
    expect(html).toContain("Export CSV")
    expect(html).toContain("JSON exports include full selected audit event details")
    expect(html).toContain("/project/.llm-wiki/exports/audit.json")
    expect(html).toContain("Activity view")
    expect(html).toContain("1 events across 1 active days")
    expect(html).toContain("Daily activity")
    expect(html).toContain("Memory Ops")
  })

  it("shows export failures", () => {
    const html = renderToStaticMarkup(
      <AuditTimelinePanel
        projectReady
        events={[]}
        warnings={[]}
        openError={null}
        exportError="disk full"
        onRefresh={vi.fn()}
        onOpenPath={vi.fn()}
      />,
    )

    expect(html).toContain("Export failed: disk full")
  })
})

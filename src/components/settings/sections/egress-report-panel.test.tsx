import "@/i18n"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { EgressReport } from "@/lib/egress-log"
import { EgressReportPanel } from "./egress-report-panel"

describe("EgressReportPanel", () => {
  it("renders aggregated seven-day egress without exposing URL query strings", () => {
    const report: EgressReport = {
      events: [],
      warnings: [{ line: 2, message: "bad json", raw: "{bad" }],
      groups: [
        {
          key: "api.openai.com|openai|chat completion|llm",
          host: "api.openai.com",
          feature: "llm",
          provider: "openai",
          reason: "chat completion",
          allowedCount: 3,
          blockedCount: 1,
          lastSeenAt: "2026-05-11T00:00:00.000Z",
        },
      ],
    }

    const html = renderToStaticMarkup(
      <EgressReportPanel projectReady report={report} loading={false} onRefresh={() => {}} />,
    )

    expect(html).toContain("Egress report")
    expect(html).toContain("api.openai.com")
    expect(html).toContain("openai")
    expect(html).toContain("chat completion")
    expect(html).toContain("Allowed 3")
    expect(html).toContain("Blocked 1")
    expect(html).toContain("1 malformed")
    expect(html).not.toContain("?")
    expect(html).not.toContain("api_key")
  })

  it("shows an empty state when no project is open", () => {
    const html = renderToStaticMarkup(
      <EgressReportPanel projectReady={false} report={null} loading={false} onRefresh={() => {}} />,
    )

    expect(html).toContain("Open a project to view egress history.")
  })
})

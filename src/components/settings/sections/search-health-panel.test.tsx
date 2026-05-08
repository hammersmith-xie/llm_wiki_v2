import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { SearchHealthPanel } from "./search-health-panel"

describe("SearchHealthPanel", () => {
  it("renders custom scenario editor controls and source counts", () => {
    const html = renderToStaticMarkup(
      <SearchHealthPanel
        projectReady
        running={false}
        result={{
          status: "pass",
          scenarioCount: 2,
          sourceCounts: {
            builtInScenarioCount: 1,
            customScenarioCount: 1,
            skippedScenarioCount: 0,
          },
          skippedScenarios: [],
          summary: {
            status: "pass",
            scenarioCount: 2,
            passedCount: 2,
            failedCount: 0,
            streamCounts: {},
            failedScenarios: [],
          },
        }}
        error={null}
        customScenarios={[
          {
            id: "critical-query",
            query: "hybrid search",
            expectedInTopK: [{ path: "wiki/concepts/search.md", topK: 3 }],
          },
        ]}
        customScenarioDirty={false}
        customScenarioSaving={false}
        customScenarioError={null}
        customScenarioSaved={false}
        onRun={vi.fn()}
        onOpenReport={vi.fn()}
        onAddCustomScenario={vi.fn()}
        onUpdateCustomScenario={vi.fn()}
        onRemoveCustomScenario={vi.fn()}
        onSaveCustomScenarios={vi.fn()}
      />,
    )

    expect(html).toContain("Custom scenarios")
    expect(html).toContain("critical-query")
    expect(html).toContain("hybrid search")
    expect(html).toContain("wiki/concepts/search.md")
    expect(html).toContain("1 built-in")
    expect(html).toContain("1 custom")
    expect(html).toContain("Add scenario")
    expect(html).toContain("Save scenarios")
  })
})

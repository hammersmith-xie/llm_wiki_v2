import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryOpsPolicyPanel } from "./memory-ops-policy-panel"
import { DEFAULT_MEMORY_OPS_POLICY } from "@/lib/memory-ops-policy"

describe("MemoryOpsPolicyPanel", () => {
  it("renders the auto patrol policy switch", () => {
    const html = renderToStaticMarkup(
      <MemoryOpsPolicyPanel
        projectReady
        policy={DEFAULT_MEMORY_OPS_POLICY}
        warnings={[]}
        saving={false}
        error={null}
        saved={false}
        onSave={vi.fn()}
        onRestoreDefault={vi.fn()}
      />,
    )

    expect(html).toContain("Automation")
    expect(html).toContain("Automatic patrol is the default convenience mode")
    expect(html).toContain("Run patrol automatically when due; turn off for manual confirmation only")
    expect(html).toContain("Activity threshold")
    expect(html).toContain("Time-based patrol interval")
    expect(html).toContain("checked")
  })
})

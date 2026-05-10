import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { LocalMaintenanceReminder } from "@/stores/local-maintenance-store"
import { LocalMaintenanceBannerView } from "./local-maintenance-banner"

describe("LocalMaintenanceBanner", () => {
  it("renders due reason, age, threshold count, and actions", () => {
    const html = renderToStaticMarkup(
      <LocalMaintenanceBannerView
        reminder={reminder()}
        onOpenMaintenance={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(html).toContain("Maintenance due")
    expect(html).toContain("event threshold")
    expect(html).toContain("6 events")
    expect(html).toContain("dirty for 2d")
    expect(html).toContain("Open Settings")
    expect(html).toContain("Dismiss")
  })

  it("wires open and dismiss callbacks", () => {
    const onOpenMaintenance = vi.fn()
    const onDismiss = vi.fn()
    const element = (
      <LocalMaintenanceBannerView
        reminder={reminder()}
        onOpenMaintenance={onOpenMaintenance}
        onDismiss={onDismiss}
      />
    )

    element.props.onOpenMaintenance()
    element.props.onDismiss()

    expect(onOpenMaintenance).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

function reminder(): LocalMaintenanceReminder {
  return {
    projectPath: "/project",
    dueReasons: ["event-threshold"],
    eventCountSincePatrol: 6,
    dirtySince: Date.parse("2026-05-08T00:00:00.000Z"),
    lastPatrolAt: Date.parse("2026-05-01T00:00:00.000Z"),
    createdAt: Date.parse("2026-05-10T00:00:00.000Z"),
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest"
import { openMaintenanceSettings } from "./open-maintenance-settings"
import { useSettingsNavigationStore } from "@/stores/settings-navigation-store"

beforeEach(() => {
  useSettingsNavigationStore.setState({ requestedCategory: null })
})

describe("openMaintenanceSettings", () => {
  it("requests the maintenance category before switching to settings", () => {
    const setActiveView = vi.fn()

    openMaintenanceSettings(setActiveView)

    expect(useSettingsNavigationStore.getState().requestedCategory).toBe("maintenance")
    expect(setActiveView).toHaveBeenCalledWith("settings")
  })
})

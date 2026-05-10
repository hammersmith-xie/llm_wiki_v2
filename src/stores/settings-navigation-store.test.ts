import { beforeEach, describe, expect, it } from "vitest"
import { useSettingsNavigationStore } from "./settings-navigation-store"

beforeEach(() => {
  useSettingsNavigationStore.setState({ requestedCategory: null })
})

describe("settings-navigation-store", () => {
  it("stores a one-shot requested settings category", () => {
    useSettingsNavigationStore.getState().requestCategory("maintenance")

    expect(useSettingsNavigationStore.getState().requestedCategory).toBe("maintenance")
    expect(useSettingsNavigationStore.getState().consumeRequestedCategory()).toBe("maintenance")
    expect(useSettingsNavigationStore.getState().requestedCategory).toBeNull()
  })
})

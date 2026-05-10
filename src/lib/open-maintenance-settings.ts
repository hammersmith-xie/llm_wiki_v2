import { useSettingsNavigationStore } from "@/stores/settings-navigation-store"

export function openMaintenanceSettings(setActiveView: (view: "settings") => void): void {
  useSettingsNavigationStore.getState().requestCategory("maintenance")
  setActiveView("settings")
}

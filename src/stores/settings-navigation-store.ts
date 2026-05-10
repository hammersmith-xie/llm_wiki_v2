import { create } from "zustand"

export type SettingsCategoryId =
  | "llm"
  | "embedding"
  | "multimodal"
  | "web-search"
  | "network"
  | "output"
  | "interface"
  | "maintenance"
  | "changelog"
  | "about"

interface SettingsNavigationState {
  requestedCategory: SettingsCategoryId | null
  requestCategory: (category: SettingsCategoryId) => void
  consumeRequestedCategory: () => SettingsCategoryId | null
}

export const useSettingsNavigationStore = create<SettingsNavigationState>((set, get) => ({
  requestedCategory: null,
  requestCategory: (requestedCategory) => set({ requestedCategory }),
  consumeRequestedCategory: () => {
    const requestedCategory = get().requestedCategory
    set({ requestedCategory: null })
    return requestedCategory
  },
}))

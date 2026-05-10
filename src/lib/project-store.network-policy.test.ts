import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_NETWORK_POLICY, type NetworkPolicyConfig } from "./network-policy"

const values = new Map<string, unknown>()
const store = {
  get: vi.fn(async (key: string) => values.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    values.set(key, value)
  }),
}

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => store),
}))

import { loadNetworkPolicyConfig, saveNetworkPolicyConfig } from "./project-store"

beforeEach(() => {
  values.clear()
  store.get.mockClear()
  store.set.mockClear()
})

describe("network policy project-store persistence", () => {
  it("returns null when no policy has been saved", async () => {
    await expect(loadNetworkPolicyConfig()).resolves.toBeNull()
  })

  it("saves and normalizes the network policy config", async () => {
    const config: NetworkPolicyConfig = {
      ...DEFAULT_NETWORK_POLICY,
      mode: "local-only",
      allowLan: true,
    }

    await saveNetworkPolicyConfig(config)

    expect(store.set).toHaveBeenCalledWith("networkPolicyConfig", config)
    await expect(loadNetworkPolicyConfig()).resolves.toEqual(config)
  })
})

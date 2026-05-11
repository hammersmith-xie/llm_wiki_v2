import { describe, expect, it, vi } from "vitest"
import { DEFAULT_NETWORK_POLICY, type NetworkPolicyConfig } from "./network-policy"
import { hydrateStartupSettings, type StartupSettingsStore } from "./startup-settings"

function baseStore(overrides: Partial<StartupSettingsStore> = {}): StartupSettingsStore {
  return {
    setLlmConfig: vi.fn(),
    setProviderConfigs: vi.fn(),
    setActivePresetId: vi.fn(),
    setSearchApiConfig: vi.fn(),
    setEmbeddingConfig: vi.fn(),
    setMultimodalConfig: vi.fn(),
    setProxyConfig: vi.fn(),
    setNetworkPolicyConfig: vi.fn(),
    llmConfig: {
      provider: "openai",
      apiKey: "",
      model: "",
      ollamaUrl: "http://localhost:11434",
      customEndpoint: "",
      maxContextSize: 204800,
    },
    ...overrides,
  }
}

describe("hydrateStartupSettings", () => {
  it("hydrates persisted network policy into the runtime store", async () => {
    const networkPolicy: NetworkPolicyConfig = {
      ...DEFAULT_NETWORK_POLICY,
      mode: "local-only",
      allowLan: true,
    }
    const setNetworkPolicyConfig = vi.fn()

    await hydrateStartupSettings({
      loaders: {
        loadLlmConfig: async () => null,
        loadProviderConfigs: async () => null,
        loadActivePresetId: async () => null,
        loadSearchApiConfig: async () => null,
        loadEmbeddingConfig: async () => null,
        loadMultimodalConfig: async () => null,
        loadProxyConfig: async () => null,
        loadNetworkPolicyConfig: async () => networkPolicy,
      },
      store: baseStore({ setNetworkPolicyConfig }),
    })

    expect(setNetworkPolicyConfig).toHaveBeenCalledWith(networkPolicy)
  })

  it("resolves active presets against the saved LLM config loaded earlier in startup", async () => {
    const savedLlm = {
      provider: "custom" as const,
      apiKey: "saved-key",
      model: "saved-model",
      ollamaUrl: "http://localhost:11434",
      customEndpoint: "https://gateway.example.com/v1",
      maxContextSize: 1234,
    }
    const defaultLlm = {
      provider: "openai" as const,
      apiKey: "",
      model: "",
      ollamaUrl: "http://localhost:11434",
      customEndpoint: "",
      maxContextSize: 204800,
    }
    const resolveActivePreset = vi.fn(async () => null)

    await hydrateStartupSettings({
      loaders: {
        loadLlmConfig: async () => savedLlm,
        loadProviderConfigs: async () => ({}),
        loadActivePresetId: async () => "custom-openai-compatible",
        loadSearchApiConfig: async () => null,
        loadEmbeddingConfig: async () => null,
        loadMultimodalConfig: async () => null,
        loadProxyConfig: async () => null,
        loadNetworkPolicyConfig: async () => null,
      },
      store: baseStore({ llmConfig: defaultLlm }),
      resolveActivePreset,
    })

    expect(resolveActivePreset).toHaveBeenCalledWith(
      "custom-openai-compatible",
      {},
      savedLlm,
    )
  })

  it("seeds the default allowlist from existing cloud provider config when no policy was saved", async () => {
    const setNetworkPolicyConfig = vi.fn()

    await hydrateStartupSettings({
      loaders: {
        loadLlmConfig: async () => ({
          provider: "openai",
          apiKey: "sk-test",
          model: "gpt-4o",
          ollamaUrl: "http://localhost:11434",
          customEndpoint: "",
          maxContextSize: 204800,
        }),
        loadProviderConfigs: async () => null,
        loadActivePresetId: async () => null,
        loadSearchApiConfig: async () => ({ provider: "tavily", apiKey: "tvly" }),
        loadEmbeddingConfig: async () => null,
        loadMultimodalConfig: async () => null,
        loadProxyConfig: async () => null,
        loadNetworkPolicyConfig: async () => null,
      },
      store: baseStore({ setNetworkPolicyConfig }),
    })

    expect(setNetworkPolicyConfig).toHaveBeenCalledWith({
      ...DEFAULT_NETWORK_POLICY,
      allowedHosts: ["https://api.openai.com", "https://api.tavily.com"],
    })
  })

  it("notifies the user when startup seeds an allowlist from existing cloud providers", async () => {
    const addStartupNotice = vi.fn()

    await hydrateStartupSettings({
      loaders: {
        loadLlmConfig: async () => ({
          provider: "openai",
          apiKey: "sk-test",
          model: "gpt-4o",
          ollamaUrl: "http://localhost:11434",
          customEndpoint: "",
          maxContextSize: 204800,
        }),
        loadProviderConfigs: async () => null,
        loadActivePresetId: async () => null,
        loadSearchApiConfig: async () => ({ provider: "tavily", apiKey: "tvly" }),
        loadEmbeddingConfig: async () => null,
        loadMultimodalConfig: async () => null,
        loadProxyConfig: async () => null,
        loadNetworkPolicyConfig: async () => null,
      },
      store: baseStore(),
      addStartupNotice,
    })

    expect(addStartupNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Network allowlist seeded",
        detail: expect.stringContaining("https://api.openai.com"),
      }),
    )
    expect(addStartupNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining("https://api.tavily.com"),
      }),
    )
  })
})

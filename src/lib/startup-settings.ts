import type {
  EmbeddingConfig,
  LlmConfig,
  MultimodalConfig,
  NetworkPolicyConfig,
  ProviderConfigs,
  ProxyConfig,
  SearchApiConfig,
} from "@/stores/wiki-store"

export interface StartupSettingsLoaders {
  loadLlmConfig: () => Promise<LlmConfig | null>
  loadProviderConfigs: () => Promise<ProviderConfigs | null>
  loadActivePresetId: () => Promise<string | null>
  loadSearchApiConfig: () => Promise<SearchApiConfig | null>
  loadEmbeddingConfig: () => Promise<EmbeddingConfig | null>
  loadMultimodalConfig: () => Promise<MultimodalConfig | null>
  loadProxyConfig: () => Promise<ProxyConfig | null>
  loadNetworkPolicyConfig: () => Promise<NetworkPolicyConfig | null>
}

export interface StartupSettingsStore {
  llmConfig: LlmConfig
  setLlmConfig: (config: LlmConfig) => void
  setProviderConfigs: (configs: ProviderConfigs) => void
  setActivePresetId: (id: string | null) => void
  setSearchApiConfig: (config: SearchApiConfig) => void
  setEmbeddingConfig: (config: EmbeddingConfig) => void
  setMultimodalConfig: (config: MultimodalConfig) => void
  setProxyConfig: (config: ProxyConfig) => void
  setNetworkPolicyConfig: (config: NetworkPolicyConfig) => void
}

export interface HydrateStartupSettingsOptions {
  loaders: StartupSettingsLoaders
  store: StartupSettingsStore
  resolveActivePreset?: (
    activePresetId: string,
    providerConfigs: ProviderConfigs | null,
    fallback: LlmConfig,
  ) => Promise<LlmConfig | null>
  saveResolvedLlmConfig?: (config: LlmConfig) => Promise<void>
}

export async function hydrateStartupSettings({
  loaders,
  store,
  resolveActivePreset,
  saveResolvedLlmConfig,
}: HydrateStartupSettingsOptions): Promise<void> {
  let currentLlmConfig = store.llmConfig

  const savedConfig = await loaders.loadLlmConfig()
  if (savedConfig) {
    store.setLlmConfig(savedConfig)
    currentLlmConfig = savedConfig
  }

  const savedProviderConfigs = await loaders.loadProviderConfigs()
  if (savedProviderConfigs) {
    store.setProviderConfigs(savedProviderConfigs)
  }

  const savedActivePreset = await loaders.loadActivePresetId()
  if (savedActivePreset) {
    store.setActivePresetId(savedActivePreset)
    const resolved = await resolveActivePreset?.(
      savedActivePreset,
      savedProviderConfigs,
      currentLlmConfig,
    )
    if (resolved) {
      store.setLlmConfig(resolved)
      currentLlmConfig = resolved
      await saveResolvedLlmConfig?.(resolved)
    }
  }

  const savedSearchConfig = await loaders.loadSearchApiConfig()
  if (savedSearchConfig) {
    store.setSearchApiConfig(savedSearchConfig)
  }

  const savedEmbeddingConfig = await loaders.loadEmbeddingConfig()
  if (savedEmbeddingConfig) {
    store.setEmbeddingConfig(savedEmbeddingConfig)
  }

  const savedMultimodalConfig = await loaders.loadMultimodalConfig()
  if (savedMultimodalConfig) {
    store.setMultimodalConfig(savedMultimodalConfig)
  }

  const savedProxy = await loaders.loadProxyConfig()
  if (savedProxy) {
    store.setProxyConfig(savedProxy)
  }

  const savedNetworkPolicy = await loaders.loadNetworkPolicyConfig()
  if (savedNetworkPolicy) {
    store.setNetworkPolicyConfig(savedNetworkPolicy)
  }
}

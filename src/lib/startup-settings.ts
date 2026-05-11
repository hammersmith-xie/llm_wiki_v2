import type {
  EmbeddingConfig,
  LlmConfig,
  MultimodalConfig,
  NetworkPolicyConfig,
  ProviderConfigs,
  ProxyConfig,
  SearchApiConfig,
} from "@/stores/wiki-store"
import { seedNetworkPolicyFromConfiguredCloud } from "@/lib/network-policy-migration"

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
  addStartupNotice?: (notice: {
    title: string
    detail: string
  }) => void
}

export async function hydrateStartupSettings({
  loaders,
  store,
  resolveActivePreset,
  saveResolvedLlmConfig,
  addStartupNotice,
}: HydrateStartupSettingsOptions): Promise<void> {
  let currentLlmConfig = store.llmConfig
  let currentSearchConfig: SearchApiConfig | null = null
  let currentEmbeddingConfig: EmbeddingConfig | null = null
  let currentMultimodalConfig: MultimodalConfig | null = null

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
    currentSearchConfig = savedSearchConfig
  }

  const savedEmbeddingConfig = await loaders.loadEmbeddingConfig()
  if (savedEmbeddingConfig) {
    store.setEmbeddingConfig(savedEmbeddingConfig)
    currentEmbeddingConfig = savedEmbeddingConfig
  }

  const savedMultimodalConfig = await loaders.loadMultimodalConfig()
  if (savedMultimodalConfig) {
    store.setMultimodalConfig(savedMultimodalConfig)
    currentMultimodalConfig = savedMultimodalConfig
  }

  const savedProxy = await loaders.loadProxyConfig()
  if (savedProxy) {
    store.setProxyConfig(savedProxy)
  }

  const savedNetworkPolicy = await loaders.loadNetworkPolicyConfig()
  const networkPolicy = seedNetworkPolicyFromConfiguredCloud({
    savedNetworkPolicy,
    llmConfig: currentLlmConfig,
    searchConfig: currentSearchConfig,
    embeddingConfig: currentEmbeddingConfig,
    multimodalConfig: currentMultimodalConfig,
  })
  if (savedNetworkPolicy || networkPolicy.allowedHosts.length > 0) {
    store.setNetworkPolicyConfig(networkPolicy)
  }
  if (!savedNetworkPolicy && networkPolicy.allowedHosts.length > 0) {
    addStartupNotice?.({
      title: "Network allowlist seeded",
      detail:
        "Existing cloud provider hosts were added to Settings -> Network so the upgrade keeps working: " +
        networkPolicy.allowedHosts.join(", "),
    })
  }
}

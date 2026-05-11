import {
  DEFAULT_NETWORK_POLICY,
  normalizeNetworkAllowlistEntry,
  type NetworkPolicyConfig,
} from "@/lib/network-policy"
import type { EmbeddingConfig, LlmConfig, MultimodalConfig, SearchApiConfig } from "@/stores/wiki-store"

interface SeedInput {
  savedNetworkPolicy: NetworkPolicyConfig | null
  llmConfig?: LlmConfig | null
  searchConfig?: SearchApiConfig | null
  embeddingConfig?: EmbeddingConfig | null
  multimodalConfig?: MultimodalConfig | null
}

export function seedNetworkPolicyFromConfiguredCloud(input: SeedInput): NetworkPolicyConfig {
  if (input.savedNetworkPolicy) return input.savedNetworkPolicy

  const allowedHosts = new Set<string>()
  addProviderOrigin(allowedHosts, input.llmConfig)
  addSearchOrigin(allowedHosts, input.searchConfig)
  addEmbeddingOrigin(allowedHosts, input.embeddingConfig)
  if (input.multimodalConfig?.enabled && !input.multimodalConfig.useMainLlm) {
    addProviderOrigin(allowedHosts, {
      provider: input.multimodalConfig.provider,
      apiKey: input.multimodalConfig.apiKey,
      model: input.multimodalConfig.model,
      ollamaUrl: input.multimodalConfig.ollamaUrl,
      customEndpoint: input.multimodalConfig.customEndpoint,
      apiMode: input.multimodalConfig.apiMode,
      maxContextSize: 204800,
    })
  }

  return {
    ...DEFAULT_NETWORK_POLICY,
    allowedHosts: [...allowedHosts],
  }
}

function addProviderOrigin(target: Set<string>, config: LlmConfig | null | undefined) {
  if (!config) return
  switch (config.provider) {
    case "openai":
      if (config.apiKey) addOrigin(target, "https://api.openai.com")
      return
    case "anthropic":
    case "claude-code":
      addOrigin(target, "https://api.anthropic.com")
      return
    case "google":
      if (config.apiKey) addOrigin(target, "https://generativelanguage.googleapis.com")
      return
    case "minimax":
      if (config.apiKey) addOrigin(target, config.customEndpoint || "https://api.minimax.io/anthropic")
      return
    case "custom":
      if (config.customEndpoint) addOrigin(target, config.customEndpoint)
      return
    case "ollama":
      return
  }
}

function addSearchOrigin(target: Set<string>, config: SearchApiConfig | null | undefined) {
  if (!config || config.provider === "none") return
  if (config.provider === "tavily" && searchProviderHasKey(config, "tavily")) {
    addOrigin(target, "https://api.tavily.com")
  }
  if (config.provider === "serpapi" && searchProviderHasKey(config, "serpapi")) {
    addOrigin(target, "https://serpapi.com")
  }
}

function searchProviderHasKey(config: SearchApiConfig, provider: "tavily" | "serpapi"): boolean {
  return Boolean(config.providerConfigs?.[provider]?.apiKey || config.apiKey)
}

function addEmbeddingOrigin(target: Set<string>, config: EmbeddingConfig | null | undefined) {
  if (!config?.enabled || !config.endpoint) return
  addOrigin(target, config.endpoint)
}

function addOrigin(target: Set<string>, endpoint: string) {
  const normalized = normalizeNetworkAllowlistEntry(endpoint)
  if (!normalized) return
  if (isLoopbackOrLan(normalized)) return
  target.add(normalized)
}

function isLoopbackOrLan(entry: string): boolean {
  try {
    const url = entry.includes("://") ? new URL(entry) : new URL(`http://${entry}`)
    const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "")
    if (host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)) return true
    const parts = host.split(".").map((part) => Number(part))
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
    const [a, b] = parts
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  } catch {
    return false
  }
}

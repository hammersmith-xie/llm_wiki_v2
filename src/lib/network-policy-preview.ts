import {
  evaluateNetworkPolicy,
  type NetworkPolicyConfig,
  type NetworkPolicyMode,
} from "@/lib/network-policy"
import type { LlmConfig } from "@/stores/wiki-store"

export type NetworkPolicyPreview =
  | { kind: "allowed"; host: string; mode: NetworkPolicyMode; message: string }
  | { kind: "cloud-allowed"; host: string; mode: NetworkPolicyMode; message: string }
  | { kind: "blocked"; host: string; mode: NetworkPolicyMode; message: string }
  | { kind: "not-configured"; message: string }

interface EmbeddingPreviewInput {
  enabled: boolean
  endpoint: string
}

interface VisionPreviewInput {
  enabled: boolean
  useMainLlm: boolean
  provider: LlmConfig["provider"]
  customEndpoint: string
  ollamaUrl: string
}

const WEB_SEARCH_URLS = {
  tavily: "https://api.tavily.com/search",
  serpapi: "https://serpapi.com/search",
} as const

export function describeWebSearchPolicy(
  provider: keyof typeof WEB_SEARCH_URLS,
  policy: NetworkPolicyConfig,
): NetworkPolicyPreview {
  return describeUrlPolicy(WEB_SEARCH_URLS[provider], policy, `${provider} web search`)
}

export function describeEmbeddingPolicy(
  input: EmbeddingPreviewInput,
  policy: NetworkPolicyConfig,
): NetworkPolicyPreview {
  if (!input.enabled) {
    return { kind: "not-configured", message: "Embedding is disabled." }
  }
  const endpoint = input.endpoint.trim()
  if (!endpoint) {
    return { kind: "not-configured", message: "Embedding endpoint is not configured." }
  }
  return describeUrlPolicy(endpoint, policy, "embedding endpoint")
}

export function describeVisionPolicy(
  input: VisionPreviewInput,
  policy: NetworkPolicyConfig,
): NetworkPolicyPreview {
  if (!input.enabled) {
    return { kind: "not-configured", message: "Vision captioning is disabled." }
  }
  if (input.useMainLlm) {
    return {
      kind: "not-configured",
      message: "Vision captioning reuses the main LLM; see the LLM provider policy result.",
    }
  }

  const endpoint = visionProviderEndpoint(input)
  if (!endpoint) {
    return { kind: "not-configured", message: "Vision endpoint is not configured." }
  }
  return describeUrlPolicy(endpoint, policy, "vision caption provider")
}

export function describeUpdateCheckPolicy(policy: NetworkPolicyConfig): NetworkPolicyPreview {
  return describeUrlPolicy(
    "https://api.github.com/repos/nashsu/llm_wiki/releases/latest",
    policy,
    "update check",
  )
}

function describeUrlPolicy(
  url: string,
  policy: NetworkPolicyConfig,
  label: string,
): NetworkPolicyPreview {
  const decision = evaluateNetworkPolicy(url, policy)
  const host = decision.url.hostname || decision.url.origin || "<unparseable>"
  if (!decision.allowed) {
    return {
      kind: "blocked",
      host,
      mode: decision.policy.mode,
      message: `${label} is blocked by ${decision.policy.mode} network policy (${host}).`,
    }
  }
  if (decision.url.kind === "public") {
    return {
      kind: "cloud-allowed",
      host,
      mode: decision.policy.mode,
      message: `${label} may contact cloud host ${host}; this is allowed by ${decision.policy.mode} network policy.`,
    }
  }
  return {
    kind: "allowed",
    host,
    mode: decision.policy.mode,
    message: `${label} is allowed by ${decision.policy.mode} network policy (${host}).`,
  }
}

function visionProviderEndpoint(input: VisionPreviewInput): string {
  switch (input.provider) {
    case "openai":
      return "https://api.openai.com/v1/chat/completions"
    case "anthropic":
    case "claude-code":
      return "https://api.anthropic.com/v1/messages"
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta/models"
    case "minimax":
      return input.customEndpoint || "https://api.minimax.io/anthropic"
    case "custom":
      return input.customEndpoint
    case "ollama":
      return input.ollamaUrl
  }
}

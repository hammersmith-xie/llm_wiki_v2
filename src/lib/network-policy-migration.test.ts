import { describe, expect, it } from "vitest"
import { DEFAULT_NETWORK_POLICY } from "./network-policy"
import { seedNetworkPolicyFromConfiguredCloud } from "./network-policy-migration"
import type { LlmConfig, MultimodalConfig } from "@/stores/wiki-store"

describe("seedNetworkPolicyFromConfiguredCloud", () => {
  it("adds configured cloud endpoints to the default allowlist without adding secrets or paths", () => {
    const policy = seedNetworkPolicyFromConfiguredCloud({
      savedNetworkPolicy: null,
      llmConfig: llm({ provider: "openai", apiKey: "sk-test", model: "gpt-4o" }),
      searchConfig: { provider: "serpapi", apiKey: "serp-secret" },
      embeddingConfig: {
        enabled: true,
        endpoint: "https://api.openai.com/v1/embeddings?api_key=secret",
        apiKey: "sk-embed",
        model: "text-embedding-3-small",
      },
      multimodalConfig: multimodal({
        enabled: true,
        useMainLlm: false,
        provider: "google",
        apiKey: "gemini-key",
        model: "gemini-2.5-flash",
      }),
    })

    expect(policy).toEqual({
      ...DEFAULT_NETWORK_POLICY,
      allowedHosts: [
        "https://api.openai.com",
        "https://serpapi.com",
        "https://generativelanguage.googleapis.com",
      ],
    })
    expect(JSON.stringify(policy)).not.toContain("secret")
    expect(JSON.stringify(policy)).not.toContain("embeddings")
  })

  it("does not override an explicitly saved policy", () => {
    const saved = {
      ...DEFAULT_NETWORK_POLICY,
      mode: "local-only" as const,
      allowedHosts: [],
    }

    expect(seedNetworkPolicyFromConfiguredCloud({
      savedNetworkPolicy: saved,
      llmConfig: llm({ provider: "openai", apiKey: "sk-test" }),
    })).toBe(saved)
  })
})

function llm(overrides: Partial<LlmConfig>): LlmConfig {
  return {
    provider: "openai",
    apiKey: "",
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    maxContextSize: 204800,
    ...overrides,
  }
}

function multimodal(overrides: Partial<MultimodalConfig>): MultimodalConfig {
  return {
    enabled: false,
    useMainLlm: true,
    provider: "custom",
    apiKey: "",
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    apiMode: "chat_completions",
    concurrency: 4,
    ...overrides,
  }
}

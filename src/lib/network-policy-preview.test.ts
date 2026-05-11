import { describe, expect, it } from "vitest"
import { DEFAULT_NETWORK_POLICY } from "./network-policy"
import {
  describeEmbeddingPolicy,
  describeUpdateCheckPolicy,
  describeVisionPolicy,
  describeWebSearchPolicy,
} from "./network-policy-preview"

describe("network policy preview", () => {
  it("marks cloud web search providers as disabled in local-only mode", () => {
    const preview = describeWebSearchPolicy("tavily", {
      ...DEFAULT_NETWORK_POLICY,
      mode: "local-only",
    })

    expect(preview).toMatchObject({
      kind: "blocked",
      host: "api.tavily.com",
      mode: "local-only",
    })
    expect(preview.message).toContain("local-only")
    expect(preview.message).toContain("api.tavily.com")
  })

  it("marks allowlisted public web search providers as cloud-allowed", () => {
    expect(describeWebSearchPolicy("serpapi", {
      ...DEFAULT_NETWORK_POLICY,
      allowedHosts: ["https://serpapi.com"],
    })).toMatchObject({
      kind: "cloud-allowed",
      host: "serpapi.com",
      mode: "allowlist",
    })
  })

  it("returns not-configured for disabled embedding", () => {
    expect(describeEmbeddingPolicy({ enabled: false, endpoint: "" }, DEFAULT_NETWORK_POLICY)).toEqual({
      kind: "not-configured",
      message: "Embedding is disabled.",
    })
  })

  it("marks cloud embedding endpoints as blocked when not allowlisted", () => {
    expect(describeEmbeddingPolicy(
      { enabled: true, endpoint: "https://api.openai.com/v1/embeddings" },
      DEFAULT_NETWORK_POLICY,
    )).toMatchObject({
      kind: "blocked",
      host: "api.openai.com",
      mode: "allowlist",
    })
  })

  it("marks any-mode cloud compute as disclosed", () => {
    expect(describeVisionPolicy(
      {
        enabled: true,
        useMainLlm: false,
        provider: "openai",
        customEndpoint: "",
        ollamaUrl: "http://localhost:11434",
      },
      { ...DEFAULT_NETWORK_POLICY, mode: "any" },
    )).toMatchObject({
      kind: "cloud-allowed",
      host: "api.openai.com",
      mode: "any",
    })
  })

  it("treats main-LLM vision as indeterminate instead of pretending to know the host", () => {
    expect(describeVisionPolicy(
      {
        enabled: true,
        useMainLlm: true,
        provider: "openai",
        customEndpoint: "",
        ollamaUrl: "http://localhost:11434",
      },
      DEFAULT_NETWORK_POLICY,
    )).toEqual({
      kind: "not-configured",
      message: "Vision captioning reuses the main LLM; see the LLM provider policy result.",
    })
  })

  it("previews update check policy against GitHub releases", () => {
    expect(describeUpdateCheckPolicy({ ...DEFAULT_NETWORK_POLICY, mode: "local-only" })).toMatchObject({
      kind: "blocked",
      host: "api.github.com",
      mode: "local-only",
    })
  })
})

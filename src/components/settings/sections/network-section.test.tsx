import "@/i18n"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DEFAULT_NETWORK_POLICY } from "@/lib/network-policy"
import type { SettingsDraft } from "../settings-types"
import {
  NetworkSection,
  addNetworkPolicyAllowlistEntry,
  removeNetworkPolicyAllowlistEntry,
  setNetworkPolicyAllowLan,
  setNetworkPolicyMode,
} from "./network-section"

describe("NetworkSection", () => {
  it("renders local-first policy controls without overstating full enforcement", () => {
    const html = renderToStaticMarkup(
      <NetworkSection
        draft={draft({
          networkPolicyConfig: {
            ...DEFAULT_NETWORK_POLICY,
            mode: "any",
            allowedHosts: ["https://api.example.com"],
            allowLan: true,
          },
        })}
        setDraft={vi.fn()}
      />,
    )

    expect(html).toContain("Outbound policy")
    expect(html).toContain("Local only")
    expect(html).toContain("Allowlist")
    expect(html).toContain("Any")
    expect(html).toContain("Cloud egress allowed")
    expect(html).toContain("Existing integrations are being migrated")
    expect(html).toContain("https://api.example.com")
    expect(html).toContain("Allow LAN addresses")
  })
})

describe("network policy draft helpers", () => {
  it("switches mode while preserving allowlist and LAN preferences", () => {
    const policy = {
      ...DEFAULT_NETWORK_POLICY,
      allowedHosts: ["https://api.example.com"],
      allowLan: true,
    }

    expect(setNetworkPolicyMode(policy, "local-only")).toEqual({
      ...policy,
      mode: "local-only",
    })
  })

  it("adds normalized allowlist entries without duplicates", () => {
    const first = addNetworkPolicyAllowlistEntry(
      DEFAULT_NETWORK_POLICY,
      " HTTPS://API.EXAMPLE.COM/v1/ ",
    )
    const duplicate = addNetworkPolicyAllowlistEntry(first, "https://api.example.com")

    expect(first.allowedHosts).toEqual(["https://api.example.com"])
    expect(duplicate.allowedHosts).toEqual(["https://api.example.com"])
  })

  it("removes allowlist entries by their normalized value", () => {
    const policy = {
      ...DEFAULT_NETWORK_POLICY,
      allowedHosts: ["https://api.example.com", "localhost:11434"],
    }

    expect(removeNetworkPolicyAllowlistEntry(policy, "HTTPS://API.EXAMPLE.COM/v1")).toEqual({
      ...policy,
      allowedHosts: ["localhost:11434"],
    })
  })

  it("toggles LAN access without mutating the original policy", () => {
    const next = setNetworkPolicyAllowLan(DEFAULT_NETWORK_POLICY, true)

    expect(next.allowLan).toBe(true)
    expect(DEFAULT_NETWORK_POLICY.allowLan).toBe(false)
  })
})

function draft(overrides: Partial<SettingsDraft> = {}): SettingsDraft {
  return {
    provider: "openai",
    apiKey: "",
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    maxContextSize: 204800,
    apiMode: undefined,
    reasoning: undefined,
    embeddingEnabled: false,
    embeddingEndpoint: "",
    embeddingApiKey: "",
    embeddingModel: "",
    embeddingMaxChunkChars: undefined,
    embeddingOverlapChunkChars: undefined,
    multimodalEnabled: false,
    multimodalUseMainLlm: true,
    multimodalProvider: "custom",
    multimodalApiKey: "",
    multimodalModel: "",
    multimodalOllamaUrl: "http://localhost:11434",
    multimodalCustomEndpoint: "",
    multimodalApiMode: "chat_completions",
    multimodalConcurrency: 4,
    outputLanguage: "auto",
    maxHistoryMessages: 12,
    proxyEnabled: false,
    proxyUrl: "",
    proxyBypassLocal: true,
    networkPolicyConfig: DEFAULT_NETWORK_POLICY,
    uiLanguage: "en",
    ...overrides,
  }
}

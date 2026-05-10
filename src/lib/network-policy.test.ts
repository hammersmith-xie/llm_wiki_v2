import { describe, expect, it } from "vitest"
import {
  DEFAULT_NETWORK_POLICY,
  classifyNetworkUrl,
  evaluateNetworkPolicy,
  normalizeNetworkPolicy,
  type NetworkPolicyConfig,
} from "./network-policy"

describe("normalizeNetworkPolicy", () => {
  it("defaults to allowlist with loopback allowed", () => {
    expect(normalizeNetworkPolicy(null)).toEqual(DEFAULT_NETWORK_POLICY)
    expect(normalizeNetworkPolicy({})).toEqual(DEFAULT_NETWORK_POLICY)
  })

  it("migrates unknown modes and invalid fields to safe defaults", () => {
    const migrated = normalizeNetworkPolicy({
      mode: "cloud",
      allowedHosts: "api.openai.com",
      allowLan: "yes",
      policyVersion: 99,
    })

    expect(migrated).toEqual(DEFAULT_NETWORK_POLICY)
  })

  it("preserves valid mode, allowlist, and LAN preference", () => {
    const input: NetworkPolicyConfig = {
      mode: "allowlist",
      allowedHosts: ["https://api.example.com", "localhost:11434", " "],
      allowLan: true,
      policyVersion: 1,
    }

    expect(normalizeNetworkPolicy(input)).toEqual({
      mode: "allowlist",
      allowedHosts: ["https://api.example.com", "localhost:11434"],
      allowLan: true,
      policyVersion: 1,
    })
  })
})

describe("classifyNetworkUrl", () => {
  it("classifies localhost, IPv4 loopback, and IPv6 loopback as loopback", () => {
    expect(classifyNetworkUrl("http://localhost:11434/v1").kind).toBe("loopback")
    expect(classifyNetworkUrl("http://127.0.0.1:11434/v1").kind).toBe("loopback")
    expect(classifyNetworkUrl("http://[::1]:11434/v1").kind).toBe("loopback")
  })

  it("classifies RFC1918 addresses as LAN", () => {
    expect(classifyNetworkUrl("http://10.0.1.2:11434").kind).toBe("lan")
    expect(classifyNetworkUrl("http://172.16.0.2:11434").kind).toBe("lan")
    expect(classifyNetworkUrl("http://172.31.255.255:11434").kind).toBe("lan")
    expect(classifyNetworkUrl("http://192.168.1.50:11434").kind).toBe("lan")
  })

  it("classifies public endpoints as public", () => {
    const info = classifyNetworkUrl("https://api.openai.com/v1/chat/completions")
    expect(info).toMatchObject({
      kind: "public",
      hostname: "api.openai.com",
      origin: "https://api.openai.com",
    })
  })

  it("rejects malformed URLs", () => {
    expect(classifyNetworkUrl("not a url").kind).toBe("invalid")
  })
})

describe("evaluateNetworkPolicy", () => {
  it("allows loopback and blocks public URLs in local-only mode", () => {
    const policy: NetworkPolicyConfig = {
      ...DEFAULT_NETWORK_POLICY,
      mode: "local-only",
    }

    expect(evaluateNetworkPolicy("http://127.0.0.1:11434/v1", policy).allowed).toBe(true)
    expect(evaluateNetworkPolicy("https://api.openai.com/v1", policy)).toMatchObject({
      allowed: false,
      reason: "blocked-public",
    })
  })

  it("allows LAN in local-only mode only when allowLan is true", () => {
    const base: NetworkPolicyConfig = {
      ...DEFAULT_NETWORK_POLICY,
      mode: "local-only",
      allowLan: false,
    }

    expect(evaluateNetworkPolicy("http://192.168.1.50:11434", base).allowed).toBe(false)
    expect(
      evaluateNetworkPolicy("http://192.168.1.50:11434", { ...base, allowLan: true }).allowed,
    ).toBe(true)
  })

  it("allowlist mode only permits matching hosts or origins", () => {
    const policy: NetworkPolicyConfig = {
      ...DEFAULT_NETWORK_POLICY,
      mode: "allowlist",
      allowedHosts: ["https://api.example.com", "localhost:11434"],
    }

    expect(evaluateNetworkPolicy("https://api.example.com/v1", policy).allowed).toBe(true)
    expect(evaluateNetworkPolicy("http://localhost:11434/v1", policy).allowed).toBe(true)
    expect(evaluateNetworkPolicy("https://api.openai.com/v1", policy)).toMatchObject({
      allowed: false,
      reason: "blocked-not-allowlisted",
    })
  })

  it("any mode allows public URLs while preserving parsed metadata", () => {
    const result = evaluateNetworkPolicy("https://api.openai.com/v1", {
      ...DEFAULT_NETWORK_POLICY,
      mode: "any",
    })

    expect(result).toMatchObject({
      allowed: true,
      reason: "allowed-any",
      url: {
        hostname: "api.openai.com",
      },
    })
  })
})

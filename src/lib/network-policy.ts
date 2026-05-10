export type NetworkPolicyMode = "local-only" | "allowlist" | "any"

export interface NetworkPolicyConfig {
  mode: NetworkPolicyMode
  allowedHosts: string[]
  allowLan: boolean
  policyVersion: 1
}

export type NetworkUrlKind = "loopback" | "lan" | "public" | "invalid"

export interface NetworkUrlInfo {
  kind: NetworkUrlKind
  input: string
  protocol: string
  hostname: string
  port: string
  origin: string
}

export type NetworkPolicyDecisionReason =
  | "allowed-any"
  | "allowed-loopback"
  | "allowed-lan"
  | "allowed-allowlist"
  | "blocked-invalid-url"
  | "blocked-public"
  | "blocked-lan"
  | "blocked-not-allowlisted"

export interface NetworkPolicyDecision {
  allowed: boolean
  reason: NetworkPolicyDecisionReason
  policy: NetworkPolicyConfig
  url: NetworkUrlInfo
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicyConfig = {
  mode: "allowlist",
  allowedHosts: [],
  allowLan: false,
  policyVersion: 1,
}

export function normalizeNetworkPolicy(value: unknown): NetworkPolicyConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_NETWORK_POLICY }
  }

  const record = value as Record<string, unknown>
  const mode = isNetworkPolicyMode(record.mode) ? record.mode : DEFAULT_NETWORK_POLICY.mode
  const allowedHosts = Array.isArray(record.allowedHosts)
    ? record.allowedHosts
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : DEFAULT_NETWORK_POLICY.allowedHosts
  const allowLan =
    typeof record.allowLan === "boolean" ? record.allowLan : DEFAULT_NETWORK_POLICY.allowLan

  return {
    mode,
    allowedHosts,
    allowLan,
    policyVersion: 1,
  }
}

export function classifyNetworkUrl(input: string): NetworkUrlInfo {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return invalidUrlInfo(input)
  }

  const hostname = stripIpv6Brackets(parsed.hostname.toLowerCase())
  const info: NetworkUrlInfo = {
    kind: "public",
    input,
    protocol: parsed.protocol,
    hostname,
    port: parsed.port,
    origin: parsed.origin,
  }

  if (isLoopbackHostname(hostname)) return { ...info, kind: "loopback" }
  if (isLanHostname(hostname)) return { ...info, kind: "lan" }
  return info
}

export function evaluateNetworkPolicy(
  input: string,
  rawPolicy: unknown,
): NetworkPolicyDecision {
  const policy = normalizeNetworkPolicy(rawPolicy)
  const url = classifyNetworkUrl(input)

  if (url.kind === "invalid") {
    return { allowed: false, reason: "blocked-invalid-url", policy, url }
  }

  if (policy.mode === "any") {
    return { allowed: true, reason: "allowed-any", policy, url }
  }

  if (policy.mode === "local-only") {
    if (url.kind === "loopback") {
      return { allowed: true, reason: "allowed-loopback", policy, url }
    }
    if (url.kind === "lan") {
      return {
        allowed: policy.allowLan,
        reason: policy.allowLan ? "allowed-lan" : "blocked-lan",
        policy,
        url,
      }
    }
    return { allowed: false, reason: "blocked-public", policy, url }
  }

  if (url.kind === "loopback") {
    return { allowed: true, reason: "allowed-loopback", policy, url }
  }
  if (url.kind === "lan" && policy.allowLan) {
    return { allowed: true, reason: "allowed-lan", policy, url }
  }
  if (matchesAllowlist(url, policy.allowedHosts)) {
    return { allowed: true, reason: "allowed-allowlist", policy, url }
  }
  return { allowed: false, reason: "blocked-not-allowlisted", policy, url }
}

function isNetworkPolicyMode(value: unknown): value is NetworkPolicyMode {
  return value === "local-only" || value === "allowlist" || value === "any"
}

function invalidUrlInfo(input: string): NetworkUrlInfo {
  return {
    kind: "invalid",
    input,
    protocol: "",
    hostname: "",
    port: "",
    origin: "",
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "")
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1") return true
  if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return true
  return false
}

function isLanHostname(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = parts
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function matchesAllowlist(url: NetworkUrlInfo, allowedHosts: readonly string[]): boolean {
  const origin = url.origin.toLowerCase()
  const hostWithPort = url.port ? `${url.hostname}:${url.port}` : url.hostname
  const host = url.hostname

  return allowedHosts.some((entry) => {
    const normalized = normalizeAllowlistEntry(entry)
    return normalized === origin || normalized === hostWithPort || normalized === host
  })
}

function normalizeAllowlistEntry(entry: string): string {
  const trimmed = entry.trim().toLowerCase().replace(/\/+$/, "")
  if (!trimmed) return ""
  try {
    const parsed = new URL(trimmed)
    return parsed.origin.toLowerCase()
  } catch {
    return stripIpv6Brackets(trimmed)
  }
}

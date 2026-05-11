import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_NETWORK_POLICY, evaluateNetworkPolicy } from "./network-policy"
import {
  appendEgressEvent,
  buildEgressEvent,
  readEgressReport,
} from "./egress-log"

vi.mock("@/commands/fs", () => ({
  appendFile: vi.fn(async () => {}),
  createDirectory: vi.fn(async () => {}),
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => {}),
}))

import { appendFile, createDirectory, readFile, writeFile } from "@/commands/fs"

const mockAppendFile = vi.mocked(appendFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockAppendFile.mockReset()
  mockCreateDirectory.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
})

describe("egress log", () => {
  it("appends allow/block metadata without URL query, headers, or payload", async () => {
    const decision = evaluateNetworkPolicy(
      "https://serpapi.com/search?api_key=secret&q=private",
      { ...DEFAULT_NETWORK_POLICY, mode: "any" },
    )

    await appendEgressEvent("/project", {
      timestamp: "2026-05-11T00:00:00.000Z",
      feature: "web-search",
      provider: "serpapi",
      reason: "web search",
      decision,
      requestBytes: 123,
      transport: "http",
    })

    expect(mockCreateDirectory).toHaveBeenCalledWith("/project/.llm-wiki")
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/project/.llm-wiki/egress.jsonl",
      expect.stringContaining("\"feature\":\"web-search\""),
    )
    expect(mockWriteFile).not.toHaveBeenCalled()

    const raw = String(mockAppendFile.mock.calls[0][1])
    expect(raw).not.toContain("api_key")
    expect(raw).not.toContain("secret")
    expect(raw).not.toContain("private")

    const event = JSON.parse(raw)
    expect(event).toMatchObject({
      schemaVersion: 1,
      timestamp: "2026-05-11T00:00:00.000Z",
      feature: "web-search",
      provider: "serpapi",
      reason: "web search",
      transport: "http",
      allowed: true,
      decisionReason: "allowed-any",
      policyMode: "any",
      url: {
        protocol: "https:",
        hostname: "serpapi.com",
        origin: "https://serpapi.com",
        kind: "public",
      },
      requestBytes: 123,
    })
  })

  it("summarizes the last seven days and skips malformed lines", async () => {
    const now = new Date("2026-05-11T12:00:00.000Z")
    const recentAllowed = buildEgressEvent({
      timestamp: "2026-05-11T00:00:00.000Z",
      feature: "llm",
      provider: "openai",
      reason: "chat completion",
      transport: "http",
      decision: evaluateNetworkPolicy("https://api.openai.com/v1/chat/completions", {
        ...DEFAULT_NETWORK_POLICY,
        mode: "any",
      }),
    })
    const recentBlocked = buildEgressEvent({
      timestamp: "2026-05-10T00:00:00.000Z",
      feature: "llm",
      provider: "openai",
      reason: "chat completion",
      transport: "http",
      decision: evaluateNetworkPolicy("https://api.openai.com/v1/chat/completions", {
        ...DEFAULT_NETWORK_POLICY,
        mode: "local-only",
      }),
    })
    const old = buildEgressEvent({
      timestamp: "2026-04-01T00:00:00.000Z",
      feature: "web-search",
      provider: "tavily",
      reason: "web search",
      transport: "http",
      decision: evaluateNetworkPolicy("https://api.tavily.com/search", {
        ...DEFAULT_NETWORK_POLICY,
        mode: "any",
      }),
    })

    mockReadFile.mockResolvedValueOnce(
      [
        JSON.stringify(recentAllowed),
        "{not json",
        JSON.stringify(recentBlocked),
        JSON.stringify(old),
        "",
      ].join("\n"),
    )

    const report = await readEgressReport("/project", { now, days: 7 })

    expect(report.events).toHaveLength(2)
    expect(report.warnings).toHaveLength(1)
    expect(report.groups).toEqual([
      {
        key: "api.openai.com|openai|chat completion|llm",
        host: "api.openai.com",
        feature: "llm",
        provider: "openai",
        reason: "chat completion",
        allowedCount: 1,
        blockedCount: 1,
        lastSeenAt: "2026-05-11T00:00:00.000Z",
      },
    ])
  })
})

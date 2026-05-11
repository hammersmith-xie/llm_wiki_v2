import { describe, it, expect, vi } from "vitest"
import { DEFAULT_NETWORK_POLICY } from "./network-policy"
import { NetworkPolicyBlockedError } from "./tauri-fetch"
import { isFetchNetworkError, streamChat } from "./llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

/**
 * Guards for cross-webview error detection. Tauri renders the frontend
 * with WebKit on macOS/Linux and Edge WebView2 (Chromium) on Windows,
 * and each backend phrases fetch failures differently. These tests pin
 * down that every real-world error shape gets classified as a network
 * error so the user sees a helpful message instead of a raw stack.
 */
describe("isFetchNetworkError — cross-webview fetch failures", () => {
  it("recognises WebKit's 'Load failed' (macOS / Linux GTK)", () => {
    const e = new Error("Load failed")
    expect(isFetchNetworkError(e)).toBe(true)
  })

  it("recognises Chromium/Edge's TypeError: Failed to fetch (Windows)", () => {
    // Real Chromium throws a TypeError with this exact shape.
    const e = new TypeError("Failed to fetch")
    expect(isFetchNetworkError(e)).toBe(true)
  })

  it("recognises any TypeError (Chromium fetch failure class)", () => {
    // Chromium also throws TypeError with messages like "NetworkError
    // when attempting to fetch resource." — the name alone is enough.
    const e = new TypeError("NetworkError when attempting to fetch resource.")
    expect(isFetchNetworkError(e)).toBe(true)
  })

  it("recognises messages containing 'network error' (mid-stream drops)", () => {
    const e = new Error("The network error occurred while reading")
    expect(isFetchNetworkError(e)).toBe(true)
  })

  it("rejects AbortError (user cancelled)", () => {
    const e = new Error("The operation was aborted.")
    e.name = "AbortError"
    expect(isFetchNetworkError(e)).toBe(false)
  })

  it("rejects plain application errors (HTTP 4xx surfaced as Error)", () => {
    const e = new Error("HTTP 401: Unauthorized")
    expect(isFetchNetworkError(e)).toBe(false)
  })

  it("rejects non-Error values (strings, null, objects)", () => {
    expect(isFetchNetworkError("boom")).toBe(false)
    expect(isFetchNetworkError(null)).toBe(false)
    expect(isFetchNetworkError(undefined)).toBe(false)
    expect(isFetchNetworkError({ message: "Load failed" })).toBe(false)
  })
})

describe("streamChat network policy", () => {
  it("blocks public cloud providers in local-only mode before fetch", async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>()
    const error = await runStreamChat(openAiConfig(), fetchImpl, {
      ...DEFAULT_NETWORK_POLICY,
      mode: "local-only",
    })

    expect(error).toBeInstanceOf(NetworkPolicyBlockedError)
    expect(error?.message).toContain("local-only")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("allows loopback Ollama in local-only mode", async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () =>
      streamResponse("data: {\"message\":{\"content\":\"ok\"}}\n\ndata: [DONE]\n\n"),
    )
    const error = await runStreamChat(ollamaConfig(), fetchImpl, {
      ...DEFAULT_NETWORK_POLICY,
      mode: "local-only",
    })

    expect(error).toBeNull()
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:11434/v1/chat/completions")
  })
})

async function runStreamChat(
  config: LlmConfig,
  fetchImpl: typeof globalThis.fetch,
  policy: typeof DEFAULT_NETWORK_POLICY,
): Promise<Error | null> {
  let error: Error | null = null
  await streamChat(
    config,
    [{ role: "user", content: "hello" }],
    {
      onToken: () => {},
      onDone: () => {},
      onError: (err) => {
        error = err
      },
    },
    undefined,
    {
      networkPolicy: policy,
      fetchImpl,
    },
  )
  return error
}

function streamResponse(body: string): Response {
  return new Response(new TextEncoder().encode(body), { status: 200 })
}

function openAiConfig(): LlmConfig {
  return {
    provider: "openai",
    apiKey: "sk-test",
    model: "gpt-test",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    maxContextSize: 204800,
  }
}

function ollamaConfig(): LlmConfig {
  return {
    provider: "ollama",
    apiKey: "",
    model: "llama3",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    maxContextSize: 204800,
  }
}

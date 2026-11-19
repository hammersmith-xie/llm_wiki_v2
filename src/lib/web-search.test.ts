import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_NETWORK_POLICY, type NetworkPolicyConfig } from "@/lib/network-policy"
import { hasConfiguredSearchProvider, webSearch } from "./web-search"

const fetchMock = vi.fn<typeof fetch>()
const localOnlyPolicy: NetworkPolicyConfig = {
  ...DEFAULT_NETWORK_POLICY,
  mode: "local-only",
}
const anyPolicy: NetworkPolicyConfig = {
  ...DEFAULT_NETWORK_POLICY,
  mode: "any",
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  })
}

describe("webSearch", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("normalizes Tavily results", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      results: [
        { title: "A", url: "https://www.example.com/a", content: "Alpha" },
      ],
    }))

    const out = await webSearch("alpha", { provider: "tavily", apiKey: "tvly" }, 3, anyPolicy)

    expect(fetchMock).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({
      method: "POST",
    }))
    expect(out).toEqual([
      { title: "A", url: "https://www.example.com/a", snippet: "Alpha", source: "example.com" },
    ])
  })

  it("calls SerpApi Google Search and normalizes organic results", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      organic_results: [
        { title: "Serp result", link: "https://www.serp.example/page", snippet: "Snippet" },
        { title: "Second", link: "https://docs.example/item", snippet: "More" },
      ],
    }))

    const out = await webSearch("knowledge graph", { provider: "serpapi", apiKey: "serp" }, 1, anyPolicy)
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))

    expect(parsed.origin + parsed.pathname).toBe("https://serpapi.com/search")
    expect(parsed.searchParams.get("engine")).toBe("google")
    expect(parsed.searchParams.get("q")).toBe("knowledge graph")
    expect(parsed.searchParams.get("api_key")).toBe("serp")
    expect(parsed.searchParams.get("num")).toBe("1")
    expect(init).toEqual(expect.objectContaining({ method: "GET" }))
    expect(out).toEqual([
      { title: "Serp result", url: "https://www.serp.example/page", snippet: "Snippet", source: "serp.example" },
    ])
  })

  it("uses SerpApi provider-specific config and selected engine", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      news_results: [
        { title: "News", link: "https://news.example/story", snippet: "Fresh" },
      ],
    }))

    const out = await webSearch(
      "ai policy",
      {
        provider: "serpapi",
        apiKey: "",
        providerConfigs: {
          tavily: { apiKey: "tavily-key" },
          serpapi: { apiKey: "serp-key", serpApiEngine: "google_news" },
        },
      },
      5,
      anyPolicy,
    )
    const parsed = new URL(String(fetchMock.mock.calls[0][0]))

    expect(parsed.searchParams.get("engine")).toBe("google_news")
    expect(parsed.searchParams.get("api_key")).toBe("serp-key")
    expect(out).toEqual([
      { title: "News", url: "https://news.example/story", snippet: "Fresh", source: "news.example" },
    ])
  })

  it("calls SearXNG without an API key and normalizes JSON results", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      results: [
        {
          title: "SearXNG result",
          url: "https://www.example.org/page",
          content: "Snippet",
          engine: "duckduckgo",
        },
        {
          title: "No URL",
          content: "Dropped",
        },
      ],
    }))

    const out = await webSearch(
      "local search",
      {
        provider: "searxng",
        apiKey: "",
        providerConfigs: {
          searxng: {
            searXngUrl: "http://127.0.0.1:8888/meta",
            searXngCategories: ["general", "science"],
          },
        },
      },
      5,
      anyPolicy,
    )
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))

    expect(parsed.origin + parsed.pathname).toBe("http://127.0.0.1:8888/meta/search")
    expect(parsed.searchParams.get("q")).toBe("local search")
    expect(parsed.searchParams.get("format")).toBe("json")
    expect(parsed.searchParams.get("categories")).toBe("general,science")
    expect(init).toEqual(expect.objectContaining({ method: "GET" }))
    expect(out).toEqual([
      {
        title: "SearXNG result",
        url: "https://www.example.org/page",
        snippet: "Snippet",
        source: "example.org",
      },
    ])
  })

  it("preserves a SearXNG /search subpath instead of appending it twice", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }))

    await webSearch(
      "ai",
      { provider: "searxng", apiKey: "", searXngUrl: "https://search.example.com/searxng/search" },
      2,
      anyPolicy,
    )

    const parsed = new URL(String(fetchMock.mock.calls[0][0]))
    expect(parsed.origin + parsed.pathname).toBe("https://search.example.com/searxng/search")
  })

  it("surfaces SerpApi JSON errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API key" }))

    await expect(webSearch("x", { provider: "serpapi", apiKey: "bad" }, 5, anyPolicy))
      .rejects.toThrow("SerpApi search failed: Invalid API key")
  })

  it("requires a configured search provider and key", async () => {
    await expect(webSearch("x", { provider: "none", apiKey: "" }, 5))
      .rejects.toThrow("Select a search provider")
    await expect(webSearch("x", { provider: "serpapi", apiKey: "" }, 5, anyPolicy))
      .rejects.toThrow("Tavily or SerpApi API key")
    await expect(webSearch("x", { provider: "searxng", apiKey: "" }, 5, anyPolicy))
      .rejects.toThrow("SearXNG instance URL")
  })

  it("detects configured search providers by provider-specific requirements", () => {
    expect(hasConfiguredSearchProvider({ provider: "none", apiKey: "" })).toBe(false)
    expect(hasConfiguredSearchProvider({ provider: "tavily", apiKey: "tvly" })).toBe(true)
    expect(hasConfiguredSearchProvider({ provider: "serpapi", apiKey: "" })).toBe(false)
    expect(hasConfiguredSearchProvider({
      provider: "searxng",
      apiKey: "",
      providerConfigs: { searxng: { searXngUrl: "http://localhost:8888" } },
    })).toBe(true)
  })

  it("blocks Tavily in local-only mode before issuing a request", async () => {
    await expect(webSearch("alpha", { provider: "tavily", apiKey: "tvly" }, 3, localOnlyPolicy))
      .rejects.toThrow("blocked by local-only network policy")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("blocks SerpApi in local-only mode before issuing a request", async () => {
    await expect(webSearch("alpha", { provider: "serpapi", apiKey: "serp" }, 3, localOnlyPolicy))
      .rejects.toThrow("blocked by local-only network policy")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("blocks public SearXNG in local-only mode before issuing a request", async () => {
    await expect(webSearch("alpha", { provider: "searxng", apiKey: "", searXngUrl: "https://search.example.com" }, 3, localOnlyPolicy))
      .rejects.toThrow("blocked by local-only network policy")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("allows loopback SearXNG in local-only mode", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }))

    await webSearch("alpha", { provider: "searxng", apiKey: "", searXngUrl: "http://127.0.0.1:8888" }, 3, localOnlyPolicy)

    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

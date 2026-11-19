/**
 * Read-only real smoke tests for a running LLM Wiki desktop app.
 *
 * These tests call http://127.0.0.1:19828/api/v1 and are opt-in because
 * they require the Tauri app to be running with Settings -> API Server enabled.
 *
 * Example:
 *   RUN_API_TESTS=1 \
 *   API_TOKEN=<token-if-required> \
 *   npx vitest run src/lib/api-server.real-llm.test.ts
 *
 * Set API_PROJECT_ID to force a specific project. Otherwise the test uses the
 * current project from /projects, or the first registered project.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { API_SERVER_BASE_URL } from "./api-server-constants"

const ENABLED = process.env.RUN_API_TESTS === "1" || process.env.RUN_LLM_TESTS === "1"
const BASE_URL = process.env.API_BASE_URL ?? API_SERVER_BASE_URL
const API_TOKEN = process.env.API_TOKEN ?? process.env.LLM_WIKI_API_TOKEN ?? ""
const REQUEST_TIMEOUT_MS = 30_000

interface ApiEnvelope {
  ok?: boolean
  error?: string
  [key: string]: unknown
}

interface ApiHealth extends ApiEnvelope {
  status?: string
  enabled?: boolean
  authRequired?: boolean
  authConfigured?: boolean
  allowUnauthenticated?: boolean
  tokenSource?: "env" | "store" | "none"
}

interface ApiProject {
  id: string
  name: string
  path: string
  current: boolean
}

interface ApiFileNode {
  name: string
  path: string
  isDir: boolean
  size?: number
  children?: ApiFileNode[]
}

interface SearchHit {
  path: string
  title: string
  snippet: string
  score: number
  content?: string
}

interface GraphNode {
  id: string
  label: string
  nodeType: string
  path: string
  linkCount: number
}

interface GraphEdge {
  source: string
  target: string
  weight: number
}

let serverUnavailableReason: string | null = null
let authUnavailableReason: string | null = null
let selectedProject: ApiProject | null = null

function endpoint(path: string): string {
  return `${BASE_URL}${path}`
}

function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}
}

async function api<T extends ApiEnvelope>(
  path: string,
  init: RequestInit = {},
  auth: "default" | "none" = "default",
): Promise<{ status: number; body: T }> {
  const headers = {
    ...(auth === "none" ? {} : authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  }
  const response = await fetch(endpoint(path), { ...init, headers })
  const text = await response.text()
  const body = (text ? JSON.parse(text) : {}) as T
  return { status: response.status, body }
}

async function health(): Promise<ApiHealth> {
  const { status, body } = await api<ApiHealth>("/api/v1/health", {}, "none")
  if (status !== 200 || body.ok !== true) {
    throw new Error(`API health check failed with HTTP ${status}: ${JSON.stringify(body)}`)
  }
  return body
}

function ensureServer(ctx: { skip: () => void }): void {
  if (serverUnavailableReason) {
    console.warn(serverUnavailableReason)
    ctx.skip()
  }
}

function ensureAuthenticatedApi(ctx: { skip: () => void }): void {
  ensureServer(ctx)
  if (authUnavailableReason) {
    console.warn(authUnavailableReason)
    ctx.skip()
  }
}

function ensureProject(ctx: { skip: () => void }): ApiProject {
  ensureAuthenticatedApi(ctx)
  if (!selectedProject) {
    console.warn("Skipping project API smoke check because no project is registered.")
    ctx.skip()
    throw new Error("No project is registered.")
  }
  return selectedProject
}

function flatten(nodes: ApiFileNode[]): ApiFileNode[] {
  const out: ApiFileNode[] = []
  const visit = (items: ApiFileNode[]) => {
    for (const item of items) {
      out.push(item)
      if (item.children) visit(item.children)
    }
  }
  visit(nodes)
  return out
}

function firstTextFile(nodes: ApiFileNode[]): ApiFileNode | undefined {
  return flatten(nodes).find(
    (node) =>
      !node.isDir &&
      /(^|\/)(purpose|schema)\.md$|\.(md|mdx|txt|json|yaml|yml|csv|html|htm|xml|rtf|log)$/i.test(node.path),
  )
}

function searchQueryFromContent(content: string, fallback: string): string {
  const title =
    content.match(/^title:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim() ??
    content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (title && title.length >= 2) return title

  const token = content
    .replace(/```[\s\S]*?```/g, " ")
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((value) => value.trim())
    .find((value) => value.length >= 2 && !["title", "type", "the", "and", "for"].includes(value.toLowerCase()))
  return token ?? fallback
}

describe.skipIf(!ENABLED)("local API v1 smoke against a running desktop app", () => {
  beforeAll(async () => {
    try {
      const h = await health()
      if (h.status !== "running" || h.enabled !== true) {
        serverUnavailableReason = `Local API is reachable at ${BASE_URL}, but it is not enabled/running: ${JSON.stringify(h)}`
        return
      }
      if (h.authRequired && !h.allowUnauthenticated && !API_TOKEN) {
        authUnavailableReason =
          "API requires auth. Re-run with API_TOKEN=<token> or enable Settings -> API Server -> Allow access without a token."
        return
      }

      const projectsResp = await api<ApiEnvelope & { projects: ApiProject[]; currentProject?: ApiProject | null }>(
        "/api/v1/projects",
      )
      if (projectsResp.status !== 200 || !Array.isArray(projectsResp.body.projects)) {
        authUnavailableReason = `Could not list projects with current auth settings: HTTP ${projectsResp.status} ${JSON.stringify(projectsResp.body)}`
        return
      }
      const explicitProjectId = process.env.API_PROJECT_ID
      selectedProject =
        projectsResp.body.projects.find((project) => project.id === explicitProjectId) ??
        projectsResp.body.currentProject ??
        projectsResp.body.projects[0] ??
        null
    } catch (err) {
      serverUnavailableReason = `App is not running or the local API is unreachable at ${BASE_URL}. Launch LLM Wiki first, then re-run. ${String(err)}`
    }
  }, 5_000)

  it("reports server health and auth mode", async (ctx) => {
    ensureServer(ctx)
    const h = await health()
    expect(h.status).toBe("running")
    expect(h.enabled).toBe(true)
    expect(typeof h.authRequired).toBe("boolean")
    expect(typeof h.authConfigured).toBe("boolean")
    expect(typeof h.allowUnauthenticated).toBe("boolean")
    expect(["env", "store", "none"]).toContain(h.tokenSource)
  }, REQUEST_TIMEOUT_MS)

  it("lists projects and selects a target project", async (ctx) => {
    ensureAuthenticatedApi(ctx)
    const { status, body } = await api<ApiEnvelope & { projects: ApiProject[]; currentProject?: ApiProject | null }>(
      "/api/v1/projects",
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.projects)).toBe(true)
    expect(selectedProject).toBeTruthy()
    expect(body.projects.some((project) => project.id === selectedProject?.id)).toBe(true)
  }, REQUEST_TIMEOUT_MS)

  it("reads a text-like project file when one is available", async (ctx) => {
    const project = ensureProject(ctx)
    const filesResp = await api<ApiEnvelope & { files: ApiFileNode[] }>(
      `/api/v1/projects/${encodeURIComponent(project.id)}/files?root=all&recursive=true&maxFiles=10000`,
    )
    expect(filesResp.status).toBe(200)
    expect(filesResp.body.ok).toBe(true)
    const file = firstTextFile(filesResp.body.files)
    if (!file) {
      console.warn(`Skipping file-content smoke check because project ${project.id} has no text-like public file.`)
      ctx.skip()
    }

    const contentResp = await api<ApiEnvelope & { path: string; content: string }>(
      `/api/v1/projects/${encodeURIComponent(project.id)}/files/content?path=${encodeURIComponent(file!.path)}`,
    )
    expect(contentResp.status).toBe(200)
    expect(contentResp.body.ok).toBe(true)
    expect(contentResp.body.path).toBe(file!.path)
    expect(typeof contentResp.body.content).toBe("string")
  }, REQUEST_TIMEOUT_MS)

  it("searches the target project when a query seed is available", async (ctx) => {
    const project = ensureProject(ctx)
    const filesResp = await api<ApiEnvelope & { files: ApiFileNode[] }>(
      `/api/v1/projects/${encodeURIComponent(project.id)}/files?root=wiki&recursive=true&maxFiles=10000`,
    )
    expect(filesResp.status).toBe(200)
    const file = firstTextFile(filesResp.body.files)
    if (!file) {
      console.warn(`Skipping search smoke check because project ${project.id} has no wiki text file.`)
      ctx.skip()
    }

    const contentResp = await api<ApiEnvelope & { content: string }>(
      `/api/v1/projects/${encodeURIComponent(project.id)}/files/content?path=${encodeURIComponent(file!.path)}`,
    )
    expect(contentResp.status).toBe(200)
    const query = searchQueryFromContent(contentResp.body.content, file!.name.replace(/\.[^.]+$/, ""))

    const searchResp = await api<ApiEnvelope & { mode: string; results: SearchHit[] }>(
      `/api/v1/projects/${encodeURIComponent(project.id)}/search`,
      {
        method: "POST",
        body: JSON.stringify({ query, topK: 10, includeContent: false }),
      },
    )
    expect(searchResp.status).toBe(200)
    expect(searchResp.body.ok).toBe(true)
    expect(["keyword", "vector", "hybrid"]).toContain(searchResp.body.mode)
    expect(Array.isArray(searchResp.body.results)).toBe(true)
  }, REQUEST_TIMEOUT_MS)

  it("returns the target project graph", async (ctx) => {
    const project = ensureProject(ctx)
    const graphResp = await api<ApiEnvelope & { nodes: GraphNode[]; edges: GraphEdge[] }>(
      `/api/v1/projects/${encodeURIComponent(project.id)}/graph?limit=1000`,
    )
    expect(graphResp.status).toBe(200)
    expect(graphResp.body.ok).toBe(true)
    expect(Array.isArray(graphResp.body.nodes)).toBe(true)
    expect(Array.isArray(graphResp.body.edges)).toBe(true)
  }, REQUEST_TIMEOUT_MS)

  it("reports chat as not implemented in API v1", async (ctx) => {
    const project = ensureProject(ctx)
    const chatResp = await api<ApiEnvelope>(
      `/api/v1/projects/${encodeURIComponent(project.id)}/chat`,
      {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      },
    )
    expect(chatResp.status).toBe(501)
    expect(chatResp.body.ok).toBe(false)
  }, REQUEST_TIMEOUT_MS)
})

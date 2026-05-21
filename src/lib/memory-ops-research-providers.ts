import { readFile } from "@/commands/fs"
import type { SearchApiConfig } from "@/stores/wiki-store"
import { redactSensitiveText } from "@/lib/audit-redaction"
import { parseFrontmatter } from "@/lib/frontmatter"
import { getFileName, normalizePath } from "@/lib/path-utils"
import {
  buildMemoryOpsResearchPlan,
  claimsForResearchPlan,
  localPagesForResearchPlan,
  pageTitleForResearch,
  webQueriesForResearchPlan,
} from "@/lib/memory-ops-research-plan"
import {
  hasConfiguredSearchProvider,
  webSearch,
  type WebSearchResult,
} from "@/lib/web-search"
import type { RunMemoryOpsResearchEvidenceOptions } from "@/lib/memory-ops-research"
import type {
  MemoryOpsResearchCandidate,
  MemoryOpsResearchEvidenceItem,
  MemoryOpsResearchEvidenceStance,
  MemoryOpsResearchProviderKind,
  MemoryOpsResearchProviderResult,
} from "@/lib/memory-ops-research-types"

const DEFAULT_MAX_RESULTS_PER_PROVIDER = 5

export async function runMemoryOpsResearchProvider(
  projectPath: string,
  candidate: MemoryOpsResearchCandidate,
  provider: MemoryOpsResearchProviderKind,
  options: RunMemoryOpsResearchEvidenceOptions,
): Promise<MemoryOpsResearchProviderResult> {
  const startedAt = performance.now()
  try {
    if (provider === "local") {
      return withDuration(
        await runLocalEvidenceProvider(projectPath, candidate, options),
        startedAt,
      )
    }
    if (provider === "web-search") {
      return withDuration(
        await runWebSearchEvidenceProvider(candidate, options),
        startedAt,
      )
    }
    return withDuration(
      await runDeepResearchEvidenceProvider(candidate, options),
      startedAt,
    )
  } catch (err) {
    return withDuration({
      provider,
      status: "error",
      evidence: [],
      warnings: [errorMessage(err)],
      durationMs: 0,
    }, startedAt)
  }
}

async function runLocalEvidenceProvider(
  projectPath: string,
  candidate: MemoryOpsResearchCandidate,
  options: RunMemoryOpsResearchEvidenceOptions,
): Promise<MemoryOpsResearchProviderResult> {
  const read = options.readFileImpl ?? readFile
  const maxResults = positiveInteger(options.maxResultsPerProvider, DEFAULT_MAX_RESULTS_PER_PROVIDER)
  const evidence: MemoryOpsResearchEvidenceItem[] = []
  const warnings: string[] = []
  const plan = buildMemoryOpsResearchPlan(candidate, options.snapshot)

  for (const page of localPagesForResearchPlan(plan, options.snapshot)) {
    evidence.push({
      id: evidenceId("local", candidate.id, page.path),
      provider: "local",
      stance: inferStance(candidate, page.content),
      title: pageTitleForResearch(page),
      path: toProjectRelativePath(options.snapshot!.projectPath, page.path),
      source: "wiki",
      snippet: summarizeText(parseFrontmatter(page.content).body || page.content),
      score: page.evidence?.risk.flags.length ? 0.8 : 0.7,
    })
  }

  for (const claim of claimsForResearchPlan(plan, options.snapshot)) {
    evidence.push({
      id: evidenceId("local", candidate.id, claim.claim_id),
      provider: "local",
      stance: claim.status === "contradicted" || claim.status === "superseded"
        ? "contradict"
        : claim.source_refs.length > 0
          ? "support"
          : "neutral",
      title: claim.page_title ?? claim.claim_id,
      path: claim.page_path,
      source: "claim",
      snippet: claim.scope === "private" ? "[REDACTED:private]" : summarizeText(claim.text),
      publishedAt: claim.last_confirmed,
      score: Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : 0.5,
    })
  }

  if (candidate.targetPath && evidence.length === 0) {
    try {
      const content = await read(resolveProjectPath(projectPath, candidate.targetPath))
      const parsed = parseFrontmatter(content)
      const title =
        scalar(parsed.frontmatter?.title) ??
        firstHeading(parsed.body) ??
        getFileName(candidate.targetPath)
      evidence.push({
        id: evidenceId("local", candidate.id, candidate.targetPath),
        provider: "local",
        stance: inferStance(candidate, content),
        title,
        path: candidate.targetPath,
        source: "wiki",
        snippet: summarizeText(parsed.body || content),
        score: 0.7,
      })
    } catch (err) {
      warnings.push(`Could not read local target ${candidate.targetPath}: ${errorMessage(err)}`)
    }
  }

  return {
    provider: "local",
    status: evidence.length > 0 ? "ok" : "unavailable",
    evidence: evidence.slice(0, maxResults),
    warnings,
    durationMs: 0,
  }
}

async function runWebSearchEvidenceProvider(
  candidate: MemoryOpsResearchCandidate,
  options: RunMemoryOpsResearchEvidenceOptions,
): Promise<MemoryOpsResearchProviderResult> {
  const config = options.searchConfig
  if (!isSearchConfigured(config)) {
    return unavailable("web-search", "Web search provider is not configured.")
  }

  const maxResults = positiveInteger(options.maxResultsPerProvider, DEFAULT_MAX_RESULTS_PER_PROVIDER)
  const search = options.webSearchImpl ?? webSearch
  const plan = buildMemoryOpsResearchPlan(candidate, options.snapshot)
  const query = webQueriesForResearchPlan(plan, "all")[0] ?? candidate.query
  const results = await search(query, config, maxResults)
  return {
    provider: "web-search",
    status: "ok",
    evidence: results.map((result, index) =>
      webResultToEvidence(candidate, result, index, "web-search"),
    ),
    warnings: [],
    durationMs: 0,
  }
}

async function runDeepResearchEvidenceProvider(
  candidate: MemoryOpsResearchCandidate,
  options: RunMemoryOpsResearchEvidenceOptions,
): Promise<MemoryOpsResearchProviderResult> {
  const config = options.searchConfig
  if (!isSearchConfigured(config)) {
    return unavailable(
      "deep-research",
      "Deep Research evidence requires a configured web search provider.",
    )
  }

  const maxResults = positiveInteger(options.maxResultsPerProvider, DEFAULT_MAX_RESULTS_PER_PROVIDER)
  const search = options.webSearchImpl ?? webSearch
  const plan = buildMemoryOpsResearchPlan(candidate, options.snapshot)
  const queries = webQueriesForResearchPlan(plan, "deep")
  const perQueryLimit = Math.max(2, Math.ceil(maxResults / Math.max(1, queries.length)))
  const warnings: string[] = []
  const rawResults: WebSearchResult[] = []

  for (const query of queries) {
    try {
      rawResults.push(...await search(query, config, perQueryLimit))
    } catch (err) {
      warnings.push(`Deep Research query failed for "${query}": ${errorMessage(err)}`)
    }
  }

  const uniqueResults = uniqueWebResults(rawResults).slice(0, maxResults)
  return {
    provider: "deep-research",
    status: warnings.length > 0 && uniqueResults.length === 0 ? "error" : "ok",
    evidence: uniqueResults.map((result, index) =>
      webResultToEvidence(candidate, result, index, "deep-research"),
    ),
    warnings,
    durationMs: 0,
  }
}

function webResultToEvidence(
  candidate: MemoryOpsResearchCandidate,
  result: WebSearchResult,
  index: number,
  provider: Extract<MemoryOpsResearchProviderKind, "web-search" | "deep-research">,
): MemoryOpsResearchEvidenceItem {
  return {
    id: evidenceId(provider, candidate.id, String(index), result.url),
    provider,
    stance: inferStance(candidate, `${result.title}\n${result.snippet}`),
    title: result.title || "Untitled result",
    url: result.url,
    source: result.source,
    snippet: summarizeText(result.snippet),
    score: Math.max(0, 1 - index * 0.1),
  }
}

function inferStance(
  candidate: MemoryOpsResearchCandidate,
  text: string,
): MemoryOpsResearchEvidenceStance {
  const value = text.toLowerCase()
  if (/contradict|conflict|superseded|obsolete|deprecated|outdated|stale/.test(value)) {
    return "contradict"
  }
  const tokens = tokenSet(candidate.query)
  if (tokens.size === 0) return "unknown"
  let matches = 0
  for (const token of tokens) {
    if (value.includes(token)) matches += 1
  }
  if (matches >= Math.max(1, Math.min(3, Math.ceil(tokens.size / 3)))) return "support"
  return "neutral"
}

function resolveProjectPath(projectPath: string, targetPath: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(targetPath)
  if (normalized.split("/").includes("..")) {
    throw new Error(`Research target path contains parent traversal: ${targetPath}`)
  }
  if (normalized.startsWith(pp + "/")) return normalized
  if (normalized.startsWith("/")) {
    if (normalized === pp || normalized.startsWith(`${pp}/`)) return normalized
    throw new Error(`Research target path escapes project root: ${targetPath}`)
  }
  return `${pp}/${normalized}`
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

function unavailable(
  provider: MemoryOpsResearchProviderKind,
  warning: string,
): MemoryOpsResearchProviderResult {
  return {
    provider,
    status: "unavailable",
    evidence: [],
    warnings: [warning],
    durationMs: 0,
  }
}

function isSearchConfigured(
  config: SearchApiConfig | undefined,
): config is SearchApiConfig {
  return Boolean(config && hasConfiguredSearchProvider(config))
}

function withDuration<T extends MemoryOpsResearchProviderResult>(
  result: T,
  startedAt: number,
): T {
  return {
    ...result,
    durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
  }
}

function uniqueWebResults(results: readonly WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>()
  const unique: WebSearchResult[] = []
  for (const result of results) {
    const key = (result.url || `${result.title}:${result.snippet}`).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(result)
  }
  return unique
}

function evidenceId(...parts: string[]): string {
  return parts
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9:_/-]+/g, "-")
    .replace(/-+/g, "-")
}

function summarizeText(value: string, maxLength = 360): string {
  const normalized = redactSensitiveText(value.replace(/\s+/g, " ").trim())
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`
}

function tokenSet(value: string): Set<string> {
  const normalized = value.toLowerCase()
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []
  const cjk = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []
  return new Set([...latin, ...cjk])
}

function scalar(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function firstHeading(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim()
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (Number.isInteger(value) && value! > 0) return value!
  return fallback
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

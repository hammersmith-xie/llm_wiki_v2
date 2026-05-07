import { appendAuditEvent } from "@/lib/audit-timeline"
import { recordMemoryOpsMaintenanceEvent } from "@/lib/memory-ops"
import { normalizePath } from "@/lib/path-utils"
import type { SearchResult } from "@/lib/search"
import type { ReviewItem } from "@/stores/review-store"

export interface PageReferenceForAudit {
  title?: string
  path: string
}

export interface AppendSearchAuditInput {
  query: string
  results: readonly SearchResult[]
  actor?: "user" | "system" | "agent"
}

export interface AppendQueryAuditInput {
  query: string
  referencedPages: readonly PageReferenceForAudit[]
}

export interface AppendReviewResolveAuditInput {
  item: ReviewItem
  resolvedAction: string
  outcome?: string
}

export async function appendSearchAuditEvent(
  projectPath: string,
  input: AppendSearchAuditInput,
): Promise<void> {
  const query = input.query.trim()
  if (!query) return

  const resultSummaries = input.results.slice(0, 10).map((result, index) => ({
    path: toProjectRelativePath(projectPath, result.path),
    title: result.title,
    snippet: result.snippet,
    rank: index + 1,
    score: result.score,
    streams: streamsForSearchResult(result),
  }))
  const streams = summarizeStreams(resultSummaries.flatMap((result) => result.streams))

  await appendAuditEvent(projectPath, {
    action: "search.run",
    actor: input.actor ?? "user",
    targetPath: ".llm-wiki/audit.jsonl",
    retrieval: {
      query,
      streams,
      results: resultSummaries,
    },
    after: { resultCount: input.results.length },
    reasons: ["explicit user search", `${input.results.length} result${input.results.length === 1 ? "" : "s"} returned`],
  })
  await recordMemoryOpsMaintenanceEvent(projectPath, "search.run")
}

export async function appendQueryAuditEvent(
  projectPath: string,
  input: AppendQueryAuditInput,
): Promise<void> {
  const query = input.query.trim()
  if (!query) return

  const results = input.referencedPages.map((page, index) => ({
    path: toProjectRelativePath(projectPath, page.path),
    title: page.title,
    rank: index + 1,
  }))

  await appendAuditEvent(projectPath, {
    action: "query.answer",
    actor: "system",
    targetPath: ".llm-wiki/chats",
    retrieval: {
      query,
      streams: [{ name: "wiki-context", resultCount: results.length }],
      results,
    },
    after: { referencedPageCount: results.length },
    reasons: [`${results.length} wiki page${results.length === 1 ? "" : "s"} referenced`],
  })
  await recordMemoryOpsMaintenanceEvent(projectPath, "query.answer")
}

export async function appendReviewResolveAuditEvent(
  projectPath: string,
  input: AppendReviewResolveAuditInput,
): Promise<void> {
  const affectedPages = (input.item.affectedPages ?? []).map((path) =>
    toProjectRelativePath(projectPath, path),
  )
  const targetPath = affectedPages[0] ?? input.item.sourcePath ?? ".llm-wiki/review.json"

  await appendAuditEvent(projectPath, {
    action: "review.resolve",
    actor: "user",
    targetPath,
    pagePath: affectedPages[0],
    sourcePath: input.item.sourcePath ? toProjectRelativePath(projectPath, input.item.sourcePath) : undefined,
    after: {
      reviewId: input.item.id,
      type: input.item.type,
      title: input.item.title,
      resolvedAction: input.resolvedAction,
      outcome: input.outcome,
      affectedPages,
    },
    reasons: [input.item.title, input.resolvedAction],
  })
  await recordMemoryOpsMaintenanceEvent(projectPath, "review.resolve")
}

function streamsForSearchResult(result: SearchResult): string[] {
  const streams = new Set<string>(["lexical"])
  if (result.graphPath && result.graphPath.length > 0) streams.add("graph")
  return [...streams]
}

function summarizeStreams(streams: readonly string[] | undefined): Array<{ name: string; resultCount: number }> {
  const counts = new Map<string, number>()
  for (const stream of streams ?? []) counts.set(stream, (counts.get(stream) ?? 0) + 1)
  return [...counts.entries()].map(([name, resultCount]) => ({ name, resultCount }))
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

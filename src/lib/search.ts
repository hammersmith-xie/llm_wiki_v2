import { readFile, listDirectory } from "@/commands/fs"
import { normalizePath, getFileStem } from "@/lib/path-utils"
import type { GraphPathDirection } from "@/lib/typed-graph"
import { rankBm25Documents } from "@/lib/search-bm25"
import { lookupClaimEvidence } from "@/lib/claim-evidence"
import { readClaimIndex } from "@/lib/claims"
import { flattenMdFiles, searchFiles } from "@/lib/search-file-reader"
import {
  buildSnippet,
  extractImageRefs,
  extractTitle,
  tokenizeQuery,
  type LexicalDocument,
} from "@/lib/search-lexical"
import type { SearchResult, SearchRetrievalExplanation } from "@/lib/search-types"

export { rankBm25Documents } from "@/lib/search-bm25"
export type {
  Bm25Explanation,
  Bm25FieldName,
  Bm25FieldScores,
  Bm25MatchedTokensByField,
  Bm25Options,
  Bm25RankedHit,
} from "@/lib/search-bm25"
export {
  rankLexicalDocuments,
  tokenizeQuery,
} from "@/lib/search-lexical"
export type {
  ImageRef,
  LexicalDocument,
  LexicalMatchExplanation,
  LexicalRankedHit,
  LexicalScoreBreakdown,
} from "@/lib/search-lexical"
export type {
  SearchGraphContribution,
  SearchResult,
  SearchRetrievalExplanation,
  SearchStreamContribution,
} from "@/lib/search-types"

const MAX_RESULTS = 20

// ── Reciprocal Rank Fusion ─────────────────────────────────────────────────
// Token search and vector search produce two independently-ranked lists.
// Their absolute scores are incommensurable (token score: 1-400, vector
// cosine: 0-1), so summing them privileges whichever list happens to use
// the larger numbers. RRF sidesteps that by fusing on RANK only:
//
//     fused(p) = sum over lists L of  1 / (K + rank_L(p))
//
// A page that ranks #1 in BOTH lists wins handily. A page that's only in
// one list still surfaces if it ranks high there, but a page in BOTH a
// little lower can outrank it — exactly what we want for hybrid retrieval.
//
// K=60 is the canonical constant from Cormack et al. (SIGIR 2009), large
// enough that small rank differences near the top don't dominate but
// small enough that being deep in either list still falls off quickly.
const RRF_K = 60

export async function searchWiki(
  projectPath: string,
  query: string,
): Promise<SearchResult[]> {
  if (!query.trim()) return []
  const pp = normalizePath(projectPath)

  const tokens = tokenizeQuery(query)
  // Fallback: if all tokens were filtered out, use the trimmed query as a single token
  const effectiveTokens = tokens.length > 0 ? tokens : [query.trim().toLowerCase()]
  const results: SearchResult[] = []
  const lexicalDocuments: LexicalDocument[] = []

  // Search wiki pages.
  //
  // We deliberately do NOT also search `raw/sources/` here anymore.
  // Previously this section walked every file under raw/sources/
  // (including PDFs / DOCX / PPTX) and called `readFile` on each,
  // which triggers the heavy pdfium / office text-extraction path
  // — even on cache hits, that's an IPC round-trip per file plus
  // a cache file read of the now-large combined-markdown output
  // (text + per-page image refs after the unified extractor
  // landed). On a project with ~50 PDFs this added 5-15s per
  // search, which the user reported as "very, very slow."
  //
  // The content lost: nothing material. Each ingested raw source
  // produces a `wiki/sources/<slug>.md` summary which is included
  // in the wiki/ search below; the full extracted text lives in
  // the embedding chunks and is reachable via vector search. The
  // raw-files token pass added recall only for raw files that had
  // never been ingested (and thus had no wiki summary), which is
  // not a workflow we want to optimize at the cost of every other
  // search call.
  try {
    const t0 = performance.now()
    const wikiTree = await listDirectory(`${pp}/wiki`)
    const wikiFiles = flattenMdFiles(wikiTree)
    const tList = Math.round(performance.now() - t0)
    const t1 = performance.now()
    await searchFiles(wikiFiles, effectiveTokens, query, results, lexicalDocuments)
    const tRead = Math.round(performance.now() - t1)
    console.log(
      `[Search:token] wiki/ ${wikiFiles.length} files | list=${tList}ms read+match=${tRead}ms`,
    )
  } catch {
    // no wiki directory
  }

  // ── Build the token-side ranking (still based on the score field
  // populated by searchFiles above). Snapshot it BEFORE the vector
  // step, so adding vector-only pages doesn't shift token ranks.
  const tokenSorted = [...results].sort((a, b) => b.score - a.score)
  const tokenRank = new Map<string, number>()
  const tokenScore = new Map<string, number>()
  tokenSorted.forEach((r, i) => {
    const pathKey = normalizePath(r.path)
    tokenRank.set(pathKey, i + 1) // 1-indexed
    tokenScore.set(pathKey, r.score)
  })

  const bm25Hits = rankBm25Documents(lexicalDocuments, query)
  const bm25Rank = new Map<string, number>()
  const bm25Score = new Map<string, number>()
  bm25Hits.forEach((hit) => {
    const pathKey = normalizePath(hit.path)
    bm25Rank.set(pathKey, hit.rank)
    bm25Score.set(pathKey, hit.score)
  })

  // ── Vector search: collect ranked list of page-ids and materialize
  //    pages that token search missed. We do NOT add to results' score
  //    here — that's done in the RRF step below.
  let vectorRank = new Map<string, number>()
  let vectorScore = new Map<string, number>()
  let vectorCount = 0
  try {
    const { useWikiStore } = await import("@/stores/wiki-store")
    const embCfg = useWikiStore.getState().embeddingConfig
    console.log(`[Vector Search] Config: enabled=${embCfg.enabled}, model="${embCfg.model}"`)
    if (embCfg.enabled && embCfg.model) {
      const t0 = performance.now()
      const { searchByEmbedding } = await import("@/lib/embedding")
      const vectorResults = await searchByEmbedding(pp, query, embCfg, 10)
      const vectorMs = Math.round(performance.now() - t0)
      vectorCount = vectorResults.length

      console.log(
        `[Vector Search] query="${query}" | ${vectorResults.length} results in ${vectorMs}ms | model=${embCfg.model}` +
        (vectorResults.length > 0
          ? ` | top: ${vectorResults.slice(0, 5).map((r) => `${r.id}(${r.score.toFixed(3)})`).join(", ")}`
          : "")
      )

      // Build vectorRank by page_id (slug); searchByEmbedding returns
      // results pre-sorted by descending similarity.
      vectorResults.forEach((vr, i) => {
        vectorRank.set(vr.id, i + 1)
        vectorScore.set(vr.id, vr.score)
      })

      // Materialize any vector-result page that token search didn't
      // already include — without this, `results` has no entry for
      // them and they can't surface even with a top vector rank.
      const knownIds = new Set(results.map((r) => getFileStem(r.path)))
      let added = 0
      for (const vr of vectorResults) {
        if (knownIds.has(vr.id)) continue
        const dirs = ["entities", "concepts", "sources", "synthesis", "comparisons", "queries"]
        for (const dir of dirs) {
          const tryPath = `${pp}/wiki/${dir}/${vr.id}.md`
          try {
            const content = await readFile(tryPath)
            const title = extractTitle(content, `${vr.id}.md`)
            results.push({
              path: tryPath,
              title,
              snippet: buildSnippet(content, query),
              titleMatch: false,
              score: 0, // overwritten by RRF below
              images: extractImageRefs(content),
            })
            knownIds.add(vr.id)
            added++
            break
          } catch {
            // not in this directory
          }
        }
      }
      if (added > 0) {
        console.log(`[Vector Search] Added ${added} vector-only pages to candidate set`)
      }
    }
  } catch (err) {
    console.log(`[Vector Search] Skipped: ${err instanceof Error ? err.message : "not available"}`)
    vectorRank = new Map()
    vectorScore = new Map()
  }

  // ── Graph search: typed graph traversal acts as a third retrieval
  //    stream. It complements lexical/vector search by surfacing pages
  //    connected to query-matching nodes via explicit typed relationships
  //    or fallback wikilinks.
  let graphRank = new Map<string, number>()
  let graphScore = new Map<string, number>()
  let graphPaths = new Map<string, string[]>()
  let graphPathTypes = new Map<string, string[]>()
  let graphPathDirections = new Map<string, GraphPathDirection[]>()
  let graphCount = 0
  try {
    const { useWikiStore } = await import("@/stores/wiki-store")
    const { buildTypedGraph, graphRankPages } = await import("@/lib/typed-graph")
    const dv = useWikiStore.getState().dataVersion
    const graph = await buildTypedGraph(pp, dv)
    const graphResults = graphRankPages(graph, query, { maxDepth: 2, limit: 12 })
    graphCount = graphResults.length
    graphResults.forEach((gr, i) => {
      graphRank.set(gr.id, i + 1)
      graphScore.set(gr.id, gr.score)
      graphPaths.set(gr.id, gr.path)
      graphPathTypes.set(gr.id, gr.pathTypes)
      graphPathDirections.set(gr.id, gr.pathDirections)
    })

    const knownIds = new Set(results.map((r) => getFileStem(r.path)))
    let added = 0
    for (const gr of graphResults) {
      if (knownIds.has(gr.id)) continue
      const node = graph.nodes.get(gr.id)
      if (!node) continue
      try {
        const content = await readFile(node.path)
        results.push({
          path: node.path,
          title: extractTitle(content, `${gr.id}.md`),
          snippet: buildSnippet(content, query),
          titleMatch: false,
          score: 0,
          graphPath: gr.path,
          graphPathTypes: gr.pathTypes,
          graphPathDirections: gr.pathDirections,
          images: extractImageRefs(content),
        })
        knownIds.add(gr.id)
        added++
      } catch {
        // Skip graph-only candidates that no longer exist on disk.
      }
    }
    if (added > 0) {
      console.log(`[Graph Search] Added ${added} graph-only pages to candidate set`)
    }
  } catch (err) {
    console.log(`[Graph Search] Skipped: ${err instanceof Error ? err.message : "not available"}`)
    graphRank = new Map()
    graphScore = new Map()
    graphPaths = new Map()
    graphPathTypes = new Map()
    graphPathDirections = new Map()
  }

  // ── RRF fusion: replace each result's score with
  //   1/(K + token_rank) + 1/(K + vector_rank) + 1/(K + graph_rank)
  //
  // Pages absent from either list contribute 0 from that side.
  // Pages absent from BOTH never make it here (we only iterate the
  // results array, which already contains every candidate).
  for (const r of results) {
    const pathKey = normalizePath(r.path)
    const pageId = getFileStem(r.path)
    const tRank = tokenRank.get(pathKey)
    const bRank = bm25Rank.get(pathKey)
    const vRank = vectorRank.get(pageId)
    const gRank = graphRank.get(pageId)
    let rrf = 0
    const retrieval: SearchRetrievalExplanation = { rrfScore: 0 }
    const lexicalRank = tRank ?? bRank
    const lexicalContribution =
      lexicalRank !== undefined ? rrfContribution(lexicalRank) : undefined
    if (tRank !== undefined) {
      retrieval.token = {
        rank: tRank,
        rawScore: tokenScore.get(pathKey),
        rrf: lexicalContribution ?? 0,
      }
    }
    if (bRank !== undefined) {
      retrieval.bm25 = {
        rank: bRank,
        rawScore: bm25Score.get(pathKey),
        rrf: tRank === undefined ? lexicalContribution ?? 0 : 0,
      }
    }
    if (lexicalContribution !== undefined) rrf += lexicalContribution
    if (vRank !== undefined) {
      const contribution = rrfContribution(vRank)
      rrf += contribution
      retrieval.vector = {
        rank: vRank,
        rawScore: vectorScore.get(pageId),
        rrf: contribution,
      }
    }
    if (gRank !== undefined) {
      const contribution = rrfContribution(gRank)
      rrf += contribution
      const path = graphPaths.get(pageId)
      const pathTypes = graphPathTypes.get(pageId)
      const pathDirections = graphPathDirections.get(pageId)
      r.graphPath = path
      r.graphPathTypes = pathTypes
      r.graphPathDirections = pathDirections
      retrieval.graph = {
        rank: gRank,
        rawScore: graphScore.get(pageId),
        rrf: contribution,
        path,
        pathTypes,
        pathDirections,
      }
    }
    r.score = rrf
    r.retrieval = { ...retrieval, rrfScore: rrf }
  }

  // Sort by RRF score descending. Ties (e.g. two pages both at vector
  // rank 1 but neither in token list) are broken by alphabetical path
  // order so output is deterministic for tests.
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.path.localeCompare(b.path)
  })

  const tokenHits = tokenRank.size
  console.log(
    `[Search] query="${query}" | RRF fused: ${tokenHits} token + ${bm25Rank.size} BM25 + ${vectorCount} vector + ${graphCount} graph → ${results.length} unique`,
  )

  const topResults = results.slice(0, MAX_RESULTS)
  await attachClaimEvidence(pp, query, topResults, results.map((result) => result.path))
  return topResults
}

function rrfContribution(rank: number): number {
  return 1 / (RRF_K + rank)
}

async function attachClaimEvidence(
  projectPath: string,
  query: string,
  topResults: SearchResult[],
  existingPagePaths: readonly string[],
): Promise<void> {
  try {
    const index = await readClaimIndex(projectPath)
    if (index.claims.length === 0) return
    const lookup = lookupClaimEvidence({
      query,
      pageResults: topResults.map((result, index) => ({ path: result.path, rank: index + 1 })),
      claims: index.claims,
      existingPagePaths,
    })
    if (lookup.warnings.length > 0) {
      console.warn(`[Search:claims] ${lookup.warnings.length} claim warning(s)`)
    }
    const byPage = new Map<string, typeof lookup.evidence>()
    for (const evidence of lookup.evidence) {
      const key = comparableWikiPath(evidence.pagePath)
      byPage.set(key, [...(byPage.get(key) ?? []), evidence])
    }
    for (const result of topResults) {
      const evidence = byPage.get(comparableWikiPath(result.path))
      if (evidence && evidence.length > 0) result.claimEvidence = evidence
    }
  } catch (err) {
    console.warn(`[Search:claims] skipped: ${err instanceof Error ? err.message : err}`)
  }
}

function comparableWikiPath(path: string): string {
  const normalized = normalizePath(path)
  const idx = normalized.indexOf("/wiki/")
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}

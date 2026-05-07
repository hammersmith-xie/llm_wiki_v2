import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath, getFileStem } from "@/lib/path-utils"
import type { GraphPathDirection } from "@/lib/typed-graph"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"

/**
 * One image reference extracted from a matched page's markdown.
 *
 * `url` is verbatim what was inside the `![](...)` parens — this is
 * a forward-slash path that the markdown image resolver knows how
 * to map to a renderable URL. We deliberately keep it pre-resolution
 * so the search-result UI can filter by URL prefix (e.g. "only show
 * images from this source's media dir") before paying the cost of
 * `convertFileSrc`.
 */
export interface ImageRef {
  url: string
  alt: string
}

export interface SearchResult {
  path: string
  title: string
  snippet: string
  titleMatch: boolean
  score: number
  retrieval?: SearchRetrievalExplanation
  graphPath?: string[]
  graphPathTypes?: string[]
  graphPathDirections?: GraphPathDirection[]
  /**
   * Image references found inside this result's markdown. Populated
   * even when the query doesn't match the alt text — the UI splits
   * "alt-matches-query" from "image just lives on this matched
   * page" itself, so both views need the full set. May be empty.
   */
  images: ImageRef[]
}

export interface SearchStreamContribution {
  rank: number
  rawScore?: number
  rrf: number
}

export interface SearchGraphContribution extends SearchStreamContribution {
  path?: string[]
  pathTypes?: string[]
  pathDirections?: GraphPathDirection[]
}

export interface SearchRetrievalExplanation {
  rrfScore: number
  token?: SearchStreamContribution
  bm25?: SearchStreamContribution
  vector?: SearchStreamContribution
  graph?: SearchGraphContribution
}

export interface LexicalDocument {
  path: string
  fileName: string
  content: string
}

export interface LexicalScoreBreakdown {
  filenameExact: number
  titlePhrase: number
  contentPhrase: number
  titleTokens: number
  contentTokens: number
}

export interface LexicalMatchExplanation {
  queryPhrase: string
  tokens: string[]
  filenameExact: boolean
  titleHasPhrase: boolean
  contentPhraseOccurrences: number
  titleTokenMatches: string[]
  contentTokenMatches: string[]
  scoreBreakdown: LexicalScoreBreakdown
}

export interface LexicalRankedHit {
  path: string
  title: string
  snippet: string
  titleMatch: boolean
  score: number
  rank: number
  images: ImageRef[]
  explain: LexicalMatchExplanation
}

export type Bm25FieldName = "filename" | "title" | "aliases" | "keywords" | "body"

export type Bm25FieldScores = Record<Bm25FieldName, number>
export type Bm25MatchedTokensByField = Record<Bm25FieldName, string[]>

export interface Bm25Explanation {
  queryTokens: string[]
  fieldScores: Bm25FieldScores
  matchedTokensByField: Bm25MatchedTokensByField
}

export interface Bm25RankedHit {
  path: string
  title: string
  score: number
  rank: number
  explain: Bm25Explanation
}

export interface Bm25Options {
  k1?: number
  b?: number
  fieldWeights?: Partial<Bm25FieldScores>
}

interface PreparedLexicalQuery {
  query: string
  queryPhrase: string
  tokens: string[]
}

type LexicalScoredHit = Omit<LexicalRankedHit, "rank">

const MAX_RESULTS = 20
const SNIPPET_CONTEXT = 80
const BM25_FIELDS: Bm25FieldName[] = ["filename", "title", "aliases", "keywords", "body"]
const DEFAULT_BM25_FIELD_WEIGHTS: Bm25FieldScores = {
  filename: 4,
  title: 3,
  aliases: 2.5,
  keywords: 2,
  body: 1,
}

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

// ── Scoring weights ────────────────────────────────────────────────────────
// Exact lexical matches dominate everything else. The rationale: when a
// user types "attention", the page literally named `attention.md` MUST
// rank first, regardless of how many other pages also mention the word.
//
//   filename == query (e.g. `attention.md` for query "attention")
//     → FILENAME_EXACT_BONUS — large enough that nothing short of an
//       equally-exact match can outrank it.
//
//   title or content contains the raw query as a substring
//     → PHRASE_IN_TITLE_BONUS / PHRASE_IN_CONTENT_PER_OCC — phrase
//       presence is worth far more than individual token presence, and
//       in content it rewards repetition (with a cap to avoid runaway).
//
//   per-token matches (existing behavior, but now smaller weight)
//     → TITLE_TOKEN_WEIGHT / CONTENT_TOKEN_WEIGHT. These used to
//       dominate via a flat +10 title bonus regardless of how many
//       tokens matched; now each matched token counts individually.
const FILENAME_EXACT_BONUS = 200
const PHRASE_IN_TITLE_BONUS = 50
const PHRASE_IN_CONTENT_PER_OCC = 20
const MAX_PHRASE_OCC_COUNTED = 10 // cap to avoid runaway on huge logs
const TITLE_TOKEN_WEIGHT = 5
const CONTENT_TOKEN_WEIGHT = 1

const STOP_WORDS = new Set([
  "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
])

export function tokenizeQuery(query: string): string[] {
  // Split by whitespace and punctuation
  const rawTokens = query
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…]+/)
    .filter((t) => t.length > 1)
    .filter((t) => !STOP_WORDS.has(t))

  const tokens: string[] = []

  for (const token of rawTokens) {
    // Check if token contains CJK characters
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(token)

    if (hasCJK && token.length > 2) {
      // For CJK text: split into individual characters AND overlapping bigrams
      // "默会知识" → ["默会", "会知", "知识", "默", "会", "知", "识"]
      const chars = [...token]
      // Add bigrams (most useful for Chinese)
      for (let i = 0; i < chars.length - 1; i++) {
        tokens.push(chars[i] + chars[i + 1])
      }
      // Also add individual chars (for single-char matches)
      for (const ch of chars) {
        if (!STOP_WORDS.has(ch)) {
          tokens.push(ch)
        }
      }
      // Keep the original token too (for exact phrase match)
      tokens.push(token)
    } else {
      tokens.push(token)
    }
  }

  // Deduplicate
  return [...new Set(tokens)]
}

function countOccurrences(haystackLower: string, needleLower: string): number {
  if (!needleLower || needleLower.length === 0) return 0
  let count = 0
  let pos = 0
  while (true) {
    const idx = haystackLower.indexOf(needleLower, pos)
    if (idx === -1) break
    count++
    pos = idx + needleLower.length
  }
  return count
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function extractTitle(content: string, fileName: string): string {
  // Try YAML frontmatter title
  const frontmatterMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterMatch) return frontmatterMatch[1].trim()

  // Try first heading
  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  // Fall back to filename
  return fileName.replace(/\.md$/, "").replace(/-/g, " ")
}

/**
 * Markdown image-reference regex. Matches `![alt](url)` capturing
 * groups 1=alt, 2=url. Identical to the regex in
 * `image-caption-pipeline.ts` — kept duplicated rather than shared
 * because the two modules have very different lifetimes (search
 * runs every keystroke; the pipeline runs at ingest), and a shared
 * symbol there would tie them together for no benefit.
 *
 * Excludes:
 *   - HTML `<img src=...>` (we don't generate these)
 *   - Reference-style `![alt][ref]` (we don't generate these either)
 */
const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

function extractImageRefs(content: string): ImageRef[] {
  const seen = new Set<string>()
  const out: ImageRef[] = []
  for (const m of content.matchAll(IMAGE_REF_RE)) {
    const url = m[2]
    // De-dupe within a single page: the same image may be
    // referenced both inline (LLM-preserved) AND in the safety-net
    // "## Embedded Images" section. Showing it twice in the
    // results UI would just be visual noise.
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ url, alt: m[1] })
  }
  return out
}

function buildSnippet(content: string, query: string): string {
  const lower = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lower.indexOf(lowerQuery)
  if (idx === -1) return content.slice(0, SNIPPET_CONTEXT * 2).replace(/\n/g, " ")

  const start = Math.max(0, idx - SNIPPET_CONTEXT)
  const end = Math.min(content.length, idx + query.length + SNIPPET_CONTEXT)
  let snippet = content.slice(start, end).replace(/\n/g, " ")
  if (start > 0) snippet = "..." + snippet
  if (end < content.length) snippet = snippet + "..."
  return snippet
}

export function rankLexicalDocuments(
  documents: readonly LexicalDocument[],
  query: string,
): LexicalRankedHit[] {
  if (!query.trim()) return []
  const preparedQuery = prepareLexicalQuery(query)
  return documents
    .map((document) => scoreLexicalDocument(document, preparedQuery))
    .filter((hit): hit is LexicalScoredHit => hit !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.path.localeCompare(b.path)
    })
    .map((hit, index) => ({ ...hit, rank: index + 1 }))
}

export function rankBm25Documents(
  documents: readonly LexicalDocument[],
  query: string,
  options: Bm25Options = {},
): Bm25RankedHit[] {
  if (!query.trim() || documents.length === 0) return []
  const queryTokens = tokenizeQuery(query)
  const effectiveQueryTokens = queryTokens.length > 0 ? queryTokens : [query.trim().toLowerCase()]
  const indexed = documents.map(indexBm25Document)
  const stats = buildBm25Stats(indexed)
  const k1 = options.k1 ?? 1.2
  const b = options.b ?? 0.75
  const fieldWeights = { ...DEFAULT_BM25_FIELD_WEIGHTS, ...(options.fieldWeights ?? {}) }

  return indexed
    .map((entry) => scoreBm25Document(entry, {
      queryTokens: effectiveQueryTokens,
      stats,
      k1,
      b,
      fieldWeights,
    }))
    .filter((hit): hit is Bm25RankedHit => hit !== null)
    .sort((a, bScore) => {
      if (bScore.score !== a.score) return bScore.score - a.score
      return a.path.localeCompare(bScore.path)
    })
    .map((hit, index) => ({ ...hit, rank: index + 1 }))
}

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

  return results.slice(0, MAX_RESULTS)
}

function rrfContribution(rank: number): number {
  return 1 / (RRF_K + rank)
}

/**
 * Bound on concurrent `readFile` calls during search. Going wider
 * than this saturates the Tauri IPC channel and starts QUEUING
 * work behind the search request — the wider you go, the SLOWER
 * a single search gets past about 16-32 in-flight reads (measured
 * in dev against a 200-file project). 16 is a comfortable middle
 * ground that gives near-linear speedup over sequential without
 * choking the IPC layer.
 */
const SEARCH_READ_CONCURRENCY = 16

/**
 * Punctuation pattern shared between token splitting and the
 * phrase-bonus normalization below. Matched at start AND end of
 * the query — internal punctuation (`U.S.A.`, `2024-Q3`) stays
 * because it might be load-bearing in legitimate phrase matches.
 */
const TRIM_PUNCT_RE =
  /^[\s,，。！？、；：""''（）()\-_/\\·~～…]+|[\s,，。！？、；：""''（）()\-_/\\·~～…]+$/g

async function searchFiles(
  files: FileNode[],
  tokens: readonly string[],
  query: string,
  results: SearchResult[],
  lexicalDocuments: LexicalDocument[],
): Promise<void> {
  // Strip leading / trailing punctuation from the query before using
  // it as a phrase-bonus probe. Without this, `query="总资产。"`
  // tries to substring-match `总资产。` inside titles / content that
  // never have the period at that spot — the phrase-bonus signal
  // (worth +50 in titles, +20 per occurrence in content) silently
  // goes to zero and the page's RRF rank slides. Same surface that
  // bit the search-view image filter, fixed there in token space;
  // here we apply the analog in phrase space.
  //
  // Internal punctuation is preserved on purpose: queries like
  // "2024-Q3" or domain names should still phrase-match exactly.
  const preparedQuery = prepareLexicalQuery(query, tokens)

  // Process files in fixed-size concurrent batches. Promise.all over
  // the entire list would work but spawns N IPC calls simultaneously
  // — tested at N=200, that's where we saw the slowdown above.
  for (let i = 0; i < files.length; i += SEARCH_READ_CONCURRENCY) {
    const batch = files.slice(i, i + SEARCH_READ_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        let content: string
        try {
          content = await readFile(file.path)
        } catch {
          return null
        }
        lexicalDocuments.push({ path: file.path, fileName: file.name, content })
        return scoreFile(file, content, preparedQuery)
      }),
    )
    for (const r of batchResults) {
      if (r) results.push(r)
    }
  }
}

/**
 * Pure scoring pass — no IO. Extracted so `searchFiles` can run
 * the IO and the matching independently and so this function can
 * be unit-tested without mocking readFile.
 */
function scoreFile(
  file: FileNode,
  content: string,
  preparedQuery: PreparedLexicalQuery,
): SearchResult | null {
  const hit = scoreLexicalDocument({
    path: file.path,
    fileName: file.name,
    content,
  }, preparedQuery)
  if (!hit) return null

  return {
    path: hit.path,
    title: hit.title,
    snippet: hit.snippet,
    titleMatch: hit.titleMatch,
    score: hit.score,
    images: hit.images,
  }
}

function scoreLexicalDocument(
  document: LexicalDocument,
  preparedQuery: PreparedLexicalQuery,
): LexicalScoredHit | null {
  const title = extractTitle(document.content, document.fileName)
  const titleText = `${title} ${document.fileName}`
  const titleLower = titleText.toLowerCase()
  const contentLower = document.content.toLowerCase()
  const fileStem = document.fileName.replace(/\.md$/, "").toLowerCase()
  const { query, queryPhrase, tokens } = preparedQuery

  // Exact-match signals (strongest)
  const filenameExact = fileStem === queryPhrase
  const titleHasPhrase =
    queryPhrase.length > 0 && titleLower.includes(queryPhrase)
  const contentPhraseOcc = Math.min(
    countOccurrences(contentLower, queryPhrase),
    MAX_PHRASE_OCC_COUNTED,
  )

  // Token-level signals (fallback / density)
  const titleTokenMatches = matchingTokens(titleText, tokens)
  const contentTokenMatches = matchingTokens(document.content, tokens)

  if (
    !filenameExact &&
    !titleHasPhrase &&
    contentPhraseOcc === 0 &&
    titleTokenMatches.length === 0 &&
    contentTokenMatches.length === 0
  ) {
    return null
  }

  const scoreBreakdown: LexicalScoreBreakdown = {
    filenameExact: filenameExact ? FILENAME_EXACT_BONUS : 0,
    titlePhrase: titleHasPhrase ? PHRASE_IN_TITLE_BONUS : 0,
    contentPhrase: contentPhraseOcc * PHRASE_IN_CONTENT_PER_OCC,
    titleTokens: titleTokenMatches.length * TITLE_TOKEN_WEIGHT,
    contentTokens: contentTokenMatches.length * CONTENT_TOKEN_WEIGHT,
  }
  const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0)

  const isTitleMatch = titleTokenMatches.length > 0 || titleHasPhrase

  const snippetAnchor =
    contentPhraseOcc > 0
      ? queryPhrase
      : tokens.find((t) => contentLower.includes(t)) ?? query

  return {
    path: document.path,
    title,
    snippet: buildSnippet(document.content, snippetAnchor),
    titleMatch: isTitleMatch,
    score,
    images: extractImageRefs(document.content),
    explain: {
      queryPhrase,
      tokens,
      filenameExact,
      titleHasPhrase,
      contentPhraseOccurrences: contentPhraseOcc,
      titleTokenMatches,
      contentTokenMatches,
      scoreBreakdown,
    },
  }
}

interface Bm25IndexedDocument {
  document: LexicalDocument
  title: string
  fields: Record<Bm25FieldName, string[]>
}

interface Bm25Stats {
  documentCount: number
  averageFieldLength: Bm25FieldScores
  documentFrequency: Record<Bm25FieldName, Map<string, number>>
}

interface Bm25ScoringContext {
  queryTokens: string[]
  stats: Bm25Stats
  k1: number
  b: number
  fieldWeights: Bm25FieldScores
}

function indexBm25Document(document: LexicalDocument): Bm25IndexedDocument {
  const parsed = parseFrontmatter(document.content)
  const frontmatter = parsed.frontmatter
  const title = extractTitle(document.content, document.fileName)
  return {
    document,
    title,
    fields: {
      filename: tokenizeForFrequency(document.fileName.replace(/\.md$/, "").replace(/[-_]/g, " ")),
      title: tokenizeForFrequency(title),
      aliases: tokenizeForFrequency([
        ...arrayValue(frontmatter?.alias),
        ...arrayValue(frontmatter?.aliases),
      ].join(" ")),
      keywords: tokenizeForFrequency([
        ...arrayValue(frontmatter?.keywords),
        ...arrayValue(frontmatter?.tags),
      ].join(" ")),
      body: tokenizeForFrequency(parsed.body),
    },
  }
}

function buildBm25Stats(indexed: readonly Bm25IndexedDocument[]): Bm25Stats {
  const documentFrequency = Object.fromEntries(
    BM25_FIELDS.map((field) => [field, new Map<string, number>()]),
  ) as Record<Bm25FieldName, Map<string, number>>
  const averageFieldLength = zeroBm25FieldScores()

  for (const entry of indexed) {
    for (const field of BM25_FIELDS) {
      averageFieldLength[field] += entry.fields[field].length
      const seen = new Set(entry.fields[field])
      for (const token of seen) {
        documentFrequency[field].set(token, (documentFrequency[field].get(token) ?? 0) + 1)
      }
    }
  }

  for (const field of BM25_FIELDS) {
    averageFieldLength[field] = indexed.length > 0
      ? averageFieldLength[field] / indexed.length
      : 0
  }

  return {
    documentCount: indexed.length,
    averageFieldLength,
    documentFrequency,
  }
}

function scoreBm25Document(
  entry: Bm25IndexedDocument,
  context: Bm25ScoringContext,
): Bm25RankedHit | null {
  const fieldScores = zeroBm25FieldScores()
  const matchedTokensByField = emptyBm25MatchedTokens()

  for (const field of BM25_FIELDS) {
    const tokens = entry.fields[field]
    if (tokens.length === 0) continue
    const termFrequency = countTerms(tokens)
    for (const queryToken of context.queryTokens) {
      const tf = termFrequency.get(queryToken) ?? 0
      if (tf === 0) continue
      matchedTokensByField[field].push(queryToken)
      const df = context.stats.documentFrequency[field].get(queryToken) ?? 0
      const idf = Math.log(1 + (context.stats.documentCount - df + 0.5) / (df + 0.5))
      const avgdl = context.stats.averageFieldLength[field] || 1
      const denominator =
        tf + context.k1 * (1 - context.b + context.b * (tokens.length / avgdl))
      fieldScores[field] +=
        context.fieldWeights[field] * idf * ((tf * (context.k1 + 1)) / denominator)
    }
  }

  const score = BM25_FIELDS.reduce((sum, field) => sum + fieldScores[field], 0)
  if (score <= 0) return null

  return {
    path: entry.document.path,
    title: entry.title,
    score,
    rank: 0,
    explain: {
      queryTokens: context.queryTokens,
      fieldScores,
      matchedTokensByField,
    },
  }
}

function prepareLexicalQuery(
  query: string,
  tokensOverride?: readonly string[],
): PreparedLexicalQuery {
  const rawTokens = tokensOverride ?? tokenizeQuery(query)
  const tokens = rawTokens.length > 0 ? [...rawTokens] : [query.trim().toLowerCase()]
  return {
    query,
    queryPhrase: query.trim().toLowerCase().replace(TRIM_PUNCT_RE, ""),
    tokens,
  }
}

function matchingTokens(text: string, tokens: readonly string[]): string[] {
  const lower = text.toLowerCase()
  return tokens.filter((token) => lower.includes(token))
}

function tokenizeForFrequency(text: string): string[] {
  const rawTokens = text
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～….]+/)
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_WORDS.has(token))
  const tokens: string[] = []

  for (const token of rawTokens) {
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(token)
    if (hasCJK && token.length > 2) {
      const chars = [...token]
      for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1])
      for (const ch of chars) {
        if (!STOP_WORDS.has(ch)) tokens.push(ch)
      }
      tokens.push(token)
    } else {
      tokens.push(token)
    }
  }

  return tokens
}

function countTerms(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

function zeroBm25FieldScores(): Bm25FieldScores {
  return {
    filename: 0,
    title: 0,
    aliases: 0,
    keywords: 0,
    body: 0,
  }
}

function emptyBm25MatchedTokens(): Bm25MatchedTokensByField {
  return {
    filename: [],
    title: [],
    aliases: [],
    keywords: [],
    body: [],
  }
}

function arrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value
  if (value) return [value]
  return []
}

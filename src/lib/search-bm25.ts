import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import {
  extractTitle,
  tokenizeForFrequency,
  tokenizeQuery,
  type LexicalDocument,
} from "@/lib/search-lexical"

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

const BM25_FIELDS: Bm25FieldName[] = ["filename", "title", "aliases", "keywords", "body"]
const DEFAULT_BM25_FIELD_WEIGHTS: Bm25FieldScores = {
  filename: 4,
  title: 3,
  aliases: 2.5,
  keywords: 2,
  body: 1,
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
        tf + context.k1 * (1 - context.b + bRatio(context.b, tokens.length, avgdl))
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

function bRatio(b: number, tokenCount: number, averageLength: number): number {
  return b * (tokenCount / averageLength)
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

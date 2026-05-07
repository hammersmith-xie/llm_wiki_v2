import type { FileNode } from "@/types/wiki"

export interface ImageRef {
  url: string
  alt: string
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

export interface PreparedLexicalQuery {
  query: string
  queryPhrase: string
  tokens: string[]
}

export type LexicalScoredHit = Omit<LexicalRankedHit, "rank">

const SNIPPET_CONTEXT = 80
const FILENAME_EXACT_BONUS = 200
const PHRASE_IN_TITLE_BONUS = 50
const PHRASE_IN_CONTENT_PER_OCC = 20
const MAX_PHRASE_OCC_COUNTED = 10
const TITLE_TOKEN_WEIGHT = 5
const CONTENT_TOKEN_WEIGHT = 1

const STOP_WORDS = new Set([
  "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
])

const TRIM_PUNCT_RE =
  /^[\s,，。！？、；：""''（）()\-_/\\·~～…]+|[\s,，。！？、；：""''（）()\-_/\\·~～…]+$/g

/**
 * Markdown image-reference regex. Matches `![alt](url)` capturing
 * groups 1=alt, 2=url. Identical to the regex in
 * `image-caption-pipeline.ts` — kept duplicated rather than shared
 * because the two modules have very different lifetimes.
 */
const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

export function tokenizeQuery(query: string): string[] {
  const rawTokens = query
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…]+/)
    .filter((t) => t.length > 1)
    .filter((t) => !STOP_WORDS.has(t))

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

  return [...new Set(tokens)]
}

export function tokenizeForFrequency(text: string): string[] {
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

export function extractTitle(content: string, fileName: string): string {
  const frontmatterMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterMatch) return frontmatterMatch[1].trim()

  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  return fileName.replace(/\.md$/, "").replace(/-/g, " ")
}

export function extractImageRefs(content: string): ImageRef[] {
  const seen = new Set<string>()
  const out: ImageRef[] = []
  for (const m of content.matchAll(IMAGE_REF_RE)) {
    const url = m[2]
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ url, alt: m[1] })
  }
  return out
}

export function buildSnippet(content: string, query: string): string {
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

export function prepareLexicalQuery(
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

export function scoreLexicalDocument(
  document: LexicalDocument,
  preparedQuery: PreparedLexicalQuery,
): LexicalScoredHit | null {
  const title = extractTitle(document.content, document.fileName)
  const titleText = `${title} ${document.fileName}`
  const titleLower = titleText.toLowerCase()
  const contentLower = document.content.toLowerCase()
  const fileStem = document.fileName.replace(/\.md$/, "").toLowerCase()
  const { query, queryPhrase, tokens } = preparedQuery

  const filenameExact = fileStem === queryPhrase
  const titleHasPhrase = queryPhrase.length > 0 && titleLower.includes(queryPhrase)
  const contentPhraseOcc = Math.min(
    countOccurrences(contentLower, queryPhrase),
    MAX_PHRASE_OCC_COUNTED,
  )
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
  const snippetAnchor =
    contentPhraseOcc > 0
      ? queryPhrase
      : tokens.find((t) => contentLower.includes(t)) ?? query

  return {
    path: document.path,
    title,
    snippet: buildSnippet(document.content, snippetAnchor),
    titleMatch: titleTokenMatches.length > 0 || titleHasPhrase,
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

export function scoreFileLexically(
  file: FileNode,
  content: string,
  preparedQuery: PreparedLexicalQuery,
): LexicalScoredHit | null {
  return scoreLexicalDocument({
    path: file.path,
    fileName: file.name,
    content,
  }, preparedQuery)
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

function matchingTokens(text: string, tokens: readonly string[]): string[] {
  const lower = text.toLowerCase()
  return tokens.filter((token) => lower.includes(token))
}

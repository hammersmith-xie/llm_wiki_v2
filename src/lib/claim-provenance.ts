import type { ClaimRecord, ClaimSourceRef } from "./claims"
import { normalizePath } from "./path-utils"

export interface SourceSnippetMatch {
  snippet: string
  score: number
  anchor: string
  location: SourceSnippetLocation
}

export interface SourceSnippetLocation {
  charStart: number
  charEnd: number
  lineStart: number
  lineEnd: number
  page?: number
}

export interface FindSourceSnippetOptions {
  minOverlap?: number
  maxSnippetChars?: number
}

export interface BuildClaimSourceRefsInput extends FindSourceSnippetOptions {
  baseRefs: readonly ClaimSourceRef[]
  claimText: string
  sourceContent?: string
  sourceTitle?: string
}

export interface ClaimProvenanceSummary {
  sourceRefCount: number
  anchoredSourceRefCount: number
  hashedSourceRefCount: number
  missingSourceRefs: boolean
  missingSnippetHash: boolean
}

const DEFAULT_MIN_OVERLAP = 0.34
const DEFAULT_MAX_SNIPPET_CHARS = 420

export function buildClaimSourceRefsForText(
  input: BuildClaimSourceRefsInput,
): ClaimSourceRef[] {
  const baseRefs = mergeClaimSourceRefs(input.baseRefs)
  if (baseRefs.length === 0) return []

  const match = input.sourceContent
    ? findBestSourceSnippet(input.claimText, input.sourceContent, {
        minOverlap: input.minOverlap,
        maxSnippetChars: input.maxSnippetChars,
      })
    : null

  if (!match) {
    return mergeClaimSourceRefs(baseRefs.map((ref) => ({
      ...ref,
      ...(input.sourceTitle && !ref.title ? { title: input.sourceTitle } : {}),
    })))
  }

  const snippetHash = createSnippetHash(match.snippet)
  return mergeClaimSourceRefs(baseRefs.map((ref) => ({
    ...ref,
    ...(input.sourceTitle && !ref.title ? { title: input.sourceTitle } : {}),
    anchor: ref.anchor ?? match.anchor,
    snippet_hash: ref.snippet_hash ?? snippetHash,
    page: ref.page ?? match.location.page,
    line_start: ref.line_start ?? match.location.lineStart,
    line_end: ref.line_end ?? match.location.lineEnd,
    char_start: ref.char_start ?? match.location.charStart,
    char_end: ref.char_end ?? match.location.charEnd,
  })))
}

export function findBestSourceSnippet(
  claimText: string,
  sourceContent: string,
  options: FindSourceSnippetOptions = {},
): SourceSnippetMatch | null {
  const normalizedClaim = normalizeComparableText(claimText)
  if (!normalizedClaim || !sourceContent.trim()) return null

  const maxSnippetChars = Math.max(80, options.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS)
  const snippets = candidateSnippets(sourceContent, maxSnippetChars)
  for (const snippet of snippets) {
    if (normalizeComparableText(snippet).includes(normalizedClaim)) {
      return {
        snippet,
        score: 1,
        anchor: createSnippetAnchor(snippet),
        location: locateSnippet(sourceContent, snippet),
      }
    }
  }

  const claimTokens = tokenizeForOverlap(claimText)
  if (claimTokens.length === 0) return null

  const minOverlap = options.minOverlap ?? DEFAULT_MIN_OVERLAP
  let best: SourceSnippetMatch | null = null

  for (const snippet of snippets) {
    const snippetTokens = new Set(tokenizeForOverlap(snippet))
    if (snippetTokens.size === 0) continue
    const sharedCount = claimTokens.filter((token) => snippetTokens.has(token)).length
    const score = sharedCount / Math.max(1, claimTokens.length)
    const enoughEvidence = sharedCount >= Math.min(3, claimTokens.length)
    if (!enoughEvidence || score < minOverlap) continue
    if (!best || score > best.score) {
      best = {
        snippet,
        score,
        anchor: createSnippetAnchor(snippet),
        location: locateSnippet(sourceContent, snippet),
      }
    }
  }

  return best
}

export function createSnippetHash(snippet: string): string {
  return `snippet_${hashString(normalizeSnippet(snippet))}`
}

export function createSnippetAnchor(snippet: string): string {
  return `snippet:${hashString(normalizeSnippet(snippet))}`
}

export function mergeClaimSourceRefs(
  ...groups: readonly (readonly ClaimSourceRef[] | undefined)[]
): ClaimSourceRef[] {
  const refs: ClaimSourceRef[] = []

  for (const rawRef of groups.flatMap((group) => group ?? [])) {
    const ref = normalizeSourceRef(rawRef)
    if (!ref) continue

    const pathOnlyIndex = refs.findIndex((existing) =>
      existing.path.toLowerCase() === ref.path.toLowerCase() &&
      !existing.anchor &&
      !existing.snippet_hash
    )
    const refIsRicher = Boolean(ref.anchor || ref.snippet_hash)
    if (pathOnlyIndex >= 0 && refIsRicher) {
      refs[pathOnlyIndex] = ref
      continue
    }

    const hasRicherDuplicate = refs.some((existing) =>
      existing.path.toLowerCase() === ref.path.toLowerCase() &&
      (existing.anchor || existing.snippet_hash) &&
      !ref.anchor &&
      !ref.snippet_hash
    )
    if (hasRicherDuplicate) continue

    const duplicate = refs.some((existing) =>
      existing.path.toLowerCase() === ref.path.toLowerCase() &&
      (existing.title ?? "") === (ref.title ?? "") &&
      (existing.anchor ?? "") === (ref.anchor ?? "") &&
      (existing.snippet_hash ?? "") === (ref.snippet_hash ?? "") &&
      (existing.page ?? 0) === (ref.page ?? 0) &&
      (existing.line_start ?? 0) === (ref.line_start ?? 0) &&
      (existing.line_end ?? 0) === (ref.line_end ?? 0) &&
      (existing.char_start ?? -1) === (ref.char_start ?? -1) &&
      (existing.char_end ?? -1) === (ref.char_end ?? -1)
    )
    if (!duplicate) refs.push(ref)
  }

  return refs
}

export function summarizeClaimProvenance(
  claim: ClaimRecord,
): ClaimProvenanceSummary {
  const sourceRefCount = claim.source_refs.length
  const anchoredSourceRefCount = claim.source_refs.filter((ref) => ref.anchor).length
  const hashedSourceRefCount = claim.source_refs.filter((ref) => ref.snippet_hash).length

  return {
    sourceRefCount,
    anchoredSourceRefCount,
    hashedSourceRefCount,
    missingSourceRefs: sourceRefCount === 0,
    missingSnippetHash: sourceRefCount > 0 && hashedSourceRefCount === 0,
  }
}

function normalizeSourceRef(ref: ClaimSourceRef): ClaimSourceRef | null {
  const path = normalizePath(ref.path).trim()
  if (!path) return null
  const title = ref.title?.trim()
  const anchor = ref.anchor?.trim()
  const snippetHash = ref.snippet_hash?.trim()
  return {
    path,
    ...(title ? { title } : {}),
    ...(anchor ? { anchor } : {}),
    ...(snippetHash ? { snippet_hash: snippetHash } : {}),
    ...positiveIntegerField("page", ref.page),
    ...positiveIntegerField("line_start", ref.line_start),
    ...positiveIntegerField("line_end", ref.line_end),
    ...nonNegativeIntegerField("char_start", ref.char_start),
    ...nonNegativeIntegerField("char_end", ref.char_end),
  }
}

export function locateSnippet(sourceContent: string, snippet: string): SourceSnippetLocation {
  const normalizedSource = sourceContent.replace(/\r\n/g, "\n")
  const normalizedSnippet = snippet.replace(/\r\n/g, "\n").trim()
  const exactIndex = normalizedSource.indexOf(normalizedSnippet)
  const charStart = exactIndex >= 0
    ? exactIndex
    : normalizedSource.toLowerCase().indexOf(normalizedSnippet.toLowerCase())
  const safeStart = Math.max(0, charStart)
  const safeEnd = Math.min(
    normalizedSource.length,
    safeStart + normalizedSnippet.length,
  )
  const lineStart = lineNumberAtOffset(normalizedSource, safeStart)
  const lineEnd = lineNumberAtOffset(normalizedSource, Math.max(safeStart, safeEnd - 1))
  return {
    charStart: safeStart,
    charEnd: safeEnd,
    lineStart,
    lineEnd,
    ...pageForOffset(normalizedSource, safeStart),
  }
}

function candidateSnippets(sourceContent: string, maxSnippetChars: number): string[] {
  const out: string[] = []
  const blocks = sourceContent
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  for (const block of blocks) {
    const lineChunks = block.length > maxSnippetChars * 1.5
      ? block.split(/\n+/).map((line) => line.trim()).filter(Boolean)
      : [block]
    for (const chunk of lineChunks) {
      for (const window of snippetWindows(chunk, maxSnippetChars)) {
        if (normalizeComparableText(window).length > 0) out.push(window)
      }
    }
  }

  return uniqueStrings(out)
}

function lineNumberAtOffset(content: string, offset: number): number {
  let line = 1
  const capped = Math.max(0, Math.min(offset, content.length))
  for (let index = 0; index < capped; index++) {
    if (content[index] === "\n") line++
  }
  return line
}

function pageForOffset(content: string, offset: number): { page?: number } {
  const prefix = content.slice(0, Math.max(0, offset))
  const pageMatches = [...prefix.matchAll(/^##\s+Page\s+(\d+)\s*$/gim)]
  const last = pageMatches[pageMatches.length - 1]
  if (!last) return {}
  const page = Number(last[1])
  return Number.isInteger(page) && page > 0 ? { page } : {}
}

function positiveIntegerField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? { [key]: value } as Record<K, number>
    : {}
}

function nonNegativeIntegerField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? { [key]: value } as Record<K, number>
    : {}
}

function snippetWindows(value: string, maxSnippetChars: number): string[] {
  const trimmed = value.trim()
  if (trimmed.length <= maxSnippetChars) return [trimmed]

  const sentences = splitSentences(trimmed)
  const windows: string[] = []
  let current = ""
  for (const sentence of sentences) {
    if (!current) {
      current = sentence
      continue
    }
    if (`${current} ${sentence}`.length <= maxSnippetChars) {
      current = `${current} ${sentence}`
      continue
    }
    windows.push(current)
    current = sentence
  }
  if (current) windows.push(current)

  return windows.flatMap((window) =>
    window.length <= maxSnippetChars
      ? [window]
      : fixedWindows(window, maxSnippetChars)
  )
}

function splitSentences(value: string): string[] {
  return value
    .replace(/([.!?。！？；;])\s+/g, "$1\n")
    .split(/\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function fixedWindows(value: string, maxSnippetChars: number): string[] {
  const out: string[] = []
  const step = Math.max(80, Math.floor(maxSnippetChars * 0.75))
  for (let index = 0; index < value.length; index += step) {
    const window = value.slice(index, index + maxSnippetChars).trim()
    if (window) out.push(window)
  }
  return out
}

function tokenizeForOverlap(value: string): string[] {
  const normalized = normalizeComparableText(value)
  const latinTokens = normalized.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? []
  const cjkChars = Array.from(normalized.match(/[\u3400-\u9fff]/g) ?? [])
  const cjkBigrams = cjkChars.slice(0, -1).map((char, index) => `${char}${cjkChars[index + 1]}`)
  return uniqueStrings([...latinTokens, ...cjkBigrams])
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_#[\](){}<>|~]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

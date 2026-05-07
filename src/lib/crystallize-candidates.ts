import type { CrystallizeReference } from "@/lib/crystallize"
import type { DisplayMessage } from "@/stores/chat-store"
import type { ResearchTask } from "@/stores/research-store"
import type { ReviewItem } from "@/stores/review-store"

export type CrystallizationCandidateOrigin = "chat" | "research" | "review"

export interface CrystallizationCandidateInput {
  origin: CrystallizationCandidateOrigin
  sourceId: string
  content: string
  title?: string
  references?: CrystallizeReference[]
  tags?: string[]
  timestamp?: number
  alreadySaved?: boolean
  existingDedupeKeys?: Iterable<string>
}

export interface CrystallizationCandidate {
  id: string
  origin: CrystallizationCandidateOrigin
  sourceId: string
  title: string
  content: string
  score: number
  reasons: string[]
  references: CrystallizeReference[]
  tags: string[]
  dedupeKey: string
  timestamp?: number
}

export interface CollectCrystallizationCandidatesInput {
  chatMessages?: readonly DisplayMessage[]
  researchTasks?: readonly ResearchTask[]
  reviewItems?: readonly ReviewItem[]
  existingDedupeKeys?: Iterable<string>
}

const DEFAULT_THRESHOLD = 0.55

export function scoreCrystallizationCandidate(
  input: CrystallizationCandidateInput,
  options: { threshold?: number } = {},
): CrystallizationCandidate | null {
  const content = cleanCandidateContent(input.content)
  if (input.alreadySaved || content.length < 120) return null

  const dedupeKey = dedupeKeyForCrystallizationContent(content)
  if (hasDedupeKey(input.existingDedupeKeys, dedupeKey)) return null

  const references = uniqueReferences(input.references ?? [])
  const embeddedReferenceCount = countEmbeddedReferences(content)
  const evidenceCount = references.length + embeddedReferenceCount
  if (evidenceCount === 0) return null

  let score = 0
  const reasons: string[] = []

  if (content.length >= 120) {
    score += 0.15
    reasons.push("substantial answer length")
  }
  if (content.length >= 280) {
    score += 0.15
    reasons.push("enough detail for a query page")
  }
  if (content.length >= 600) {
    score += 0.1
    reasons.push("long-form synthesis")
  }

  if (references.length > 0) {
    score += references.length >= 2 ? 0.3 : 0.22
    reasons.push(`${references.length} explicit reference${references.length === 1 ? "" : "s"}`)
  } else if (embeddedReferenceCount > 0) {
    score += 0.18
    reasons.push("embedded references or wiki links")
  }

  if (hasMarkdownStructure(content)) {
    score += 0.1
    reasons.push("structured markdown output")
  }
  if (hasConclusionSignal(content)) {
    score += 0.15
    reasons.push("contains conclusion signal")
  }
  if (hasDecisionSignal(content)) {
    score += 0.15
    reasons.push("contains decision or recommendation signal")
  }
  if (hasListSignal(content)) {
    score += 0.08
    reasons.push("includes actionable list structure")
  }
  if (input.origin === "research" || input.origin === "review") {
    score += 0.05
    reasons.push(`${input.origin} output is normally review-worthy`)
  }

  const normalizedScore = Math.min(1, Number(score.toFixed(2)))
  if (normalizedScore < (options.threshold ?? DEFAULT_THRESHOLD)) return null

  return {
    id: `crystallize:${input.origin}:${input.sourceId}`,
    origin: input.origin,
    sourceId: input.sourceId,
    title: candidateTitle(input.title, content),
    content,
    score: normalizedScore,
    reasons,
    references,
    tags: uniqueStrings([input.origin, ...(input.tags ?? [])]),
    dedupeKey,
    timestamp: input.timestamp,
  }
}

export function collectCrystallizationCandidates(
  input: CollectCrystallizationCandidatesInput,
): CrystallizationCandidate[] {
  const seen = new Set(input.existingDedupeKeys ?? [])
  const candidates: CrystallizationCandidate[] = []

  for (const message of input.chatMessages ?? []) {
    if (message.role !== "assistant") continue
    addCandidate(candidates, seen, {
      origin: "chat",
      sourceId: message.id,
      content: message.content,
      references: message.references,
      timestamp: message.timestamp,
    })
  }

  for (const task of input.researchTasks ?? []) {
    if (!task.synthesis.trim() || task.savedPath) continue
    addCandidate(candidates, seen, {
      origin: "research",
      sourceId: task.id,
      title: `Research: ${task.topic}`,
      content: task.synthesis,
      references: task.webResults.map((result) => ({
        title: result.title,
        path: result.url,
      })),
      tags: ["research"],
      timestamp: task.createdAt,
      alreadySaved: !!task.savedPath,
    })
  }

  for (const item of input.reviewItems ?? []) {
    if (item.resolved) continue
    addCandidate(candidates, seen, {
      origin: "review",
      sourceId: item.id,
      title: item.title.replace(/^(Save to Wiki|Save|Create|Add|Research)[:\s]*/i, ""),
      content: [item.title, item.description].filter(Boolean).join("\n\n"),
      references: (item.affectedPages ?? []).map((path) => ({ path })),
      tags: ["review", item.type],
      timestamp: item.createdAt,
    })
  }

  return candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.timestamp ?? 0) - (a.timestamp ?? 0)
  })
}

export function dedupeKeyForCrystallizationContent(content: string): string {
  const normalized = cleanCandidateContent(content).toLowerCase().replace(/\s+/g, " ").trim()
  let hash = 2166136261
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `content:${(hash >>> 0).toString(36)}`
}

function addCandidate(
  candidates: CrystallizationCandidate[],
  seen: Set<string>,
  input: CrystallizationCandidateInput,
): void {
  const candidate = scoreCrystallizationCandidate({
    ...input,
    existingDedupeKeys: seen,
  })
  if (!candidate) return
  seen.add(candidate.dedupeKey)
  candidates.push(candidate)
}

function cleanCandidateContent(content: string): string {
  return content
    .replace(/<!--\s*(?:sources|save-worthy):.*?-->/gis, "")
    .replace(/<!--.*?-->/gs, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
    .trim()
}

function candidateTitle(explicitTitle: string | undefined, content: string): string {
  const raw =
    explicitTitle?.trim() ||
    content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ||
    "Saved Query"
  const title = raw
    .replace(/^#+\s*/, "")
    .replace(/^(Save to Wiki|Save|Create|Add|Research)[:\s]*/i, "")
    .replace(/\s+/g, " ")
    .trim()
  return title.slice(0, 80) || "Saved Query"
}

function hasDedupeKey(keys: Iterable<string> | undefined, dedupeKey: string): boolean {
  if (!keys) return false
  for (const key of keys) {
    if (key === dedupeKey) return true
  }
  return false
}

function countEmbeddedReferences(content: string): number {
  const wikilinks = content.match(/\[\[[^\]]+\]\]/g)?.length ?? 0
  const numberedCitations = content.match(/\[[0-9]+\]/g)?.length ?? 0
  const markdownLinks = content.match(/\[[^\]]+\]\([^)]+\)/g)?.length ?? 0
  return wikilinks + numberedCitations + markdownLinks
}

function hasMarkdownStructure(content: string): boolean {
  return /^#{1,3}\s+\S/m.test(content) || hasListSignal(content)
}

function hasConclusionSignal(content: string): boolean {
  return /(^#{1,3}\s*)?(conclusion|summary|takeaway|decision|结论|总结|要点)\b/im.test(content)
}

function hasDecisionSignal(content: string): boolean {
  return /\b(recommendation|recommend|decision|should|next steps?|action items?|建议|决定|下一步)\b/i.test(content)
}

function hasListSignal(content: string): boolean {
  return /^(?:[-*]|\d+\.)\s+\S/m.test(content)
}

function uniqueReferences(references: readonly CrystallizeReference[]): CrystallizeReference[] {
  const seen = new Set<string>()
  const out: CrystallizeReference[] = []
  for (const ref of references) {
    const path = ref.path.trim()
    if (!path) continue
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...ref, path })
  }
  return out
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

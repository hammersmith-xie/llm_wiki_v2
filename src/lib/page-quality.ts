import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import type { MetadataPatchOperation } from "@/lib/memory-ops-executor"
import {
  DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
  type LlmWikiSchemaContract,
} from "@/lib/schema-contract"

export type PageQualityDimension =
  | "structure"
  | "citation"
  | "relation"
  | "retrieval"
  | "governance"

export interface PageQualityDimensionScore {
  dimension: PageQualityDimension
  score: number
  reasons: string[]
}

export interface PageQualityScore {
  targetPath: string
  score: number
  dimensions: Record<PageQualityDimension, PageQualityDimensionScore>
  reasons: string[]
  proposedOperation?: MetadataPatchOperation
}

export interface PageQualityInput {
  path: string
  content: string
  contract?: LlmWikiSchemaContract
}

const DIMENSION_WEIGHTS: Record<PageQualityDimension, number> = {
  structure: 0.25,
  citation: 0.25,
  relation: 0.2,
  retrieval: 0.15,
  governance: 0.15,
}

export function evaluatePageQuality(input: PageQualityInput): PageQualityScore {
  const contract = input.contract ?? DEFAULT_LLM_WIKI_SCHEMA_CONTRACT
  const parsed = parseFrontmatter(input.content)
  const body = parsed.body
  const dimensions = {
    structure: structureScore(body, parsed.frontmatter),
    citation: citationScore(parsed.frontmatter),
    relation: relationScore(parsed.frontmatter, input.content, contract),
    retrieval: retrievalScore(parsed.frontmatter),
    governance: governanceScore(parsed.frontmatter),
  }
  const score = roundScore(
    Object.values(dimensions).reduce(
      (sum, dimension) => sum + dimension.score * DIMENSION_WEIGHTS[dimension.dimension],
      0,
    ),
  )
  const reasons = Object.values(dimensions)
    .flatMap((dimension) => dimension.reasons.map((reason) => `${dimension.dimension}: ${reason}`))
    .slice(0, 8)

  return {
    targetPath: input.path,
    score,
    dimensions,
    reasons,
    proposedOperation: qualityScoreOperation(input.path, parsed.frontmatter, score, contract),
  }
}

export function evaluatePagesQuality(
  pages: readonly PageQualityInput[],
  contract: LlmWikiSchemaContract = DEFAULT_LLM_WIKI_SCHEMA_CONTRACT,
): PageQualityScore[] {
  return pages.map((page) => evaluatePageQuality({ ...page, contract }))
}

function structureScore(
  body: string,
  frontmatter: Record<string, FrontmatterValue> | null,
): PageQualityDimensionScore {
  let score = 0
  const reasons: string[] = []
  const headings = [...body.matchAll(/^#{1,3}\s+.+$/gm)]
  const bodyText = stripMarkdown(body)

  if (frontmatter) {
    score += 0.2
    reasons.push("has parseable frontmatter")
  } else {
    reasons.push("missing parseable frontmatter")
  }

  if (headings.length > 0) {
    score += 0.25
    reasons.push(`${headings.length} heading${headings.length === 1 ? "" : "s"}`)
  } else {
    reasons.push("missing markdown headings")
  }

  if (bodyText.length >= 180) {
    score += 0.25
    reasons.push("substantial body content")
  } else if (bodyText.length >= 80) {
    score += 0.15
    reasons.push("short but usable body content")
  } else {
    reasons.push("body content is very short")
  }

  if (hasListOrTable(body)) {
    score += 0.15
    reasons.push("has scannable list or table structure")
  }

  if (frontmatter && scalar(frontmatter.title)) {
    score += 0.15
    reasons.push("title metadata is present")
  }

  return dimension("structure", score, reasons)
}

function citationScore(
  frontmatter: Record<string, FrontmatterValue> | null,
): PageQualityDimensionScore {
  let score = 0
  const reasons: string[] = []
  const sources = arrayValue(frontmatter?.sources)
  const supports = arrayValue(frontmatter?.supports)
  const related = arrayValue(frontmatter?.related)

  if (sources.length > 0) {
    score += Math.min(0.65, 0.35 + sources.length * 0.15)
    reasons.push(`${sources.length} source reference${sources.length === 1 ? "" : "s"}`)
  } else {
    reasons.push("no explicit sources")
  }

  if (supports.length > 0) {
    score += Math.min(0.2, supports.length * 0.1)
    reasons.push(`${supports.length} support relation${supports.length === 1 ? "" : "s"}`)
  }

  if (related.length > 0) {
    score += 0.15
    reasons.push("related pages provide context")
  }

  return dimension("citation", score, reasons)
}

function relationScore(
  frontmatter: Record<string, FrontmatterValue> | null,
  content: string,
  contract: LlmWikiSchemaContract,
): PageQualityDimensionScore {
  let relationCount = arrayValue(frontmatter?.related).length
  const typedCount = contract.relations.typedRelationFields.reduce(
    (sum, field) => sum + arrayValue(frontmatter?.[field]).length,
    0,
  )
  const wikilinkCount = countWikilinks(content)
  relationCount += typedCount + wikilinkCount

  const reasons: string[] = []
  if (typedCount > 0) reasons.push(`${typedCount} typed relation${typedCount === 1 ? "" : "s"}`)
  if (wikilinkCount > 0) reasons.push(`${wikilinkCount} wikilink${wikilinkCount === 1 ? "" : "s"}`)
  if (relationCount === 0) reasons.push("no wiki relationships")

  const required = Math.max(1, contract.quality.minRelationCount)
  const score = Math.min(1, relationCount / (required + 1))
  return dimension("relation", score, reasons)
}

function retrievalScore(
  frontmatter: Record<string, FrontmatterValue> | null,
): PageQualityDimensionScore {
  let score = 0
  const reasons: string[] = []
  const aliases = [...arrayValue(frontmatter?.alias), ...arrayValue(frontmatter?.aliases)]
  const keywords = arrayValue(frontmatter?.keywords)
  const tags = arrayValue(frontmatter?.tags)
  const title = scalar(frontmatter?.title)

  if (title) {
    score += 0.25
    reasons.push("title supports exact retrieval")
  }
  if (aliases.length > 0) {
    score += Math.min(0.3, aliases.length * 0.15)
    reasons.push(`${aliases.length} alias${aliases.length === 1 ? "" : "es"}`)
  }
  if (keywords.length > 0) {
    score += Math.min(0.3, keywords.length * 0.1)
    reasons.push(`${keywords.length} keyword${keywords.length === 1 ? "" : "s"}`)
  }
  if (tags.length > 0) {
    score += 0.15
    reasons.push("tags support browsing and search filters")
  }
  if (!title && aliases.length === 0 && keywords.length === 0) {
    reasons.push("no retrieval seed fields")
  }

  return dimension("retrieval", score, reasons)
}

function governanceScore(
  frontmatter: Record<string, FrontmatterValue> | null,
): PageQualityDimensionScore {
  let score = 0
  const reasons: string[] = []
  const scope = scalar(frontmatter?.scope)
  const reviewStatus = scalar(frontmatter?.review_status)
  const confidence = parseScore(scalar(frontmatter?.confidence))
  const qualityScore = parseScore(scalar(frontmatter?.quality_score))
  const lastConfirmed = scalar(frontmatter?.last_confirmed)

  if (scope === "shared" || scope === "private") {
    score += 0.2
    reasons.push(`scope is ${scope}`)
  } else {
    reasons.push("scope is missing or invalid")
  }

  if (reviewStatus === "ok") {
    score += 0.2
    reasons.push("review status is ok")
  } else if (reviewStatus === "needs-review") {
    score += 0.1
    reasons.push("review status is explicit")
  } else if (reviewStatus) {
    reasons.push(`review status is ${reviewStatus}`)
  } else {
    reasons.push("review status is missing")
  }

  if (confidence !== null) {
    score += confidence >= 0.45 ? 0.2 : 0.1
    reasons.push(`confidence ${formatScore(confidence)}`)
  } else {
    reasons.push("confidence score is missing")
  }

  if (qualityScore !== null) {
    score += qualityScore >= 0.45 ? 0.2 : 0.1
    reasons.push(`existing quality score ${formatScore(qualityScore)}`)
  }

  if (lastConfirmed && /^\d{4}-\d{2}-\d{2}$/.test(lastConfirmed)) {
    score += 0.2
    reasons.push("last_confirmed is present")
  } else {
    reasons.push("last_confirmed is missing")
  }

  return dimension("governance", score, reasons)
}

function qualityScoreOperation(
  targetPath: string,
  frontmatter: Record<string, FrontmatterValue> | null,
  score: number,
  contract: LlmWikiSchemaContract,
): MetadataPatchOperation | undefined {
  if (!frontmatter) return undefined
  const current = parseScore(scalar(frontmatter.quality_score))
  if (current !== null && current >= score) return undefined
  if (score >= contract.quality.minQualityScore && current !== null) return undefined

  return {
    kind: "metadata-patch",
    targetPath,
    fields: {
      quality_score: formatScore(score),
      ...(score < contract.quality.minQualityScore ? { review_status: "needs-review" } : {}),
    },
    reason: `Schema quality scan: quality ${formatScore(score)}`,
    scope: scalar(frontmatter.scope),
  }
}

function dimension(
  dimensionName: PageQualityDimension,
  score: number,
  reasons: string[],
): PageQualityDimensionScore {
  return {
    dimension: dimensionName,
    score: roundScore(Math.max(0, Math.min(1, score))),
    reasons: reasons.length > 0 ? reasons : ["no positive signal"],
  }
}

function scalar(value: FrontmatterValue | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

function arrayValue(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return uniqueStrings(value)
  if (!value) return []
  return uniqueStrings([value])
}

function parseScore(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null
  return parsed
}

function countWikilinks(content: string): number {
  const matches = content.match(/\[\[[^\]]+\]\]/g)
  return matches?.length ?? 0
}

function hasListOrTable(body: string): boolean {
  return /^[-*]\s+\S/m.test(body) || /^\|.+\|$/m.test(body)
}

function stripMarkdown(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[[^\]]+]\([^)]+\)/g, "")
    .replace(/[#>*_`|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = String(value).trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function roundScore(value: number): number {
  return Number(value.toFixed(2))
}

function formatScore(value: number): string {
  return value.toFixed(2)
}

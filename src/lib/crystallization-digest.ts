import type { AuditEventActor } from "@/lib/audit-timeline"
import type { CrystallizationCandidate } from "@/lib/crystallize-candidates"
import { normalizePath } from "@/lib/path-utils"
import {
  recordWikiAutomationEvent,
  type WikiAutomationEventResult,
} from "@/lib/wiki-automation-events"

export type CrystallizationDigestPageType = "query" | "synthesis"
export type CrystallizationDigestEntityType =
  | "entity"
  | "concept"
  | "source"
  | "query"
  | "comparison"
  | "synthesis"
  | "unknown"

export interface CrystallizationDigestPlanInput {
  candidate: CrystallizationCandidate
  existingDigestKeys?: Iterable<string>
  minScore?: number
  maxLessons?: number
  maxDecisions?: number
  maxEntities?: number
  maxRelations?: number
}

export interface CrystallizationDigestSource {
  origin: CrystallizationCandidate["origin"]
  sourceId: string
  title: string
  score: number
  reasons: string[]
  dedupeKey: string
}

export interface CrystallizationDigestLesson {
  id: string
  text: string
  evidencePaths: string[]
}

export interface CrystallizationDigestDecision {
  id: string
  statement: string
  evidencePaths: string[]
}

export interface CrystallizationDigestEntity {
  id: string
  name: string
  type: CrystallizationDigestEntityType
  targetSlug: string
  targetPath?: string
  evidencePaths: string[]
}

export interface CrystallizationDigestRelation {
  id: string
  field: "related" | "supports"
  source: string
  target: string
  targetPath?: string
  evidencePaths: string[]
  reason: string
}

export interface CrystallizationDigestPageCandidate {
  id: string
  type: CrystallizationDigestPageType
  title: string
  targetPath: string
  tags: string[]
  reasons: string[]
}

export interface CrystallizationDigestPlan {
  id: string
  dedupeKey: string
  source: CrystallizationDigestSource
  lessons: CrystallizationDigestLesson[]
  decisions: CrystallizationDigestDecision[]
  entities: CrystallizationDigestEntity[]
  relations: CrystallizationDigestRelation[]
  pageCandidates: CrystallizationDigestPageCandidate[]
  summary: {
    lessonCount: number
    decisionCount: number
    entityCount: number
    relationCount: number
    pageCandidateCount: number
  }
  warnings: string[]
}

export interface RecordCrystallizationDigestSaveInput {
  projectPath: string
  plan: CrystallizationDigestPlan
  actor?: AuditEventActor
  status?: "applied" | "partial" | "error" | string
  targetPaths?: readonly string[]
  appliedOperationCount?: number
  skippedOperationCount?: number
  reasons?: readonly string[]
}

const DEFAULT_MIN_SCORE = 0.55
const DECISION_SIGNAL =
  /\b(recommendation|recommend|decision|decide|should|must|next steps?|action items?)\b|建议|决定|下一步|应当|应该/i
const LESSON_SIGNAL =
  /\b(lesson|takeaway|insight|finding|learned|key point|conclusion|summary|shows|implies)\b|启示|经验|要点|发现|结论|总结/i

export function buildCrystallizationDigestPlan(
  input: CrystallizationDigestPlanInput,
): CrystallizationDigestPlan | null {
  const candidate = input.candidate
  const dedupeKey = digestDedupeKey(candidate.dedupeKey)
  if (hasDedupeKey(input.existingDigestKeys, dedupeKey)) return null
  if (candidate.score < (input.minScore ?? DEFAULT_MIN_SCORE)) return null

  const content = cleanDigestContent(candidate.content)
  if (content.length < 120) return null

  const evidencePaths = evidencePathsForCandidate(candidate)
  const wikilinkEntities = extractWikilinkEntities(content, evidencePaths)
  const referenceEntities = extractReferenceEntities(candidate, evidencePaths)
  const entities = uniqueEntities([...referenceEntities, ...wikilinkEntities])
    .slice(0, input.maxEntities ?? 8)
  const evidenceCount = evidencePaths.length + wikilinkEntities.length
  if (evidenceCount === 0) return null

  const lines = candidateLines(content)
  const decisions = uniqueTexts(
    lines.filter((line) => DECISION_SIGNAL.test(line)).map(normalizeDigestText),
  )
    .slice(0, input.maxDecisions ?? 3)
    .map((statement, index) => ({
      id: `decision-${index + 1}`,
      statement,
      evidencePaths,
    }))
  const lessons = uniqueTexts(
    lines
      .filter((line) => !DECISION_SIGNAL.test(line) && LESSON_SIGNAL.test(line))
      .map(normalizeDigestText),
  )
    .slice(0, input.maxLessons ?? 4)
    .map((text, index) => ({
      id: `lesson-${index + 1}`,
      text,
      evidencePaths,
    }))

  if (decisions.length === 0 && lessons.length === 0 && entities.length === 0) {
    return null
  }

  const sourceSlug = slugify(candidate.title)
  const relations = entities
    .filter((entity) => entity.targetSlug.length > 0)
    .slice(0, input.maxRelations ?? 8)
    .map((entity, index) => ({
      id: `relation-${index + 1}`,
      field: "supports" as const,
      source: sourceSlug,
      target: entity.targetSlug,
      targetPath: entity.targetPath,
      evidencePaths: entity.evidencePaths,
      reason: "candidate output cited or linked this target",
    }))
  const pageCandidates = buildPageCandidates(candidate, {
    decisionCount: decisions.length,
    lessonCount: lessons.length,
    relationCount: relations.length,
  })
  const warnings =
    lessons.length === 0 && decisions.length === 0
      ? ["Digest only found entity/relation candidates; page save should stay user-confirmed."]
      : []

  return {
    id: `digest:${candidate.id}`,
    dedupeKey,
    source: {
      origin: candidate.origin,
      sourceId: candidate.sourceId,
      title: candidate.title,
      score: candidate.score,
      reasons: candidate.reasons,
      dedupeKey: candidate.dedupeKey,
    },
    lessons,
    decisions,
    entities,
    relations,
    pageCandidates,
    summary: {
      lessonCount: lessons.length,
      decisionCount: decisions.length,
      entityCount: entities.length,
      relationCount: relations.length,
      pageCandidateCount: pageCandidates.length,
    },
    warnings,
  }
}

export async function recordCrystallizationDigestPreview(
  projectPath: string,
  plan: CrystallizationDigestPlan,
): Promise<WikiAutomationEventResult> {
  return recordDigestEvent({
    type: "digest.preview",
    projectPath,
    plan,
    actor: "user",
    status: "dry-run",
    reasons: ["digest preview generated"],
    maintenance: false,
  })
}

export async function recordCrystallizationDigestSave(
  input: RecordCrystallizationDigestSaveInput,
): Promise<WikiAutomationEventResult> {
  return recordDigestEvent({
    type: "digest.save",
    projectPath: input.projectPath,
    plan: input.plan,
    actor: input.actor ?? "user",
    status: input.status ?? "applied",
    targetPaths: input.targetPaths,
    appliedOperationCount: input.appliedOperationCount,
    skippedOperationCount: input.skippedOperationCount,
    reasons: ["digest saved or applied", ...(input.reasons ?? [])],
  })
}

function buildPageCandidates(
  candidate: CrystallizationCandidate,
  counts: { decisionCount: number; lessonCount: number; relationCount: number },
): CrystallizationDigestPageCandidate[] {
  const crossCutting =
    candidate.score >= 0.7 &&
    (counts.decisionCount + counts.lessonCount >= 2 || counts.relationCount >= 2)
  const type: CrystallizationDigestPageType = crossCutting ? "synthesis" : "query"
  const directory = type === "synthesis" ? "wiki/synthesis" : "wiki/queries"
  const targetPath = `${directory}/${slugify(candidate.title)}.md`
  return [{
    id: `page-${type}`,
    type,
    title: candidate.title,
    targetPath,
    tags: uniqueTexts([type, "digest", ...candidate.tags]),
    reasons: [
      crossCutting
        ? "high-scoring output spans multiple lessons, decisions, or references"
        : "high-value output can be saved as a query page",
    ],
  }]
}

interface RecordDigestEventInput {
  type: "digest.preview" | "digest.save"
  projectPath: string
  plan: CrystallizationDigestPlan
  actor: AuditEventActor
  status: string
  targetPaths?: readonly string[]
  appliedOperationCount?: number
  skippedOperationCount?: number
  reasons: readonly string[]
  maintenance?: false
}

async function recordDigestEvent(
  input: RecordDigestEventInput,
): Promise<WikiAutomationEventResult> {
  const targetPaths = uniqueTexts([
    ...(input.targetPaths ?? []),
    ...input.plan.pageCandidates.map((page) => page.targetPath),
  ])
  const result = await recordWikiAutomationEvent({
    type: input.type,
    projectPath: normalizePath(input.projectPath),
    actor: input.actor,
    targetPath: targetPaths[0] ?? ".llm-wiki/crystallization",
    pagePath: targetPaths[0],
    status: input.status,
    reasons: [...input.reasons],
    summary: {
      dedupeKey: input.plan.dedupeKey,
      sourceDedupeKey: input.plan.source.dedupeKey,
      sourceId: input.plan.source.sourceId,
      sourceOrigin: input.plan.source.origin,
      targetPaths,
      counts: input.plan.summary,
      appliedOperationCount: input.appliedOperationCount,
      skippedOperationCount: input.skippedOperationCount,
      warnings: input.plan.warnings,
    },
    maintenance: input.maintenance,
  }).catch((err) => ({
    action: input.type,
    auditEvent: { action: input.type },
    auditError: err instanceof Error ? err.message : String(err),
    maintenanceError: undefined,
  }))

  if (!result.auditError && !result.maintenanceError) return result
  console.warn(
    `[crystallization-digest] ${input.type} event failed for ${input.plan.dedupeKey}: ${[
      result.auditError,
      result.maintenanceError,
    ].filter(Boolean).join("; ")}`,
  )
  return result
}

function extractReferenceEntities(
  candidate: CrystallizationCandidate,
  evidencePaths: string[],
): CrystallizationDigestEntity[] {
  const entities: CrystallizationDigestEntity[] = []
  for (const [index, ref] of candidate.references.entries()) {
    const path = wikiRelativePath(ref.path)
    const targetSlug = path ? slugFromWikiPath(path) : slugify(ref.title ?? ref.path)
    const name = ref.title?.trim() || titleFromSlug(targetSlug)
    if (!name || !targetSlug) continue
    entities.push({
      id: `entity-ref-${index + 1}`,
      name,
      type: pageTypeFromWikiPath(path),
      targetSlug,
      targetPath: path ? `wiki/${path}` : undefined,
      evidencePaths,
    })
  }
  return entities
}

function extractWikilinkEntities(
  content: string,
  evidencePaths: string[],
): CrystallizationDigestEntity[] {
  const entities: CrystallizationDigestEntity[] = []
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g
  let match: RegExpExecArray | null
  let index = 0
  while ((match = regex.exec(content)) !== null) {
    const rawTarget = match[1].trim()
    const label = match[2]?.trim()
    const path = wikiRelativePath(rawTarget)
    const targetSlug = path ? slugFromWikiPath(path) : slugify(rawTarget)
    const name = label || titleFromSlug(targetSlug)
    if (!name || !targetSlug) continue
    index += 1
    entities.push({
      id: `entity-link-${index}`,
      name,
      type: pageTypeFromWikiPath(path),
      targetSlug,
      targetPath: path ? `wiki/${path}` : undefined,
      evidencePaths,
    })
  }
  return entities
}

function evidencePathsForCandidate(candidate: CrystallizationCandidate): string[] {
  return uniqueTexts(
    candidate.references
      .map((ref) => ref.path.trim())
      .filter((path) => path.length > 0)
      .map((path) => {
        const wikiPath = wikiRelativePath(path)
        return wikiPath ? `wiki/${wikiPath}` : path
      }),
  )
}

function candidateLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^#{1,6}\s*/, "")
        .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
        .trim(),
    )
    .filter((line) => line.length >= 16)
}

function cleanDigestContent(content: string): string {
  return content
    .replace(/<!--.*?-->/gs, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
    .trim()
}

function normalizeDigestText(text: string): string {
  return text
    .replace(/^\s*(?:recommendation|decision|takeaway|lesson|finding|summary|conclusion)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260)
}

function uniqueEntities(
  entities: readonly CrystallizationDigestEntity[],
): CrystallizationDigestEntity[] {
  const seen = new Set<string>()
  const out: CrystallizationDigestEntity[] = []
  for (const entity of entities) {
    const key = entity.targetSlug.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(entity)
  }
  return out
}

function uniqueTexts(values: readonly string[]): string[] {
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

function hasDedupeKey(keys: Iterable<string> | undefined, dedupeKey: string): boolean {
  if (!keys) return false
  for (const key of keys) {
    if (key === dedupeKey) return true
  }
  return false
}

function digestDedupeKey(candidateDedupeKey: string): string {
  return `digest:${candidateDedupeKey}`
}

function wikiRelativePath(path: string): string | null {
  const normalized = normalizePath(path)
  if (normalized.startsWith("wiki/")) return normalized.slice("wiki/".length)
  if (isWikiDirectoryRelativePath(normalized)) return normalized
  const idx = normalized.indexOf("/wiki/")
  if (idx !== -1) return normalized.slice(idx + "/wiki/".length)
  return null
}

function isWikiDirectoryRelativePath(path: string): boolean {
  const first = path.split("/")[0]
  return [
    "entities",
    "concepts",
    "sources",
    "queries",
    "comparisons",
    "synthesis",
  ].includes(first)
}

function pageTypeFromWikiPath(path: string | null): CrystallizationDigestEntityType {
  if (!path) return "unknown"
  const first = path.split("/")[0]
  if (first === "entities") return "entity"
  if (first === "concepts") return "concept"
  if (first === "sources") return "source"
  if (first === "queries") return "query"
  if (first === "comparisons") return "comparison"
  if (first === "synthesis") return "synthesis"
  return "unknown"
}

function slugFromWikiPath(path: string): string {
  const clean = path.replace(/\.md$/i, "")
  return slugify(clean.split("/").pop() ?? clean)
}

function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "digest"
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

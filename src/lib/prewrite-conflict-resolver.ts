import { listDirectory, readFile } from "@/commands/fs"
import { readClaimIndex, type ClaimIndexWarning, type ClaimRecord } from "@/lib/claims"
import { parseFrontmatter } from "@/lib/frontmatter"
import { getFileStem, normalizePath } from "@/lib/path-utils"
import {
  buildUncertainPreWritePreview,
  classifyPreWriteConflict,
  type PreWriteCandidate,
  type PreWriteEvidence,
  type PreWriteConflictPreview,
  summarizePreWriteContent,
} from "@/lib/prewrite-conflict"
import type { FileNode } from "@/types/wiki"

export interface PreWriteEvidenceResolverOptions {
  maxClaims?: number
  maxEvidence?: number
  maxPages?: number
  maxPageExcerptLength?: number
  failClosedOnWarnings?: boolean
  cache?: PreWriteEvidenceResolverCache
}

export interface PreWriteEvidenceResolverResult {
  evidence: PreWriteEvidence[]
  warnings: ClaimIndexWarning[]
}

export interface PreWritePreviewResolverResult {
  preview: PreWriteConflictPreview
  warnings: ClaimIndexWarning[]
}

export interface PreWriteEvidenceResolverCache {
  claimIndex?: Promise<{ claims: ClaimRecord[]; warnings: ClaimIndexWarning[] }>
  pageSummaries?: Promise<WikiPageSummary[]>
}

const DEFAULT_MAX_CLAIMS = 40
const DEFAULT_MAX_EVIDENCE = 10
const DEFAULT_MAX_PAGES = 20
const DEFAULT_PAGE_EXCERPT_LENGTH = 220

export function createPreWriteEvidenceResolverCache(): PreWriteEvidenceResolverCache {
  return {}
}

export async function resolvePreWriteClaimEvidence(
  projectPath: string,
  candidate: PreWriteCandidate,
  options: PreWriteEvidenceResolverOptions = {},
): Promise<PreWriteEvidenceResolverResult> {
  const maxClaims = Math.max(0, Math.floor(options.maxClaims ?? DEFAULT_MAX_CLAIMS))
  const maxEvidence = Math.max(0, Math.floor(options.maxEvidence ?? DEFAULT_MAX_EVIDENCE))
  const index = await readClaimIndexCached(projectPath, options)
  const evidence = index.claims
    .slice(0, maxClaims)
    .map((claim) => claimToEvidence(candidate, claim))
    .filter((item): item is PreWriteEvidence => Boolean(item))
    .sort(compareEvidence)
    .slice(0, maxEvidence)
  return { evidence, warnings: index.warnings }
}

export async function previewPreWriteConflict(
  projectPath: string,
  candidate: PreWriteCandidate,
  options: PreWriteEvidenceResolverOptions = {},
): Promise<PreWritePreviewResolverResult> {
  try {
    const [claimResult, pageResult] = await Promise.all([
      resolvePreWriteClaimEvidence(projectPath, candidate, options),
      resolvePreWritePageEvidence(projectPath, candidate, options),
    ])
    const warnings = [...claimResult.warnings, ...pageResult.warnings]
    if (options.failClosedOnWarnings && warnings.length > 0) {
      return {
        preview: buildUncertainPreWritePreview(candidate, warnings[0]?.message ?? "resolver warning"),
        warnings,
      }
    }
    return {
      preview: classifyPreWriteConflict(candidate, [
        ...claimResult.evidence,
        ...pageResult.evidence,
      ]),
      warnings,
    }
  } catch (err) {
    return {
      preview: buildUncertainPreWritePreview(candidate, err),
      warnings: [],
    }
  }
}

export async function resolvePreWritePageEvidence(
  projectPath: string,
  candidate: PreWriteCandidate,
  options: PreWriteEvidenceResolverOptions = {},
): Promise<PreWriteEvidenceResolverResult> {
  const maxPages = Math.max(0, Math.floor(options.maxPages ?? DEFAULT_MAX_PAGES))
  const maxEvidence = Math.max(0, Math.floor(options.maxEvidence ?? DEFAULT_MAX_EVIDENCE))
  const pages = await readWikiPageSummariesCached(
    projectPath,
    maxPages,
    options.maxPageExcerptLength,
    options.cache,
  )
  const evidence = pages
    .map((page) => pageToEvidence(candidate, page))
    .filter((item): item is PreWriteEvidence => Boolean(item))
    .sort(compareEvidence)
    .slice(0, maxEvidence)
  return { evidence, warnings: [] }
}

function claimToEvidence(
  candidate: PreWriteCandidate,
  claim: ClaimRecord,
): PreWriteEvidence | null {
  const textScore = maxClaimTextOverlap(candidate, claim)
  const pathScore = samePath(candidate.targetPath, claim.page_path) ? 1 : 0
  const relation = claimRelation(candidate, claim)
  const related = textScore >= 0.45 || pathScore > 0 || Boolean(relation)
  const risky = related && (
    claim.status === "contradicted" ||
    claim.status === "superseded" ||
    Boolean(relation)
  )
  if (!risky && textScore < 0.45 && pathScore === 0) return null

  const reasons: string[] = []
  if (textScore >= 0.45) reasons.push("claim text overlaps candidate")
  if (pathScore > 0) reasons.push("claim belongs to target path")
  if (claim.status === "contradicted") reasons.push("claim status is contradicted")
  if (claim.status === "superseded") reasons.push("claim status is superseded")
  if (relation === "contradicts") reasons.push("contradiction relation present")
  if (relation === "supersedes" || relation === "superseded-by") {
    reasons.push("supersession relation present")
  }

  return {
    kind: relation ? "relation" : "claim",
    pagePath: claim.page_path,
    ...(claim.page_title ? { pageTitle: claim.page_title } : {}),
    claimId: claim.claim_id,
    claimText: claim.text,
    status: claim.status,
    ...(relation ? { relation } : {}),
    score: Math.max(textScore, pathScore * 0.7, risky ? 0.75 : 0),
    reasons,
  }
}

function maxClaimTextOverlap(candidate: PreWriteCandidate, claim: ClaimRecord): number {
  const candidateTexts = [
    candidate.title ?? "",
    candidate.contentSummary,
    ...candidate.claimSummaries.map((summary) => summary.text),
  ]
  return Math.max(...candidateTexts.map((text) => tokenOverlap(text, claim.text)), 0)
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0
  const rightSet = new Set(rightTokens)
  let matches = 0
  for (const token of leftTokens) {
    if (rightSet.has(token)) matches += 1
  }
  return matches / Math.max(1, Math.min(leftTokens.length, rightTokens.length))
}

function tokens(value: string): string[] {
  const normalized = value.toLowerCase()
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  const cjk = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []
  return uniqueStrings([...latin, ...cjk])
}

function claimRelation(
  candidate: PreWriteCandidate,
  claim: ClaimRecord,
): PreWriteEvidence["relation"] | undefined {
  if (claim.status === "superseded") return "superseded-by"
  const candidateIds = new Set(candidate.claimSummaries.flatMap((summary) =>
    summary.claimId ? [summary.claimId] : []
  ))
  if (intersects(candidateIds, claim.contradicts)) return "contradicts"
  if (intersects(candidateIds, claim.supersedes)) return "supersedes"
  if (intersects(candidateIds, claim.superseded_by)) return "superseded-by"

  for (const summary of candidate.claimSummaries) {
    if (summary.relation === "contradicts") return "contradicts"
    if (summary.relation === "supersedes") return "supersedes"
    if (summary.relation === "superseded-by") return "superseded-by"
  }
  return undefined
}

function intersects(left: ReadonlySet<string>, right: readonly string[]): boolean {
  for (const value of right) {
    if (left.has(value)) return true
  }
  return false
}

function samePath(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function compareEvidence(a: PreWriteEvidence, b: PreWriteEvidence): number {
  const scoreDelta = b.score - a.score
  if (scoreDelta !== 0) return scoreDelta
  return [a.pagePath ?? "", a.claimId ?? ""].join("\n").localeCompare(
    [b.pagePath ?? "", b.claimId ?? ""].join("\n"),
  )
}

interface WikiPageSummary {
  path: string
  title: string
  excerpt: string
}

function readClaimIndexCached(
  projectPath: string,
  options: PreWriteEvidenceResolverOptions,
): Promise<{ claims: ClaimRecord[]; warnings: ClaimIndexWarning[] }> {
  if (!options.cache) return readClaimIndex(projectPath)
  options.cache.claimIndex ??= readClaimIndex(projectPath)
  return options.cache.claimIndex
}

function readWikiPageSummariesCached(
  projectPath: string,
  maxPages: number,
  maxExcerptLength: number | undefined,
  cache: PreWriteEvidenceResolverCache | undefined,
): Promise<WikiPageSummary[]> {
  if (!cache) return readWikiPageSummaries(projectPath, maxPages, maxExcerptLength)
  cache.pageSummaries ??= readWikiPageSummaries(projectPath, maxPages, maxExcerptLength)
  return cache.pageSummaries
}

async function readWikiPageSummaries(
  projectPath: string,
  maxPages: number,
  maxExcerptLength = DEFAULT_PAGE_EXCERPT_LENGTH,
): Promise<WikiPageSummary[]> {
  let tree: FileNode[]
  try {
    tree = await listDirectory(`${normalizeProjectPath(projectPath)}/wiki`)
  } catch {
    return []
  }

  const files = flattenMarkdownFiles(tree).slice(0, maxPages)
  const pages: WikiPageSummary[] = []
  for (const file of files) {
    try {
      const content = await readFile(file.path)
      const relativePath = toProjectRelativePath(projectPath, file.path)
      pages.push({
        path: relativePath,
        title: pageTitle(content, file.name),
        excerpt: summarizePreWriteContent(content, maxExcerptLength),
      })
    } catch {
      // Ignore unreadable pages; later combined preview can conservatively
      // downgrade only when the resolver itself fails.
    }
  }
  return pages
}

function pageToEvidence(
  candidate: PreWriteCandidate,
  page: WikiPageSummary,
): PreWriteEvidence | null {
  if (samePath(candidate.targetPath, page.path)) {
    return {
      kind: "page",
      pagePath: page.path,
      pageTitle: page.title,
      pageExcerpt: page.excerpt,
      score: 1,
      reasons: ["target path already exists"],
    }
  }

  const candidateTitle = normalizeTitle(candidate.title ?? "")
  if (candidateTitle && candidateTitle === normalizeTitle(page.title)) {
    return {
      kind: "page",
      pagePath: page.path,
      pageTitle: page.title,
      pageExcerpt: page.excerpt,
      score: 0.85,
      reasons: ["same title exists at a different path"],
    }
  }

  return null
}

function flattenMarkdownFiles(nodes: readonly FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMarkdownFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function pageTitle(content: string, fileName: string): string {
  const parsed = parseFrontmatter(content)
  const frontmatterTitle = stringValue(parsed.frontmatter?.title)
  if (frontmatterTitle) return frontmatterTitle
  const heading = content.match(/^\s{0,3}#\s+(.+?)\s*$/m)?.[1]?.trim()
  return heading || getFileStem(fileName)
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase()
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeProjectPath(projectPath: string): string {
  return normalizePath(projectPath).replace(/\/$/, "")
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const pp = normalizeProjectPath(projectPath)
  const normalized = normalizePath(path)
  return normalized.startsWith(`${pp}/`) ? normalized.slice(pp.length + 1) : normalized
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

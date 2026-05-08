import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import type { MemoryOpsWikiPage } from "@/lib/memory-ops"
import { normalizePath } from "@/lib/path-utils"
import {
  buildPreWriteCandidate,
  type PreWriteCandidate,
  type PreWriteConflictPreview,
} from "@/lib/prewrite-conflict"
import {
  createPreWriteEvidenceResolverCache,
  previewPreWriteConflict,
  type PreWriteEvidenceResolverOptions,
  type PreWritePreviewResolverResult,
} from "@/lib/prewrite-conflict-resolver"

export interface MemoryOpsHistoricalConflictWarning {
  pagePath: string
  message: string
}

export interface MemoryOpsHistoricalConflictResult {
  candidateCount: number
  previews: PreWriteConflictPreview[]
  warnings: MemoryOpsHistoricalConflictWarning[]
  warningCount: number
}

export interface MemoryOpsHistoricalConflictOptions {
  resolverOptions?: PreWriteEvidenceResolverOptions
  previewConflict?: (
    projectPath: string,
    candidate: PreWriteCandidate,
    options: PreWriteEvidenceResolverOptions,
  ) => Promise<PreWritePreviewResolverResult>
}

export function buildMemoryOpsConflictCandidate(
  projectPath: string,
  page: MemoryOpsWikiPage,
): PreWriteCandidate {
  return buildPreWriteCandidate({
    kind: "maintenance-page",
    targetPath: toProjectRelativePath(projectPath, page.path),
    title: pageTitle(page),
    content: page.content,
  })
}

export async function previewMemoryOpsHistoricalConflicts(
  projectPath: string,
  pages: readonly MemoryOpsWikiPage[],
  options: MemoryOpsHistoricalConflictOptions = {},
): Promise<MemoryOpsHistoricalConflictResult> {
  const cache = options.resolverOptions?.cache ?? createPreWriteEvidenceResolverCache()
  const resolverOptions: PreWriteEvidenceResolverOptions = {
    ...options.resolverOptions,
    cache,
  }
  const previewConflict = options.previewConflict ?? previewPreWriteConflict
  const previews: PreWriteConflictPreview[] = []
  const warnings: MemoryOpsHistoricalConflictWarning[] = []

  for (const page of pages) {
    const candidate = buildMemoryOpsConflictCandidate(projectPath, page)
    try {
      const result = await previewConflict(projectPath, candidate, resolverOptions)
      if (isHistoricalConflictPreview(result.preview)) {
        previews.push(result.preview)
      }
      for (const warning of result.warnings) {
        warnings.push({
          pagePath: candidate.targetPath,
          message: warning.message,
        })
      }
    } catch (err) {
      warnings.push({
        pagePath: candidate.targetPath,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    candidateCount: pages.length,
    previews,
    warnings,
    warningCount: warnings.length,
  }
}

function isHistoricalConflictPreview(preview: PreWriteConflictPreview): boolean {
  if (preview.decision !== "review-only") return false
  if (
    preview.classification !== "duplicate" &&
    preview.classification !== "possible-contradiction" &&
    preview.classification !== "supersession" &&
    preview.classification !== "uncertain"
  ) {
    return false
  }
  return preview.evidence.some((evidence) =>
    evidence.pagePath ? !samePath(preview.candidate.targetPath, evidence.pagePath) : true
  )
}

function pageTitle(page: MemoryOpsWikiPage): string {
  const frontmatter = page.frontmatter ?? parseFrontmatter(page.content).frontmatter
  return (
    scalar(frontmatter?.title) ??
    firstHeading(page.content) ??
    page.fileName.replace(/\.md$/i, "")
  )
}

function scalar(value: FrontmatterValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function firstHeading(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || undefined
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const project = normalizePath(projectPath).replace(/\/$/, "")
  const normalized = normalizePath(path)
  return normalized.startsWith(`${project}/`) ? normalized.slice(project.length + 1) : normalized
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left).trim().toLowerCase() === normalizePath(right).trim().toLowerCase()
}

import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import type { MemoryOpsWikiPage } from "@/lib/memory-ops"
import { normalizePath } from "@/lib/path-utils"
import { buildPreWriteCandidate, type PreWriteCandidate } from "@/lib/prewrite-conflict"

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
